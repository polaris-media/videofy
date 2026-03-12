#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from urllib.request import Request, urlopen

REQUEST_TIMEOUT_SECONDS = 30
USER_AGENT = "videofy-minimal-fetch-web/1.0"


class WebImportError(Exception):
    """Raised when importing from a web URL fails."""


@dataclass
class MediaResult:
    rel_path: str
    byline: str | None
    start_from: float | None = None
    end_at: float | None = None


@dataclass
class ArticleCandidate:
    paragraphs: list[str] = field(default_factory=list)
    h1s: list[str] = field(default_factory=list)
    bylines: list[str] = field(default_factory=list)
    times: list[str] = field(default_factory=list)
    image_urls: list[str] = field(default_factory=list)
    video_urls: list[str] = field(default_factory=list)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sanitize_project_id(raw: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._")
    if not candidate:
        raise WebImportError("Could not derive a valid project id")
    if not candidate[0].isalnum():
        candidate = f"p-{candidate}"
    return candidate


def _slug_from_url(url: str) -> str:
    parsed = urlparse(url)
    segments = [segment for segment in parsed.path.split("/") if segment]
    if segments:
        joined = "-".join(segments[-4:])
        return sanitize_project_id(joined.lower())[:100]
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return f"url-{digest}"


def derive_project_id(url: str, project_id: str | None) -> str:
    if project_id:
        return sanitize_project_id(project_id)
    return sanitize_project_id(f"web-{_slug_from_url(url)}")


def _normalize_text(raw: str) -> str:
    text = unescape(raw)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized_lines: list[str] = []
    for line in text.split("\n"):
        clean = re.sub(r"\s+", " ", line).strip()
        normalized_lines.append(clean)

    cleaned: list[str] = []
    previous_blank = True
    for line in normalized_lines:
        if not line:
            if not previous_blank:
                cleaned.append("")
            previous_blank = True
            continue
        cleaned.append(line)
        previous_blank = False
    return "\n".join(cleaned).strip()


def _normalize_inline_text(raw: str) -> str:
    return re.sub(r"\s+", " ", unescape(raw)).strip()


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        clean = value.strip()
        if not clean or clean in seen:
            continue
        out.append(clean)
        seen.add(clean)
    return out


def _is_http_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def _best_from_srcset(srcset: str, base_url: str) -> str | None:
    best_url = None
    best_width = -1

    for item in srcset.split(","):
        candidate = item.strip()
        if not candidate:
            continue
        bits = candidate.split()
        url_part = bits[0]
        width = 0
        if len(bits) > 1 and bits[1].endswith("w"):
            try:
                width = int(bits[1][:-1])
            except ValueError:
                width = 0
        full = urljoin(base_url, url_part)
        if width >= best_width:
            best_width = width
            best_url = full

    return best_url


def _safe_query_width(url: str) -> int | None:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    for key in ("w", "width"):
        value = (query.get(key) or [None])[0]
        if not value:
            continue
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _looks_like_real_image(url: str) -> bool:
    lower = url.lower()
    if lower.endswith(".svg"):
        return False
    if any(token in lower for token in ("placeholder", "/logo", "/icons/", "favicon")):
        return False
    width = _safe_query_width(url)
    if width is not None and width < 160:
        return False
    return True


def _looks_like_video(url: str) -> bool:
    lower = url.lower()
    return re.search(r"\.(mp4|mov|webm|m3u8)(?:[?#]|$)", lower) is not None


def _normalize_media_url(raw: str, base_url: str) -> str | None:
    candidate = unescape(raw).strip()
    candidate = candidate.replace("\\/", "/")
    candidate = candidate.strip("\"'`")
    candidate = candidate.rstrip("\\")
    candidate = re.sub(r"[),;]+$", "", candidate).strip()
    if not candidate:
        return None
    if candidate.startswith("data:"):
        return None
    return urljoin(base_url, candidate)


def _extract_video_urls_from_html(html_source: str, page_url: str) -> list[str]:
    # Keep this generic: extract direct media URLs from raw/escaped HTML strings.
    sources = [
        unescape(html_source),
        unescape(html_source).replace("\\/", "/"),
    ]

    patterns = [
        r"https?://[^\s\"'<>\\]+",
        r"[\"'](/[^\"']+\.(?:mp4|m3u8|mov|webm)(?:\?[^\"']*)?)[\"']",
    ]

    out: list[str] = []
    for source in sources:
        for pattern in patterns:
            for match in re.findall(pattern, source, flags=re.IGNORECASE):
                raw = match if isinstance(match, str) else match[0]
                full = _normalize_media_url(raw, page_url)
                if not full:
                    continue
                if not _looks_like_video(full):
                    continue
                lowered = full.lower()
                if any(
                    token in lowered
                    for token in ("doubleclick", "googlesyndication", "adservice", "advert")
                ):
                    continue
                out.append(full)

    return _unique_keep_order(out)


def _parse_author_value(value: Any) -> list[str]:
    out: list[str] = []
    if isinstance(value, str):
        clean = _normalize_inline_text(value)
        if clean:
            out.append(clean)
        return out
    if isinstance(value, dict):
        for key in ("name", "title", "value"):
            if key in value:
                out.extend(_parse_author_value(value[key]))
        return out
    if isinstance(value, list):
        for item in value:
            out.extend(_parse_author_value(item))
        return out
    return out


def _join_byline(names: list[str]) -> str:
    deduped = _unique_keep_order([_normalize_inline_text(name) for name in names if name.strip()])
    if not deduped:
        return ""
    if len(deduped) == 1:
        return f"Av {deduped[0]}"
    return f"Av {', '.join(deduped[:-1])} og {deduped[-1]}"


def _clean_byline_candidate(value: str) -> str | None:
    text = _normalize_inline_text(value)
    if not text:
        return None
    text = re.sub(r"^(av|by)\s+", "", text, flags=re.IGNORECASE).strip()
    if not text or "@" in text:
        return None
    if len(text) > 120:
        return None
    words = text.split()
    if len(words) > 12:
        return None
    return text


def _flatten_json_like(value: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            out.append(node)
            for key in ("@graph", "graph", "itemListElement", "mainEntity", "mainEntityOfPage"):
                if key in node:
                    walk(node[key])
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(value)
    return out


def _article_type_score(type_value: Any) -> int:
    if isinstance(type_value, list):
        values = [str(v).lower() for v in type_value]
    elif isinstance(type_value, str):
        values = [type_value.lower()]
    else:
        values = []
    score = 0
    article_types = {
        "article",
        "newsarticle",
        "reportagenewsarticle",
        "analysisnewsarticle",
        "liveblogposting",
    }
    for value in values:
        if value in article_types:
            score += 10
    return score


def _choose_primary_json_article(nodes: list[dict[str, Any]]) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_score = -1
    for node in nodes:
        score = _article_type_score(node.get("@type"))
        if "headline" in node:
            score += 6
        if "author" in node:
            score += 5
        if "datePublished" in node:
            score += 4
        if "articleBody" in node:
            score += 8
        if "image" in node:
            score += 3
        if score > best_score:
            best = node
            best_score = score
    return best


def _extract_json_image_urls(value: Any, out: list[str]) -> None:
    if isinstance(value, str):
        if _is_http_url(value):
            out.append(value)
        return
    if isinstance(value, dict):
        for key in ("url", "contentUrl", "thumbnailUrl"):
            if key in value:
                _extract_json_image_urls(value[key], out)
        return
    if isinstance(value, list):
        for item in value:
            _extract_json_image_urls(item, out)


def _extract_json_video_urls(value: Any, out: list[str]) -> None:
    if isinstance(value, str):
        if _is_http_url(value) and _looks_like_video(value):
            out.append(value)
        return
    if isinstance(value, dict):
        for key in ("contentUrl", "url", "embedUrl"):
            if key in value:
                _extract_json_video_urls(value[key], out)
        return
    if isinstance(value, list):
        for item in value:
            _extract_json_video_urls(item, out)


class _WebHtmlParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.meta_first: dict[str, str] = {}
        self.meta_all: dict[str, list[str]] = {}
        self.ldjson_blocks: list[str] = []
        self.title_text = ""
        self.h1_texts: list[str] = []
        self.global_paragraphs: list[str] = []
        self.global_times: list[str] = []
        self.global_bylines: list[str] = []
        self.article_candidates: list[ArticleCandidate] = []
        self._article_stack: list[int] = []
        self._capture_stack: list[dict[str, Any]] = []
        self._capture_script = False
        self._script_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}

        if tag == "article":
            self.article_candidates.append(ArticleCandidate())
            self._article_stack.append(len(self.article_candidates) - 1)

        if tag == "meta":
            self._handle_meta(attr_map)
        elif tag == "img":
            self._handle_image(attr_map)
        elif tag in {"video", "source"}:
            self._handle_video(attr_map)

        if tag == "script":
            script_type = attr_map.get("type", "").lower()
            if script_type == "application/ld+json":
                self._capture_script = True
                self._script_parts = []

        if tag == "br":
            for frame in self._capture_stack:
                frame["parts"].append("\n")

        if tag in {"title", "h1", "p", "time"}:
            self._capture_stack.append(
                {
                    "tag": tag,
                    "kind": tag,
                    "attrs": attr_map,
                    "parts": [],
                    "article_index": self._article_stack[-1] if self._article_stack else None,
                }
            )
        elif self._looks_like_byline_container(tag, attr_map):
            self._capture_stack.append(
                {
                    "tag": tag,
                    "kind": "byline",
                    "attrs": attr_map,
                    "parts": [],
                    "article_index": self._article_stack[-1] if self._article_stack else None,
                }
            )

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if tag == "script" and self._capture_script:
            content = "".join(self._script_parts).strip()
            if content:
                self.ldjson_blocks.append(content)
            self._capture_script = False
            self._script_parts = []

        for idx in range(len(self._capture_stack) - 1, -1, -1):
            if self._capture_stack[idx]["tag"] == tag:
                frame = self._capture_stack.pop(idx)
                self._finalize_capture(frame)
                break

        if tag == "article" and self._article_stack:
            self._article_stack.pop()

    def handle_data(self, data: str) -> None:
        if self._capture_script:
            self._script_parts.append(data)
        if self._capture_stack:
            for frame in self._capture_stack:
                frame["parts"].append(data)

    def _handle_meta(self, attrs: dict[str, str]) -> None:
        key = (
            attrs.get("property")
            or attrs.get("name")
            or attrs.get("itemprop")
            or attrs.get("http-equiv")
            or ""
        ).strip()
        value = attrs.get("content", "").strip()
        if not key or not value:
            return
        normalized_key = key.lower()
        if normalized_key not in self.meta_first:
            self.meta_first[normalized_key] = value
        self.meta_all.setdefault(normalized_key, []).append(value)

    def _handle_image(self, attrs: dict[str, str]) -> None:
        article_index = self._article_stack[-1] if self._article_stack else None

        srcset = attrs.get("srcset") or attrs.get("data-srcset")
        if srcset:
            best = _best_from_srcset(srcset, self.base_url)
            if best:
                self._push_media(best, "image", article_index)

        for key in ("src", "data-src", "data-original", "data-lazy-src"):
            value = attrs.get(key, "").strip()
            if value:
                self._push_media(value, "image", article_index)

    def _handle_video(self, attrs: dict[str, str]) -> None:
        article_index = self._article_stack[-1] if self._article_stack else None
        for key in ("src", "data-src", "data-video-src"):
            value = attrs.get(key, "").strip()
            if not value:
                continue
            if "," in value:
                for part in value.split(","):
                    self._push_media(part, "video", article_index)
            else:
                self._push_media(value, "video", article_index)

    def _push_media(self, raw_url: str, kind: str, article_index: int | None) -> None:
        normalized = _normalize_media_url(raw_url, self.base_url)
        if not normalized or not _is_http_url(normalized):
            return

        if kind == "image":
            if article_index is not None:
                self.article_candidates[article_index].image_urls.append(normalized)
        else:
            if article_index is not None:
                self.article_candidates[article_index].video_urls.append(normalized)

    def _looks_like_byline_container(self, tag: str, attrs: dict[str, str]) -> bool:
        if tag not in {"div", "span", "p", "a", "li"}:
            return False
        blob = f"{attrs.get('class', '')} {attrs.get('id', '')}".lower()
        if not blob:
            return False
        if any(token in blob for token in ("byline", "author", "journalist", "reporter", "writer")):
            return True
        return False

    def _finalize_capture(self, frame: dict[str, Any]) -> None:
        text = _normalize_text("".join(frame["parts"]))
        if not text:
            return

        kind = frame["kind"]
        article_index = frame["article_index"]
        candidate = self.article_candidates[article_index] if article_index is not None else None

        if kind == "title":
            if not self.title_text:
                self.title_text = text
            return

        if kind == "h1":
            self.h1_texts.append(text)
            if candidate is not None:
                candidate.h1s.append(text)
            return

        if kind == "p":
            self.global_paragraphs.append(text)
            if candidate is not None:
                candidate.paragraphs.append(text)
            return

        if kind == "time":
            dt = frame["attrs"].get("datetime", "").strip()
            self.global_times.append(dt or text)
            if candidate is not None:
                candidate.times.append(dt or text)
            return

        if kind == "byline":
            cleaned = _clean_byline_candidate(text)
            if cleaned:
                self.global_bylines.append(cleaned)
                if candidate is not None:
                    candidate.bylines.append(cleaned)


def request_html(url: str, timeout: int) -> tuple[str, str, dict[str, str]]:
    req = Request(
        url=url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9,no;q=0.8",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=timeout) as response:
            raw = response.read()
            final_url = response.geturl()
            headers = {k.lower(): v for k, v in response.headers.items()}
            charset = response.headers.get_content_charset() or "utf-8"
            try:
                html = raw.decode(charset, errors="replace")
            except LookupError:
                html = raw.decode("utf-8", errors="replace")
            return html, final_url, headers
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:600]
        raise WebImportError(f"HTTP {exc.code} from {url}: {details}") from exc
    except URLError as exc:
        raise WebImportError(f"Request failed for {url}: {exc.reason}") from exc


def parse_html(html: str, base_url: str) -> _WebHtmlParser:
    parser = _WebHtmlParser(base_url=base_url)
    parser.feed(html)
    parser.close()
    return parser


def _parse_ldjson_blocks(blocks: list[str]) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for raw in blocks:
        payload: Any
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            try:
                fixed = raw.replace("\n", " ").replace("\t", " ").strip()
                payload = json.loads(fixed)
            except json.JSONDecodeError:
                continue
        for node in _flatten_json_like(payload):
            nodes.append(node)
    return nodes


def _article_candidate_score(candidate: ArticleCandidate) -> int:
    paragraph_chars = sum(len(_normalize_inline_text(p)) for p in candidate.paragraphs)
    return (
        paragraph_chars
        + len(candidate.paragraphs) * 120
        + len(candidate.h1s) * 500
        + len(candidate.image_urls) * 25
        + len(candidate.video_urls) * 50
        + len(candidate.bylines) * 40
    )


def choose_main_article(candidates: list[ArticleCandidate]) -> ArticleCandidate | None:
    if not candidates:
        return None
    return max(candidates, key=_article_candidate_score)


def _filter_paragraphs(values: list[str]) -> list[str]:
    out: list[str] = []
    for raw in values:
        text = _normalize_inline_text(raw)
        if not text:
            continue
        if len(text) < 30 and len(text.split()) < 5:
            continue
        lowered = text.lower()
        if lowered in {"skip to content", "forrige artikkel.", "neste artikkel."}:
            continue
        if text not in out:
            out.append(text)
    return out


def _pick_title(
    main_article: ArticleCandidate | None,
    parser: _WebHtmlParser,
    article_json: dict[str, Any] | None,
) -> str:
    h1_candidates: list[str] = []
    if main_article:
        h1_candidates.extend(main_article.h1s)
    h1_candidates.extend(parser.h1_texts)

    cleaned_h1s = _unique_keep_order([_normalize_inline_text(item) for item in h1_candidates])
    for title in cleaned_h1s:
        if len(title.split()) < 3:
            continue
        lower = title.lower()
        if lower in {"nettavisen sport.", "bbc", "vg"}:
            continue
        return title

    if article_json:
        headline = article_json.get("headline")
        if isinstance(headline, str) and headline.strip():
            return _normalize_inline_text(headline)

    og_title = parser.meta_first.get("og:title")
    if og_title:
        return _normalize_inline_text(og_title)

    if parser.title_text:
        return _normalize_inline_text(parser.title_text)

    return "Untitled web article"


def _pick_pubdate(
    parser: _WebHtmlParser,
    article_json: dict[str, Any] | None,
    main_article: ArticleCandidate | None,
) -> str:
    if article_json:
        for key in ("datePublished", "dateCreated", "dateModified"):
            value = article_json.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    for key in (
        "article:published_time",
        "article:published",
        "publisheddate",
        "publishdate",
        "pubdate",
        "cxenseparse:publishtime",
    ):
        value = parser.meta_first.get(key)
        if value:
            return value.strip()

    time_candidates: list[str] = []
    if main_article:
        time_candidates.extend(main_article.times)
    time_candidates.extend(parser.global_times)
    for value in time_candidates:
        if "T" in value and any(char.isdigit() for char in value):
            return value.strip()

    return utc_now_iso()


def _pick_byline(
    parser: _WebHtmlParser,
    article_json: dict[str, Any] | None,
    main_article: ArticleCandidate | None,
) -> str:
    names: list[str] = []

    if article_json:
        names.extend(_parse_author_value(article_json.get("author")))

    for key in ("article:author", "author", "cxenseparse:author", "lp.article:author"):
        names.extend(parser.meta_all.get(key, []))

    if not names and main_article:
        names.extend(main_article.bylines)
    if not names:
        names.extend(parser.global_bylines)

    cleaned: list[str] = []
    for name in names:
        candidate = _clean_byline_candidate(name)
        if candidate:
            cleaned.append(candidate)

    return _join_byline(cleaned)


def _pick_text(
    title: str,
    parser: _WebHtmlParser,
    article_json: dict[str, Any] | None,
    main_article: ArticleCandidate | None,
) -> tuple[str, int]:
    if article_json:
        article_body = article_json.get("articleBody")
        if isinstance(article_body, str):
            normalized = _normalize_text(article_body)
            if len(normalized) > 150:
                return normalized, len(normalized.split("\n\n"))

    paragraph_source = main_article.paragraphs if main_article else parser.global_paragraphs
    paragraphs = _filter_paragraphs(paragraph_source)
    if not paragraphs:
        paragraphs = _filter_paragraphs(parser.global_paragraphs)

    if paragraphs:
        return "\n\n".join(paragraphs).strip(), len(paragraphs)

    description = parser.meta_first.get("description")
    if description:
        fallback = _normalize_inline_text(description)
        if fallback:
            return f"{title}\n\n{fallback}", 1

    return title, 1


def _pick_image_urls(
    page_url: str,
    parser: _WebHtmlParser,
    article_json: dict[str, Any] | None,
    main_article: ArticleCandidate | None,
) -> list[str]:
    urls: list[str] = []

    if main_article:
        urls.extend(main_article.image_urls)

    if article_json:
        _extract_json_image_urls(article_json.get("image"), urls)
        _extract_json_image_urls(article_json.get("thumbnailUrl"), urls)

    for key in ("og:image", "twitter:image", "twitter:image:src"):
        urls.extend(parser.meta_all.get(key, []))

    normalized: list[str] = []
    for url in urls:
        full = _normalize_media_url(url, page_url)
        if not full:
            continue
        if not _looks_like_real_image(full):
            continue
        normalized.append(full)
    return _unique_keep_order(normalized)


def _pick_video_urls(
    page_url: str,
    parser: _WebHtmlParser,
    article_json_nodes: list[dict[str, Any]],
    main_article: ArticleCandidate | None,
    html_source: str,
) -> list[str]:
    urls: list[str] = []

    if main_article:
        urls.extend(main_article.video_urls)

    for node in article_json_nodes:
        node_type = str(node.get("@type", "")).lower()
        if "videoobject" not in node_type and node is not article_json_nodes[0]:
            continue
        _extract_json_video_urls(node.get("video"), urls)
        _extract_json_video_urls(node.get("contentUrl"), urls)
        _extract_json_video_urls(node.get("url"), urls)

    for key in (
        "og:video",
        "og:video:url",
        "og:video:secure_url",
        "twitter:player:stream",
        "twitter:player:stream:content_type",
    ):
        urls.extend(parser.meta_all.get(key, []))

    urls.extend(_extract_video_urls_from_html(html_source=html_source, page_url=page_url))

    normalized: list[str] = []
    for url in urls:
        full = _normalize_media_url(url, page_url)
        if not full:
            continue
        if full.rstrip("/") == page_url.rstrip("/"):
            continue
        if not _looks_like_video(full):
            continue
        normalized.append(full)

    deduped = _unique_keep_order(normalized)
    mp4_first = [url for url in deduped if ".mp4" in url.lower()]
    if mp4_first:
        by_name: list[str] = []
        seen_names: set[str] = set()
        for url in mp4_first:
            name = Path(urlparse(url).path).name.lower()
            key = name or url
            if key in seen_names:
                continue
            seen_names.add(key)
            by_name.append(url)
        return by_name
    return deduped


def _ext_from_content_type(content_type: str | None, kind: str) -> str:
    if not content_type:
        return ".mp4" if kind == "video" else ".jpg"

    lookup = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
        "video/webm": ".webm",
    }

    content_type = content_type.split(";")[0].strip().lower()
    return lookup.get(content_type, ".mp4" if kind == "video" else ".jpg")


def _filename_for_url(url: str, kind: str, index: int, content_type: str | None = None) -> str:
    parsed = urlparse(url)
    basename = Path(unquote(parsed.path)).name
    ext = ""

    if basename and "." in basename:
        suffix = Path(basename).suffix.lower()
        if re.fullmatch(r"\.[a-z0-9]{1,6}", suffix):
            ext = suffix

    if not ext:
        ext = _ext_from_content_type(content_type, kind)

    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{kind}-{index:03}-{digest}{ext}"


def _download_binary(url: str, target_file: Path, timeout: int, referer: str) -> str | None:
    req = Request(
        url=url,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": referer,
        },
        method="GET",
    )
    with urlopen(req, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type")
        with tempfile.NamedTemporaryFile(delete=False, dir=target_file.parent) as tmp:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
            tmp_path = Path(tmp.name)
    tmp_path.replace(target_file)
    return content_type


def download_media(url: str, target_file: Path, timeout: int, referer: str) -> str | None:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        return _download_binary(url, target_file, timeout=timeout, referer=referer)
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:400]
        raise WebImportError(f"Download failed ({exc.code}) for {url}: {details}") from exc
    except URLError as exc:
        raise WebImportError(f"Download failed for {url}: {exc.reason}") from exc


def build_generation_manifest(project_id: str) -> dict[str, Any]:
    now = utc_now_iso()
    return {
        "projectId": project_id,
        "brandId": "vg",
        "promptPack": "vg",
        "voicePack": "vg",
        "options": {
            "orientationDefault": "vertical",
            "segmentPauseSeconds": 0.4,
        },
        "createdAt": now,
        "updatedAt": now,
    }


def create_project_layout(project_dir: Path, force: bool) -> None:
    if project_dir.exists() and any(project_dir.iterdir()):
        if not force:
            raise WebImportError(
                f"Project directory already exists and is non-empty: {project_dir}. "
                "Use --force to replace it."
            )
        shutil.rmtree(project_dir)

    for rel in ("input/images", "input/videos", "working/uploads", "working/audio", "output"):
        (project_dir / rel).mkdir(parents=True, exist_ok=True)


def import_web_article(
    url: str,
    project_id: str | None,
    projects_root: Path,
    timeout: int,
    force: bool,
    max_images: int,
    max_videos: int,
) -> Path:
    canonical_project_id = derive_project_id(url, project_id)
    project_dir = (projects_root / canonical_project_id).resolve()
    if not str(project_dir).startswith(str(projects_root.resolve())):
        raise WebImportError(f"Unsafe project path resolved: {project_dir}")

    html, final_url, response_headers = request_html(url=url, timeout=timeout)
    parser = parse_html(html=html, base_url=final_url)
    ldjson_nodes = _parse_ldjson_blocks(parser.ldjson_blocks)
    primary_article_json = _choose_primary_json_article(ldjson_nodes)
    main_article = choose_main_article(parser.article_candidates)

    title = _pick_title(main_article=main_article, parser=parser, article_json=primary_article_json)
    byline = _pick_byline(parser=parser, article_json=primary_article_json, main_article=main_article)
    pubdate = _pick_pubdate(parser=parser, article_json=primary_article_json, main_article=main_article)
    text, text_blocks_count = _pick_text(
        title=title,
        parser=parser,
        article_json=primary_article_json,
        main_article=main_article,
    )

    image_urls = _pick_image_urls(
        page_url=final_url,
        parser=parser,
        article_json=primary_article_json,
        main_article=main_article,
    )[:max_images]
    video_urls = _pick_video_urls(
        page_url=final_url,
        parser=parser,
        article_json_nodes=ldjson_nodes,
        main_article=main_article,
        html_source=html,
    )[:max_videos]

    create_project_layout(project_dir, force=force)

    image_results: list[MediaResult] = []
    video_results: list[MediaResult] = []

    for index, media_url in enumerate(image_urls, start=1):
        provisional_name = _filename_for_url(media_url, kind="image", index=index)
        provisional_path = project_dir / "input" / "images" / provisional_name
        try:
            content_type = download_media(media_url, provisional_path, timeout=timeout, referer=final_url)
        except WebImportError as exc:
            print(f"[warn] could not download image: {media_url} ({exc})", file=sys.stderr)
            continue

        final_name = _filename_for_url(media_url, kind="image", index=index, content_type=content_type)
        if final_name != provisional_name:
            final_path = project_dir / "input" / "images" / final_name
            provisional_path.replace(final_path)
        else:
            final_path = provisional_path

        image_results.append(MediaResult(rel_path=f"images/{final_path.name}", byline=None))

    for index, media_url in enumerate(video_urls, start=1):
        provisional_name = _filename_for_url(media_url, kind="video", index=index)
        provisional_path = project_dir / "input" / "videos" / provisional_name
        try:
            content_type = download_media(media_url, provisional_path, timeout=timeout, referer=final_url)
        except WebImportError as exc:
            print(f"[warn] could not download video: {media_url} ({exc})", file=sys.stderr)
            continue

        final_name = _filename_for_url(media_url, kind="video", index=index, content_type=content_type)
        if final_name != provisional_name:
            final_path = project_dir / "input" / "videos" / final_name
            provisional_path.replace(final_path)
        else:
            final_path = provisional_path

        video_results.append(MediaResult(rel_path=f"videos/{final_path.name}", byline=None))

    article_payload: dict[str, Any] = {
        "title": title,
        "byline": byline,
        "pubdate": pubdate,
        "text": text,
        "images": [{"path": item.rel_path, "byline": item.byline} for item in image_results],
        "videos": [
            {
                "path": item.rel_path,
                "byline": item.byline,
                "start_from": item.start_from,
                "end_at": item.end_at,
            }
            for item in video_results
        ],
    }

    web_source_payload: dict[str, Any] = {
        "requestedUrl": url,
        "finalUrl": final_url,
        "responseHeaders": response_headers,
        "metaFirst": parser.meta_first,
        "metaAll": parser.meta_all,
        "titleTag": parser.title_text,
        "h1Candidates": parser.h1_texts,
        "ldjsonNodeCount": len(ldjson_nodes),
        "primaryArticleJson": primary_article_json,
        "selectedMainArticle": {
            "paragraphCount": len(main_article.paragraphs) if main_article else 0,
            "h1Count": len(main_article.h1s) if main_article else 0,
            "imageCount": len(main_article.image_urls) if main_article else 0,
            "videoCount": len(main_article.video_urls) if main_article else 0,
            "bylineCandidates": main_article.bylines if main_article else [],
            "timeCandidates": main_article.times if main_article else [],
        },
        "selectedMediaUrls": {
            "images": image_urls,
            "videos": video_urls,
        },
    }

    generation_manifest = build_generation_manifest(canonical_project_id)

    (project_dir / "generation.json").write_text(
        json.dumps(generation_manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (project_dir / "input" / "article.json").write_text(
        json.dumps(article_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (project_dir / "working" / "web_source.json").write_text(
        json.dumps(web_source_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Created project: {canonical_project_id}")
    print(f"Path: {project_dir}")
    print(f"Text blocks: {text_blocks_count}")
    print(f"Images downloaded: {len(image_results)}")
    print(f"Videos downloaded: {len(video_results)}")

    return project_dir


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch article text/media directly from a web URL and create a project folder.",
    )
    parser.add_argument("url", help="Public article URL")
    parser.add_argument(
        "--project-id",
        dest="project_id",
        default=None,
        help="Optional project id",
    )
    parser.add_argument(
        "--projects-root",
        dest="projects_root",
        default="projects",
        help="Projects root directory (default: projects)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=REQUEST_TIMEOUT_SECONDS,
        help=f"Request timeout in seconds (default: {REQUEST_TIMEOUT_SECONDS})",
    )
    parser.add_argument(
        "--max-images",
        type=int,
        default=12,
        help="Maximum images to download (default: 12)",
    )
    parser.add_argument(
        "--max-videos",
        type=int,
        default=4,
        help="Maximum videos to download (default: 4)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace project directory if it exists",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    try:
        import_web_article(
            url=args.url,
            project_id=args.project_id,
            projects_root=Path(args.projects_root),
            timeout=args.timeout,
            force=args.force,
            max_images=max(args.max_images, 0),
            max_videos=max(args.max_videos, 0),
        )
    except WebImportError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

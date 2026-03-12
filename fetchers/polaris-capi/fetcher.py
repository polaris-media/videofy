#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

CAPI_BASE_URL = "https://content.api.plan3.se/entities/v1"
NEWSROOMS_DIRECTORY_URL = "https://micro.fvn.no/newsrooms?extended"
REQUEST_TIMEOUT_SECONDS = 45
USER_AGENT = "videofy-minimal-fetch-polaris-capi/1.0"
MAX_IMAGES = 12
MAX_VIDEOS = 4
DEFAULT_POLARIS_IMAGE_WIDTH = 1600
POLARIS_IMAGE_BASE_URL = "https://vcdn.polarismedia.no"
POLARIS_SRCSET_WIDTHS = [160, 350, 450, 650, 1000, 1200, 1600, 2000]

FALLBACK_NEWSROOM_ENTRIES = [
    ("adresseavisen", "adressa.no"),
    ("aesby", "aesby.no"),
    ("agderdebatt", "agderdebatt.no"),
    ("agderposten", "agderposten.no"),
    ("altaposten", "altaposten.no"),
    ("andalsnes", "andalsnes-avis.no"),
    ("askoyvaringen", "av-avis.no"),
    ("bladet", "bladet.no"),
    ("bomlonytt", "bomlo-nytt.no"),
    ("banett", "banett.no"),
    ("bygdanytt", "bygdanytt.no"),
    ("dolen", "dolen.no"),
    ("driva", "driva.no"),
    ("fvn", "fvn.no"),
    ("fitjarposten", "fitjarposten.no"),
    ("fjordabladet", "fjordabladet.no"),
    ("fjt", "fjt.no"),
    ("fjordingen", "fjordingen.no"),
    ("fjuken", "fjuken.no"),
    ("folkebladet", "folkebladet.no"),
    ("fosnafolket", "fosna-folket.no"),
    ("framtidinord", "framtidinord.no"),
    ("froya", "avisafroya.no"),
    ("gauldalsposten", "gauldalsposten.no"),
    ("gat", "gat.no"),
    ("hallingdolen", "hallingdolen.no"),
    ("ht", "ht.no"),
    ("hitrafroya", "hitra-froya.no"),
    ("innherred", "innherred.no"),
    ("itromso", "itromso.no"),
    ("klabuposten", "klebuposten.no"),
    ("kulingen", "kulingen.no"),
    ("kystogfjord", "kystogfjord.no"),
    ("lp", "lp.no"),
    ("lindesnes", "l-a.no"),
    ("farsund", "lister24.no"),
    ("marsteinen", "marsteinen.no"),
    ("mn24", "mn24.no"),
    ("morenytt", "morenytt.no"),
    ("nearadio", "nearadio.no"),
    ("nyss", "nyss.no"),
    ("opp", "opp.no"),
    ("oyposten", "oyposten.no"),
    ("avisast", "avisa-st.no"),
    ("porten", "porten.no"),
    ("randaberg24", "randaberg24.no"),
    ("rbnett", "rbnett.no"),
    ("setesdolen", "setesdolen.no"),
    ("steinkjer", "steinkjer24.no"),
    ("stjordalsnytt", "s-n.no"),
    ("stord24", "stord24.no"),
    ("strilen", "strilen.no"),
    ("sunnhordland", "sunnhordland.no"),
    ("smpno", "smp.no"),
    ("trd", "trdby.adressa.no"),
    ("tronderbladet", "tronderbladet.no"),
    ("vaganavisa", "vaganavisa.no"),
    ("varden", "varden.no"),
    ("venneslatidende", "venneslatidende.no"),
    ("vestlandsnytt", "vestlandsnytt.no"),
    ("vestnytt", "vestnytt.no"),
    ("vigga", "vigga.no"),
    ("vikebladet", "vikebladet.no"),
    ("vol", "vol.no"),
]
MANUAL_NEWSROOM_ALIASES = {
    "adressa": "adresseavisen",
    "smp": "smpno",
}
_cached_newsroom_index: tuple[dict[str, str], dict[str, str]] | None = None

TEXTUAL_COMPONENT_HINTS = {
    "body",
    "content",
    "description",
    "factbox",
    "heading",
    "intro",
    "lead",
    "paragraph",
    "quote",
    "subheadline",
    "summary",
    "text",
}
TEXT_VALUE_KEYS = {
    "body",
    "content",
    "description",
    "excerpt",
    "html",
    "intro",
    "lead",
    "summary",
    "subtitle",
    "text",
    "value",
}
DIRECT_TEXT_KEYS = {
    "description",
    "excerpt",
    "intro",
    "lead",
    "summary",
    "subtitle",
}
URL_KEYS = {
    "contenturl",
    "downloadurl",
    "fileurl",
    "href",
    "masterurl",
    "main",
    "mp4",
    "originalurl",
    "poster",
    "preview",
    "publicurl",
    "snapshots",
    "src",
    "streamurl",
    "thumbnailurl",
    "uri",
    "url",
}
MEDIA_CREDIT_KEYS = {
    "byline",
    "captionbyline",
    "credit",
    "credits",
    "creator",
    "photographer",
    "source",
}
IMAGE_HINT_KEYS = {
    "crop",
    "image",
    "images",
    "photo",
    "photos",
    "picture",
    "pictures",
    "thumbnail",
}
VIDEO_HINT_KEYS = {
    "clip",
    "clips",
    "stream",
    "streams",
    "video",
    "videos",
}
BLOCKED_MEDIA_PATH_SEGMENTS = {
    "author",
    "authors",
    "person",
    "persons",
    "profile",
    "profiles",
    "reporter",
    "reporters",
    "writer",
    "writers",
}
DATE_KEY_HINTS = ("date", "published", "updated", "created", "time")


class PolarisCapiImportError(Exception):
    pass


@dataclass(frozen=True)
class ArticleRef:
    article_id: str
    newsroom: str
    source_url: str | None = None


@dataclass
class RemoteMediaCandidate:
    url: str
    byline: str | None
    kind: str
    width: int | None = None
    height: int | None = None
    aspect_ratio: float | None = None
    alt: str | None = None
    srcset: str | None = None


@dataclass
class MediaResult:
    rel_path: str
    byline: str | None
    start_from: float | None = None
    end_at: float | None = None


@dataclass
class ParsedArticle:
    title: str
    byline: str
    pubdate: str
    text: str
    images: list[RemoteMediaCandidate] = field(default_factory=list)
    videos: list[RemoteMediaCandidate] = field(default_factory=list)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        if value and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def sanitize_project_id(raw: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._")
    if not candidate:
        raise PolarisCapiImportError("Could not derive a valid project id")
    if not candidate[0].isalnum():
        candidate = f"p-{candidate}"
    return candidate


def derive_project_id(newsroom: str, article_id: str, project_id: str | None) -> str:
    if project_id:
        return sanitize_project_id(project_id)
    return sanitize_project_id(f"polaris-{newsroom}-{article_id}".lower())


def _normalize_lookup_value(value: str) -> str:
    normalized = value.strip().casefold()
    normalized = re.sub(r"^https?://", "", normalized)
    normalized = normalized.split("/", 1)[0]
    normalized = normalized.split("?", 1)[0]
    normalized = normalized.split("#", 1)[0]
    normalized = normalized.split(":", 1)[0]
    if normalized.startswith("www."):
        normalized = normalized[4:]
    return normalized


def _compact_lookup_value(value: str) -> str:
    return "".join(ch for ch in _normalize_lookup_value(value) if ch.isalnum())


def _http_get_json_any(url: str, headers: dict[str, str], timeout: int) -> Any:
    req = Request(url=url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:600]
        raise PolarisCapiImportError(f"HTTP {exc.code} from {url}: {details}") from exc
    except URLError as exc:
        raise PolarisCapiImportError(f"Request failed for {url}: {exc.reason}") from exc

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise PolarisCapiImportError(f"Invalid JSON response from {url}") from exc


def _fetch_newsroom_directory(timeout: int) -> list[tuple[str, str]]:
    payload = _http_get_json_any(
        NEWSROOMS_DIRECTORY_URL,
        headers={
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
        timeout=timeout,
    )
    if not isinstance(payload, list):
        raise PolarisCapiImportError(
            f"Expected newsroom list from {NEWSROOMS_DIRECTORY_URL}, got {type(payload).__name__}"
        )

    entries: list[tuple[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        newsroom_raw = item.get("newsroom")
        domain_raw = item.get("domain")
        if not isinstance(newsroom_raw, str) or not isinstance(domain_raw, str):
            continue
        newsroom = _normalize_lookup_value(newsroom_raw)
        domain = _normalize_lookup_value(domain_raw)
        if not newsroom or not domain:
            continue
        entries.append((newsroom, domain))

    if not entries:
        raise PolarisCapiImportError(
            f"No newsroom entries returned from {NEWSROOMS_DIRECTORY_URL}"
        )
    return entries


def _build_newsroom_index(
    entries: list[tuple[str, str]],
) -> tuple[dict[str, str], dict[str, str]]:
    alias_to_newsroom: dict[str, str] = {}
    domain_to_newsroom: dict[str, str] = {}

    for newsroom, domain in entries:
        normalized_newsroom = _normalize_lookup_value(newsroom)
        normalized_domain = _normalize_lookup_value(domain)
        if not normalized_newsroom or not normalized_domain:
            continue

        domain_to_newsroom[normalized_domain] = normalized_newsroom
        for alias in (
            normalized_newsroom,
            normalized_domain,
            normalized_domain.removesuffix(".no"),
            _compact_lookup_value(normalized_newsroom),
            _compact_lookup_value(normalized_domain),
        ):
            if alias:
                alias_to_newsroom[alias] = normalized_newsroom

    alias_to_newsroom.update(MANUAL_NEWSROOM_ALIASES)
    return alias_to_newsroom, domain_to_newsroom


def _get_newsroom_index(timeout: int) -> tuple[dict[str, str], dict[str, str]]:
    global _cached_newsroom_index

    if _cached_newsroom_index is not None:
        return _cached_newsroom_index

    try:
        entries = _fetch_newsroom_directory(timeout)
    except PolarisCapiImportError:
        entries = FALLBACK_NEWSROOM_ENTRIES

    _cached_newsroom_index = _build_newsroom_index(entries)
    return _cached_newsroom_index


def normalize_newsroom(value: str | None, timeout: int) -> str | None:
    if value is None:
        return None
    candidate = _normalize_lookup_value(value)
    if not candidate:
        return None
    alias_to_newsroom, _domain_to_newsroom = _get_newsroom_index(timeout)
    normalized = alias_to_newsroom.get(candidate) or alias_to_newsroom.get(
        _compact_lookup_value(candidate)
    )
    if normalized is None:
        raise PolarisCapiImportError(
            f"Unsupported newsroom '{value}'. "
            f"Fetcher uses newsroom slugs from {NEWSROOMS_DIRECTORY_URL}"
        )
    return normalized


def infer_newsroom_from_host(hostname: str, timeout: int) -> str | None:
    host = _normalize_lookup_value(hostname)
    if not host:
        return None
    _alias_to_newsroom, domain_to_newsroom = _get_newsroom_index(timeout)
    for domain, newsroom in domain_to_newsroom.items():
        if host == domain or host.endswith(f".{domain}"):
            return newsroom
    return None


def extract_article_id_from_url(url: str) -> str:
    parsed = urlparse(url)
    segments = [segment for segment in parsed.path.split("/") if segment]
    for marker in ("i", "a"):
        if marker in segments:
            index = segments.index(marker)
            if index + 1 < len(segments):
                return segments[index + 1]

    if len(segments) >= 2:
        candidate = segments[-2]
        if re.fullmatch(r"[A-Za-z0-9_-]+", candidate):
            return candidate

    raise PolarisCapiImportError(f"Could not extract article id from URL: {url}")


def resolve_article_ref(article_ref: str, newsroom_override: str | None, timeout: int) -> ArticleRef:
    raw = article_ref.strip()
    if not raw:
        raise PolarisCapiImportError("Article URL or ID is empty")

    normalized_newsroom = normalize_newsroom(newsroom_override, timeout=timeout)
    parsed = urlparse(raw)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        inferred_newsroom = infer_newsroom_from_host(parsed.netloc, timeout=timeout)
        newsroom = normalized_newsroom or inferred_newsroom
        if newsroom is None:
            raise PolarisCapiImportError(
                "Could not infer newsroom from URL. "
                f"Fetcher uses the directory from {NEWSROOMS_DIRECTORY_URL}. "
                "You can also provide --newsroom."
            )
        article_id = extract_article_id_from_url(raw)
        return ArticleRef(article_id=article_id, newsroom=newsroom, source_url=raw)

    if normalized_newsroom is None:
        raise PolarisCapiImportError(
            "When using a raw article id, you must also provide --newsroom."
        )

    if not re.fullmatch(r"[A-Za-z0-9_-]+", raw):
        raise PolarisCapiImportError(
            "Article id may only contain letters, numbers, underscore or hyphen."
        )
    return ArticleRef(article_id=raw, newsroom=normalized_newsroom, source_url=None)


def get_capi_credentials() -> tuple[str, str]:
    load_env_file(repo_root() / ".env")
    username = os.getenv("CAPI_USERNAME", "").strip()
    password = os.getenv("CAPI_PASSWORD", "").strip()
    if not username:
        raise PolarisCapiImportError("Missing environment variable: CAPI_USERNAME")
    if not password:
        raise PolarisCapiImportError("Missing environment variable: CAPI_PASSWORD")
    return username, password


def _basic_auth_header(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def _should_send_auth_header(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host == "content.api.plan3.se" or host.endswith(".plan3.se")


def _http_get_json(url: str, headers: dict[str, str], timeout: int) -> dict[str, Any]:
    payload = _http_get_json_any(url, headers=headers, timeout=timeout)
    if not isinstance(payload, dict):
        raise PolarisCapiImportError(
            f"Expected JSON object from {url}, got {type(payload).__name__}"
        )
    return payload


def fetch_article_json(article_ref: ArticleRef, timeout: int) -> dict[str, Any]:
    username, password = get_capi_credentials()
    request_url = (
        f"{CAPI_BASE_URL}/{article_ref.newsroom}/article/{article_ref.article_id}?format=v5"
    )
    return _http_get_json(
        request_url,
        headers={
            "Accept": "application/json",
            "Authorization": _basic_auth_header(username, password),
            "User-Agent": USER_AGENT,
        },
        timeout=timeout,
    )


def _normalize_text(raw: str) -> str:
    text = unescape(raw)
    text = re.sub(r"(?is)<script.*?>.*?</script>", "", text)
    text = re.sub(r"(?is)<style.*?>.*?</style>", "", text)
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*p\s*>", "\n\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized_lines = [re.sub(r"\s+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(normalized_lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _normalize_inline_text(raw: str) -> str:
    return re.sub(r"\s+", " ", unescape(raw)).strip()


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        clean = value.strip()
        if not clean or clean in seen:
            continue
        output.append(clean)
        seen.add(clean)
    return output


def _is_http_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def _safe_query_width(url: str) -> int | None:
    parsed = urlparse(url)
    query = parsed.query
    match = re.search(r"(?:^|[?&])(w|width)=(\d+)(?:&|$)", f"?{query}")
    if not match:
        return None
    try:
        return int(match.group(2))
    except ValueError:
        return None


def _looks_like_real_image(url: str) -> bool:
    lower = url.lower()
    if any(token in lower for token in ("placeholder", "/logo", "/icons/", "favicon")):
        return False
    width = _safe_query_width(url)
    if width is not None and width < 160:
        return False
    return True


def _looks_like_supported_video(url: str) -> bool:
    return re.search(r"\.(mp4|mov|webm)(?:[?#]|$)", url.lower()) is not None


def _looks_like_image_url(url: str) -> bool:
    return re.search(r"\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)", url.lower()) is not None


def _resolve_path(node: Any, path: tuple[str, ...]) -> Any:
    current = node
    for part in path:
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _coerce_positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        candidate = int(value)
        return candidate if candidate > 0 else None
    return None


def _extract_image_size(asset: dict[str, Any]) -> tuple[int | None, int | None]:
    raw_size = asset.get("size")
    if isinstance(raw_size, dict):
        width = _coerce_positive_int(raw_size.get("width"))
        height = _coerce_positive_int(raw_size.get("height"))
        return width, height
    return None, None


def _build_polaris_image_url(
    asset: dict[str, Any],
    *,
    width: int,
    fit: str = "clip",
    height: int | None = None,
    q: int = 80,
    tight: bool = False,
) -> str | None:
    direct_url = asset.get("url")
    if isinstance(direct_url, str):
        normalized = _normalize_media_url(direct_url, "")
        if normalized:
            return normalized

    main = asset.get("main")
    if isinstance(main, str) and not asset.get("id"):
        normalized = _normalize_media_url(main, "")
        if normalized:
            return normalized

    asset_id = asset.get("id")
    if not isinstance(asset_id, str) or not asset_id.strip():
        return None

    normalized_width = max(1, round(width))
    url = (
        f"{POLARIS_IMAGE_BASE_URL}/{asset_id}"
        f"?fit={fit}&q={q}&tight={'true' if tight else 'false'}&w={normalized_width}"
    )
    if fit == "crop" and height:
        url += f"&h={max(1, round(height))}"
    return url


def _build_polaris_srcset(asset: dict[str, Any]) -> str | None:
    variants = []
    for width in POLARIS_SRCSET_WIDTHS:
        url = _build_polaris_image_url(asset, width=width)
        if not url:
            continue
        variants.append(f"{url} {width}w")
    return ", ".join(variants) if variants else None


def _path_is_blocked_for_media(path: tuple[str, ...]) -> bool:
    return any(segment in BLOCKED_MEDIA_PATH_SEGMENTS for segment in path)


def _extract_string_values(value: Any) -> list[str]:
    results: list[str] = []
    if isinstance(value, str):
        normalized = _normalize_inline_text(value)
        if normalized:
            results.append(normalized)
        return results

    if isinstance(value, dict):
        for key in ("name", "title", "value", "displayName", "formatted"):
            if key in value:
                results.extend(_extract_string_values(value[key]))
        return results

    if isinstance(value, list):
        for item in value:
            results.extend(_extract_string_values(item))
        return results

    return results


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


def _join_byline(names: list[str]) -> str:
    deduped = _unique_keep_order(names)
    if not deduped:
        return ""
    if len(deduped) == 1:
        return f"Av {deduped[0]}"
    return f"Av {', '.join(deduped[:-1])} og {deduped[-1]}"


def _extract_title(article: dict[str, Any], article_id: str) -> str:
    title_paths = [
        ("title", "value"),
        ("title",),
        ("headline", "value"),
        ("headline",),
        ("presentationTitle", "value"),
        ("presentationTitle",),
        ("seoTitle",),
        ("name",),
    ]
    for path in title_paths:
        value = _resolve_path(article, path)
        if isinstance(value, str):
            normalized = _normalize_inline_text(value)
            if normalized:
                return normalized
    return article_id


def _extract_byline(article: dict[str, Any]) -> str:
    byline_values: list[str] = []
    for path in (
        ("byline",),
        ("authors",),
        ("author",),
        ("credits",),
        ("credit",),
    ):
        byline_values.extend(_extract_string_values(_resolve_path(article, path)))

    cleaned = []
    for value in byline_values:
        candidate = _clean_byline_candidate(value)
        if candidate:
            cleaned.append(candidate)
    return _join_byline(cleaned)


def _looks_like_datetime(value: str) -> bool:
    return bool(
        re.search(
            r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?",
            value,
        )
    )


def _find_first_date_like(node: Any) -> str | None:
    if isinstance(node, dict):
        for key, value in node.items():
            lower = key.lower()
            if isinstance(value, str) and any(hint in lower for hint in DATE_KEY_HINTS):
                if _looks_like_datetime(value):
                    return value.strip()
        for value in node.values():
            match = _find_first_date_like(value)
            if match:
                return match
    elif isinstance(node, list):
        for item in node:
            match = _find_first_date_like(item)
            if match:
                return match
    return None


def _extract_pubdate(article: dict[str, Any]) -> str:
    for path in (
        ("published",),
        ("publishTime",),
        ("publishingTime",),
        ("publicationTime",),
        ("updated",),
        ("updatedAt",),
        ("createdAt",),
    ):
        value = _resolve_path(article, path)
        if isinstance(value, str) and _looks_like_datetime(value):
            return value.strip()

    recursive_match = _find_first_date_like(article)
    if recursive_match:
        return recursive_match
    return utc_now_iso()


def _media_kind_from_hint_values(values: list[str]) -> str | None:
    hint = " ".join(value.lower() for value in values if value)
    if not hint:
        return None
    if any(token in hint for token in ("video", "clip", "mp4", "mov", "webm")):
        return "video"
    if any(token in hint for token in ("image", "photo", "picture", "jpeg", "jpg", "png", "webp", "gif")):
        return "image"
    return None


def _media_kind_from_key(key: str) -> str | None:
    lower = key.lower()
    if any(token in lower for token in VIDEO_HINT_KEYS):
        return "video"
    if any(token in lower for token in IMAGE_HINT_KEYS):
        return "image"
    return None


def _media_kind_from_dict(node: dict[str, Any], path: tuple[str, ...]) -> str | None:
    hint_values: list[str] = list(path)
    for key in ("type", "kind", "contentType", "mediaType", "mimeType", "assetType", "role"):
        value = node.get(key)
        if isinstance(value, str):
            hint_values.append(value)
    return _media_kind_from_hint_values(hint_values)


def _extract_media_byline(node: dict[str, Any]) -> str | None:
    candidates: list[str] = []
    for key in MEDIA_CREDIT_KEYS:
        if key in node:
            candidates.extend(_extract_string_values(node.get(key)))
    for value in candidates:
        candidate = _clean_byline_candidate(value)
        if candidate:
            return candidate
    return None


def _extract_image_candidate_from_dict(
    node: dict[str, Any],
    *,
    media_byline: str | None,
    local_kind: str | None,
    path: tuple[str, ...],
) -> RemoteMediaCandidate | None:
    if local_kind != "image" or _path_is_blocked_for_media(path):
        return None

    width, height = _extract_image_size(node)
    preferred_width = DEFAULT_POLARIS_IMAGE_WIDTH
    if width:
        preferred_width = min(width, DEFAULT_POLARIS_IMAGE_WIDTH)

    image_url = _build_polaris_image_url(
        node,
        width=preferred_width,
    )
    if not image_url or not _looks_like_real_image(image_url):
        return None

    aspect_ratio = None
    if width and height:
        aspect_ratio = width / height

    alt_values = _extract_string_values(node.get("alt"))
    alt = alt_values[0] if alt_values else None

    return RemoteMediaCandidate(
        url=image_url,
        byline=media_byline,
        kind="image",
        width=width,
        height=height,
        aspect_ratio=aspect_ratio,
        alt=alt,
        srcset=_build_polaris_srcset(node),
    )


def _iter_text_blocks(node: Any, path: tuple[str, ...] = ()) -> list[str]:
    results: list[str] = []

    if isinstance(node, dict):
        kind_hint = _media_kind_from_dict(node, path)
        component_hint = " ".join(
            str(node.get(key, "")).lower() for key in ("type", "kind", "contentType", "role")
        )
        component_is_textual = any(token in component_hint for token in TEXTUAL_COMPONENT_HINTS)

        for key, value in node.items():
            lower = key.lower()
            if isinstance(value, str):
                normalized = _normalize_text(value)
                if not normalized:
                    continue
                if lower in DIRECT_TEXT_KEYS:
                    results.append(normalized)
                    continue
                if kind_hint is not None:
                    continue
                if lower in TEXT_VALUE_KEYS and (
                    component_is_textual
                    or any(segment in {"body", "content", "contents", "elements", "items", "blocks"} for segment in path)
                ):
                    results.append(normalized)
            elif isinstance(value, (dict, list)):
                results.extend(_iter_text_blocks(value, path + (lower,)))

    elif isinstance(node, list):
        for item in node:
            results.extend(_iter_text_blocks(item, path))

    return results


def _collect_long_text_fallback(node: Any, path: tuple[str, ...] = ()) -> list[str]:
    results: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            lower = key.lower()
            if isinstance(value, str):
                if lower in URL_KEYS:
                    continue
                normalized = _normalize_text(value)
                if len(normalized) >= 40 and not _is_http_url(normalized):
                    results.append(normalized)
            elif isinstance(value, (dict, list)):
                results.extend(_collect_long_text_fallback(value, path + (lower,)))
    elif isinstance(node, list):
        for item in node:
            results.extend(_collect_long_text_fallback(item, path))
    return results


def _normalize_media_url(value: str, base_url: str) -> str | None:
    candidate = unescape(value).strip()
    candidate = candidate.replace("\\/", "/").strip("\"'`")
    if not candidate:
        return None
    if candidate.startswith("data:"):
        return None
    full = urljoin(base_url, candidate)
    if not _is_http_url(full):
        return None
    return full


def _collect_media_candidates(
    node: Any,
    *,
    base_url: str,
    path: tuple[str, ...] = (),
    inherited_kind: str | None = None,
) -> tuple[list[RemoteMediaCandidate], list[RemoteMediaCandidate]]:
    image_results: list[RemoteMediaCandidate] = []
    video_results: list[RemoteMediaCandidate] = []

    if isinstance(node, dict):
        local_kind = inherited_kind or _media_kind_from_dict(node, path)
        media_byline = _extract_media_byline(node)
        direct_image_candidate = _extract_image_candidate_from_dict(
            node,
            media_byline=media_byline,
            local_kind=local_kind,
            path=path,
        )
        if direct_image_candidate is not None:
            image_results.append(direct_image_candidate)

        for key, value in node.items():
            lower = key.lower()
            key_kind = _media_kind_from_key(lower)
            next_kind = key_kind or local_kind

            if isinstance(value, str) and lower in URL_KEYS:
                media_url = _normalize_media_url(value, base_url)
                if not media_url:
                    continue

                resolved_kind = next_kind
                if resolved_kind is None:
                    if _looks_like_supported_video(media_url):
                        resolved_kind = "video"
                    elif _looks_like_image_url(media_url):
                        resolved_kind = "image"

                if resolved_kind == "video":
                    if _looks_like_supported_video(media_url):
                        video_results.append(
                            RemoteMediaCandidate(url=media_url, byline=media_byline, kind="video")
                        )
                elif resolved_kind == "image":
                    if _looks_like_real_image(media_url) and not _path_is_blocked_for_media(
                        path + (lower,)
                    ):
                        image_results.append(
                            RemoteMediaCandidate(url=media_url, byline=media_byline, kind="image")
                        )
            elif isinstance(value, (dict, list)):
                child_images, child_videos = _collect_media_candidates(
                    value,
                    base_url=base_url,
                    path=path + (lower,),
                    inherited_kind=next_kind,
                )
                for candidate in child_images:
                    if candidate.byline is None and media_byline:
                        candidate.byline = media_byline
                for candidate in child_videos:
                    if candidate.byline is None and media_byline:
                        candidate.byline = media_byline
                image_results.extend(child_images)
                video_results.extend(child_videos)

    elif isinstance(node, list):
        for item in node:
            if isinstance(item, str) and inherited_kind:
                media_url = _normalize_media_url(item, base_url)
                if not media_url:
                    continue
                if inherited_kind == "video" and _looks_like_supported_video(media_url):
                    video_results.append(
                        RemoteMediaCandidate(url=media_url, byline=None, kind="video")
                    )
                    continue
                if (
                    inherited_kind == "image"
                    and _looks_like_real_image(media_url)
                    and not _path_is_blocked_for_media(path)
                ):
                    image_results.append(
                        RemoteMediaCandidate(url=media_url, byline=None, kind="image")
                    )
                    continue
            child_images, child_videos = _collect_media_candidates(
                item,
                base_url=base_url,
                path=path,
                inherited_kind=inherited_kind,
            )
            image_results.extend(child_images)
            video_results.extend(child_videos)

    return image_results, video_results


def _dedupe_media_candidates(
    candidates: list[RemoteMediaCandidate],
    *,
    limit: int,
) -> list[RemoteMediaCandidate]:
    seen: set[str] = set()
    output: list[RemoteMediaCandidate] = []
    for candidate in candidates:
        if candidate.url in seen:
            continue
        seen.add(candidate.url)
        output.append(candidate)
        if len(output) >= limit:
            break
    return output


def parse_article_payload(
    article: dict[str, Any],
    article_ref: ArticleRef,
) -> ParsedArticle:
    title = _extract_title(article, article_ref.article_id)
    byline = _extract_byline(article)
    pubdate = _extract_pubdate(article)

    text_blocks = _iter_text_blocks(article)
    if not text_blocks:
        text_blocks = _collect_long_text_fallback(article)
    text_blocks = [block for block in _unique_keep_order(text_blocks) if block != title]
    text = "\n\n".join(text_blocks).strip() if text_blocks else title

    request_url = (
        f"{CAPI_BASE_URL}/{article_ref.newsroom}/article/{article_ref.article_id}?format=v5"
    )
    image_candidates, video_candidates = _collect_media_candidates(article, base_url=request_url)

    return ParsedArticle(
        title=title,
        byline=byline,
        pubdate=pubdate,
        text=text,
        images=_dedupe_media_candidates(image_candidates, limit=MAX_IMAGES),
        videos=_dedupe_media_candidates(video_candidates, limit=MAX_VIDEOS),
    )


def _ext_from_content_type(content_type: str | None, kind: str) -> str:
    if not content_type:
        return ".mp4" if kind == "video" else ".jpg"

    lookup = {
        "image/gif": ".gif",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
        "video/webm": ".webm",
    }

    return lookup.get(content_type.split(";", 1)[0].strip().lower(), ".mp4" if kind == "video" else ".jpg")


def _filename_for_url(
    url: str,
    *,
    kind: str,
    index: int,
    content_type: str | None = None,
) -> str:
    parsed = urlparse(url)
    basename = Path(parsed.path).name
    ext = ""

    if basename and "." in basename:
        suffix = Path(basename).suffix.lower()
        if re.fullmatch(r"\.[a-z0-9]{1,6}", suffix):
            ext = suffix

    if not ext:
        ext = _ext_from_content_type(content_type, kind)

    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{kind}-{index:03}-{digest}{ext}"


def _download_binary(
    url: str,
    target_file: Path,
    *,
    timeout: int,
    auth_header: str,
) -> str | None:
    headers = {
        "User-Agent": USER_AGENT,
    }
    if auth_header and _should_send_auth_header(url):
        headers["Authorization"] = auth_header

    req = Request(
        url=url,
        headers=headers,
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


def download_media(
    candidate: RemoteMediaCandidate,
    *,
    project_dir: Path,
    index: int,
    timeout: int,
    auth_header: str,
) -> MediaResult:
    folder = "videos" if candidate.kind == "video" else "images"
    kind = "video" if candidate.kind == "video" else "image"
    target_dir = project_dir / "input" / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    provisional_name = _filename_for_url(candidate.url, kind=kind, index=index)
    provisional_path = target_dir / provisional_name

    try:
        content_type = _download_binary(
            candidate.url,
            provisional_path,
            timeout=timeout,
            auth_header=auth_header,
        )
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:400]
        raise PolarisCapiImportError(
            f"Download failed ({exc.code}) for {candidate.url}: {details}"
        ) from exc
    except URLError as exc:
        raise PolarisCapiImportError(
            f"Download failed for {candidate.url}: {exc.reason}"
        ) from exc

    final_name = _filename_for_url(
        candidate.url,
        kind=kind,
        index=index,
        content_type=content_type,
    )
    if final_name != provisional_name:
        final_path = target_dir / final_name
        provisional_path.replace(final_path)
    else:
        final_path = provisional_path

    return MediaResult(rel_path=f"{folder}/{final_path.name}", byline=candidate.byline)


def build_generation_manifest(project_id: str) -> dict[str, Any]:
    now = utc_now_iso()
    return {
        "projectId": project_id,
        "brandId": "default",
        "promptPack": "default",
        "voicePack": "default",
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
            raise PolarisCapiImportError(
                f"Project directory already exists and is non-empty: {project_dir}. "
                "Use --force to replace it."
            )
        shutil.rmtree(project_dir)

    for rel in ("input/images", "input/videos", "working/uploads", "working/audio", "output"):
        (project_dir / rel).mkdir(parents=True, exist_ok=True)


def import_polaris_article(
    article_ref_raw: str,
    newsroom: str | None,
    project_id: str | None,
    projects_root: Path,
    timeout: int,
    force: bool,
) -> Path:
    article_ref = resolve_article_ref(article_ref_raw, newsroom, timeout=timeout)
    canonical_project_id = derive_project_id(
        article_ref.newsroom,
        article_ref.article_id,
        project_id,
    )
    project_dir = (projects_root / canonical_project_id).resolve()
    if not str(project_dir).startswith(str(projects_root.resolve())):
        raise PolarisCapiImportError(f"Unsafe project path resolved: {project_dir}")

    username, password = get_capi_credentials()
    auth_header = _basic_auth_header(username, password)
    source_payload = fetch_article_json(article_ref=article_ref, timeout=timeout)
    parsed_article = parse_article_payload(source_payload, article_ref)

    create_project_layout(project_dir, force=force)

    image_results: list[MediaResult] = []
    video_results: list[MediaResult] = []

    for index, candidate in enumerate(parsed_article.images, start=1):
        try:
            image_results.append(
                download_media(
                    candidate,
                    project_dir=project_dir,
                    index=index,
                    timeout=timeout,
                    auth_header=auth_header,
                )
            )
        except PolarisCapiImportError as exc:
            print(f"[warn] could not download image: {candidate.url} ({exc})", file=sys.stderr)

    for index, candidate in enumerate(parsed_article.videos, start=1):
        try:
            video_results.append(
                download_media(
                    candidate,
                    project_dir=project_dir,
                    index=index,
                    timeout=timeout,
                    auth_header=auth_header,
                )
            )
        except PolarisCapiImportError as exc:
            print(f"[warn] could not download video: {candidate.url} ({exc})", file=sys.stderr)

    article_payload: dict[str, Any] = {
        "title": parsed_article.title,
        "byline": parsed_article.byline,
        "pubdate": parsed_article.pubdate,
        "text": parsed_article.text,
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

    (project_dir / "generation.json").write_text(
        json.dumps(build_generation_manifest(canonical_project_id), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    (project_dir / "input" / "article.json").write_text(
        json.dumps(article_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (project_dir / "working" / "polaris_capi_source.json").write_text(
        json.dumps(
            {
                "articleId": article_ref.article_id,
                "newsroom": article_ref.newsroom,
                "sourceUrl": article_ref.source_url,
                "source": source_payload,
                "parsed": {
                    "title": parsed_article.title,
                    "byline": parsed_article.byline,
                    "pubdate": parsed_article.pubdate,
                    "textLength": len(parsed_article.text),
                    "imageCandidates": [
                        {
                            "url": item.url,
                            "byline": item.byline,
                            "width": item.width,
                            "height": item.height,
                            "aspectRatio": item.aspect_ratio,
                            "alt": item.alt,
                            "srcset": item.srcset,
                        }
                        for item in parsed_article.images
                    ],
                    "videoCandidates": [
                        {"url": item.url, "byline": item.byline}
                        for item in parsed_article.videos
                    ],
                },
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Created project: {canonical_project_id}")
    print(f"Path: {project_dir}")
    print(f"Images downloaded: {len(image_results)}")
    print(f"Videos downloaded: {len(video_results)}")
    return project_dir


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch a Polaris CAPI article and create a new minimal project folder.",
    )
    parser.add_argument(
        "article_ref",
        help="Supported Polaris article URL or raw article id",
    )
    parser.add_argument(
        "--newsroom",
        dest="newsroom",
        default=None,
        help="Optional newsroom override when using a raw article id (fvn, adresseavisen, smpno)",
    )
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
        "--force",
        action="store_true",
        help="Replace project directory if it exists",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        import_polaris_article(
            article_ref_raw=args.article_ref,
            newsroom=args.newsroom,
            project_id=args.project_id,
            projects_root=Path(args.projects_root),
            timeout=args.timeout,
            force=args.force,
        )
    except PolarisCapiImportError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

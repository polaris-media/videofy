#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

REUTERS_AUTH_URL = "https://auth.thomsonreuters.com/oauth/token"
REUTERS_GRAPHQL_URL = "https://api.reutersconnect.com/content/graphql"
REQUEST_TIMEOUT_SECONDS = 45


class ReutersImportError(Exception):
    pass


@dataclass
class DownloadedVideo:
    rel_path: str
    byline: str | None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sanitize_project_id(raw: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._")
    if not candidate:
        raise ReutersImportError("Could not derive a valid project id")
    if not candidate[0].isalnum():
        candidate = f"p-{candidate}"
    return candidate


def normalize_item_id(item_ref: str) -> str:
    raw = item_ref.strip()
    if not raw:
        raise ReutersImportError("Reuters item id is empty")

    if raw.startswith("tag:reuters.com,"):
        return raw

    if raw.startswith("tag%3Areuters.com%2C"):
        return unquote(raw)

    parsed = urlparse(raw)
    if parsed.scheme in {"http", "https"} and parsed.netloc.endswith("reutersconnect.com"):
        params = parse_qs(parsed.query or "")
        encoded_id = (params.get("id") or [None])[0]
        if encoded_id:
            decoded = unquote(encoded_id)
            if decoded.startswith("tag:reuters.com,"):
                return decoded

    if "tag%3Areuters.com" in raw:
        decoded = unquote(raw)
        if decoded.startswith("tag:reuters.com,"):
            return decoded

    raise ReutersImportError(
        "Unsupported Reuters id format. Use Reuters item id like "
        "'tag:reuters.com,2024:newsml_...:4' or a Reuters Connect discover URL."
    )


def _project_suffix_from_item_id(item_id: str) -> str:
    match = re.search(r"newsml[_:.-]?([A-Za-z0-9]+)", item_id)
    if match:
        return match.group(1).lower()
    return hashlib.sha1(item_id.encode("utf-8")).hexdigest()[:10]


def derive_project_id(item_id: str, project_id: str | None) -> str:
    if project_id:
        return sanitize_project_id(project_id)
    return sanitize_project_id(f"reuters-{_project_suffix_from_item_id(item_id)}")


def get_env_value(base_key: str) -> str | None:
    value = os.getenv(base_key)
    if value:
        return value.strip()
    return None


def require_env_value(base_key: str) -> str:
    value = get_env_value(base_key)
    if not value:
        raise ReutersImportError(f"Missing environment variable: {base_key}")
    return value


def _http_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
) -> dict[str, Any]:
    request_data = json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json", **headers}
    req = Request(url=url, data=request_data, headers=request_headers, method="POST")

    try:
        with urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            parsed = json.loads(body)
            if not isinstance(parsed, dict):
                raise ReutersImportError(f"Expected JSON object from {url}, got {type(parsed).__name__}")
            return parsed
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:600]
        raise ReutersImportError(f"HTTP {exc.code} from {url}: {details}") from exc
    except URLError as exc:
        raise ReutersImportError(f"Request failed for {url}: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise ReutersImportError(f"Invalid JSON response from {url}") from exc


def get_access_token(timeout: int) -> str:
    payload = {
        "client_id": require_env_value("REUTERS_CLIENT_ID"),
        "client_secret": require_env_value("REUTERS_CLIENT_SECRET"),
        "audience": require_env_value("REUTERS_AUDIENCE"),
        "grant_type": require_env_value("REUTERS_GRANT_TYPE"),
        "scope": require_env_value("REUTERS_SCOPE"),
    }

    response = _http_json(REUTERS_AUTH_URL, payload=payload, headers={}, timeout=timeout)
    token = response.get("access_token")
    if not isinstance(token, str) or not token:
        raise ReutersImportError("Reuters auth did not return access_token")
    return token


def graphql_request(token: str, query: str, variables: dict[str, Any], timeout: int) -> dict[str, Any]:
    response = _http_json(
        REUTERS_GRAPHQL_URL,
        payload={"query": query, "variables": variables},
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )

    errors = response.get("errors")
    if isinstance(errors, list) and errors:
        messages: list[str] = []
        for item in errors:
            if isinstance(item, dict):
                msg = item.get("message")
                if isinstance(msg, str) and msg.strip():
                    messages.append(msg.strip())
        detail = "; ".join(messages) if messages else json.dumps(errors, ensure_ascii=False)
        raise ReutersImportError(f"Reuters GraphQL error: {detail}")

    return response


def get_reuters_item(item_id: str, token: str, timeout: int) -> dict[str, Any]:
    query = """
    query GetItemById($id: ID!) {
      item(id: $id) {
        byLine
        versionCreated
        headLine
        caption
        bodyXhtml
        fragment
        slug
        intro
        usn
        versionedGuid
        renditions {
          mimeType
          uri
          type
          version
          code
          points
        }
        associations {
          renditions {
            mimeType
            uri
            type
            version
            code
            points
          }
        }
      }
    }
    """

    response = graphql_request(token=token, query=query, variables={"id": item_id}, timeout=timeout)
    data = response.get("data")
    if not isinstance(data, dict):
        raise ReutersImportError("Reuters GraphQL response missing data")
    item = data.get("item")
    if not isinstance(item, dict):
        raise ReutersImportError(f"No Reuters item found for id: {item_id}")
    return item


def request_download_url(item_id: str, rendition_id: str, token: str, timeout: int) -> str:
    mutation = """
    mutation DownloadVideo($itemId: ID!, $renditionId: ID!) {
      download(itemId: $itemId, renditionId: $renditionId) {
        ... on GenericItem {
          url
        }
      }
    }
    """
    response = graphql_request(
        token=token,
        query=mutation,
        variables={"itemId": item_id, "renditionId": rendition_id},
        timeout=timeout,
    )
    data = response.get("data")
    if not isinstance(data, dict):
        raise ReutersImportError("Reuters download response missing data")
    download = data.get("download")
    if not isinstance(download, dict):
        raise ReutersImportError("Reuters download response missing download object")
    url = download.get("url")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise ReutersImportError("Reuters download response did not include a valid URL")
    return url


def _select_best_video_rendition(item: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    associations = item.get("associations")
    if isinstance(associations, list):
        for association in associations:
            if not isinstance(association, dict):
                continue
            renditions = association.get("renditions")
            if isinstance(renditions, list):
                for rendition in renditions:
                    if isinstance(rendition, dict):
                        candidates.append(rendition)

    top_renditions = item.get("renditions")
    if isinstance(top_renditions, list):
        for rendition in top_renditions:
            if isinstance(rendition, dict):
                candidates.append(rendition)

    filtered = []
    for rendition in candidates:
        uri = rendition.get("uri")
        code = rendition.get("code")
        if isinstance(uri, str) and uri.strip() and isinstance(code, str) and code.lower().endswith(":mp4"):
            filtered.append(rendition)

    if not filtered:
        return None

    preferred_codes = {"MASTER", "CLEAN", "ORIGINAL", "SOURCE"}

    def ranked(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def score(row: dict[str, Any]) -> tuple[int, float]:
            code = str(row.get("code", "")).upper()
            version = row.get("version")
            version_num = float(version) if isinstance(version, (int, float)) else 0.0
            return (1 if code in preferred_codes else 0, version_num)

        return sorted(rows, key=score, reverse=True)

    tiers: list[list[dict[str, Any]]] = [
        [row for row in filtered if str(row.get("type", "")).upper() == "PRODUCTION"],
        [row for row in filtered if str(row.get("type", "")).upper() == "VIDEO"],
        [row for row in filtered if str(row.get("mimeType", "")).lower().startswith("video/")],
        [
            row
            for row in filtered
            if str(row.get("type", "")).upper() in {"PREVIEW", "SCREENER"}
        ],
    ]

    for tier in tiers:
        if tier:
            return ranked(tier)[0]

    return None


def _download_binary(url: str, target_file: Path, timeout: int) -> None:
    req = Request(
        url=url,
        headers={"User-Agent": "videofy-minimal-fetch-reuters/1.0"},
        method="GET",
    )
    with urlopen(req, timeout=timeout) as response:
        with tempfile.NamedTemporaryFile(delete=False, dir=target_file.parent) as tmp:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
            tmp_path = Path(tmp.name)
    tmp_path.replace(target_file)


def download_file(url: str, target_file: Path, timeout: int) -> None:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        _download_binary(url, target_file, timeout)
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:400]
        raise ReutersImportError(f"Download failed ({exc.code}) for {url}: {details}") from exc
    except URLError as exc:
        raise ReutersImportError(f"Download failed for {url}: {exc.reason}") from exc


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
            raise ReutersImportError(
                f"Project directory already exists and is non-empty: {project_dir}. "
                "Use --force to replace it."
            )
        shutil.rmtree(project_dir)

    for rel in ("input/images", "input/videos", "working/uploads", "working/audio", "output"):
        (project_dir / rel).mkdir(parents=True, exist_ok=True)


def _normalize_text(raw: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", "", raw)
    text = re.sub(r"(?is)<style.*?>.*?</style>", "", text)
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*p\s*>", "\n\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(re.sub(r"\s+", " ", line).strip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _clean_scalar(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    clean = _normalize_text(value)
    return clean or None


def _extract_newsml_text(item: dict[str, Any], item_id: str, token: str, timeout: int) -> str | None:
    renditions = item.get("renditions")
    if not isinstance(renditions, list):
        return None

    newsml_uri: str | None = None
    for rendition in renditions:
        if not isinstance(rendition, dict):
            continue
        if str(rendition.get("type", "")).upper() == "NEWSML":
            uri = rendition.get("uri")
            if isinstance(uri, str) and uri.strip():
                newsml_uri = uri
                break

    if not newsml_uri:
        return None

    download_url = request_download_url(item_id=item_id, rendition_id=newsml_uri, token=token, timeout=timeout)
    with tempfile.TemporaryDirectory(prefix="videofy-reuters-") as temp_dir:
        xml_path = Path(temp_dir) / "item.xml"
        download_file(download_url, xml_path, timeout=timeout)
        try:
            root = ET.parse(xml_path).getroot()
            ns = {"x": "http://www.w3.org/1999/xhtml"}
            html_element = root.find(".//x:html", ns)
            if html_element is None:
                return None
            xml_html = ET.tostring(html_element, encoding="unicode", method="xml")
            return _normalize_text(xml_html)
        except ET.ParseError:
            return None


def _compose_text(item: dict[str, Any], newsml_text: str | None) -> str:
    chunks: list[str] = []

    ordered_fields = [
        "caption",
        "intro",
        "bodyXhtml",
        "fragment",
        "headLine",
        "slug",
    ]
    for field in ordered_fields:
        value = _clean_scalar(item.get(field))
        if value and value not in chunks:
            chunks.append(value)

    if newsml_text and newsml_text not in chunks:
        chunks.append(newsml_text)

    return "\n\n".join(chunks).strip()


def _safe_pubdate(item: dict[str, Any]) -> str:
    pubdate = _clean_scalar(item.get("versionCreated"))
    return pubdate if pubdate else utc_now_iso()


def _safe_title(item: dict[str, Any], item_id: str) -> str:
    for key in ("headLine", "slug", "caption"):
        value = _clean_scalar(item.get(key))
        if value:
            return value
    return item_id


def _safe_byline(item: dict[str, Any]) -> str:
    byline = _clean_scalar(item.get("byLine"))
    if byline:
        return byline
    return "Reuters"


def _video_filename(item: dict[str, Any], rendition: dict[str, Any]) -> str:
    content_id = (
        _clean_scalar(item.get("usn"))
        or _clean_scalar(item.get("versionedGuid"))
        or hashlib.sha1(json.dumps(item, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    )
    rendition_uri = str(rendition.get("uri", ""))
    digest = hashlib.sha1(rendition_uri.encode("utf-8")).hexdigest()[:8]
    return f"video-{sanitize_project_id(content_id)}-{digest}.mp4"


def import_reuters_item(
    item_ref: str,
    project_id: str | None,
    projects_root: Path,
    timeout: int,
    force: bool,
) -> Path:
    item_id = normalize_item_id(item_ref)
    canonical_project_id = derive_project_id(item_id, project_id)
    project_dir = (projects_root / canonical_project_id).resolve()
    if not str(project_dir).startswith(str(projects_root.resolve())):
        raise ReutersImportError(f"Unsafe project path resolved: {project_dir}")

    token = get_access_token(timeout=timeout)
    item = get_reuters_item(item_id=item_id, token=token, timeout=timeout)

    selected_video_rendition = _select_best_video_rendition(item)
    if not selected_video_rendition:
        raise ReutersImportError(f"No downloadable MP4 rendition found for Reuters item: {item_id}")

    rendition_uri = selected_video_rendition.get("uri")
    if not isinstance(rendition_uri, str) or not rendition_uri:
        raise ReutersImportError("Reuters selected rendition does not have a valid uri")

    video_download_url = request_download_url(
        item_id=item_id,
        rendition_id=rendition_uri,
        token=token,
        timeout=timeout,
    )

    create_project_layout(project_dir, force=force)

    video_name = _video_filename(item, selected_video_rendition)
    video_path = project_dir / "input" / "videos" / video_name
    download_file(video_download_url, video_path, timeout=timeout)
    video_result = DownloadedVideo(rel_path=f"videos/{video_name}", byline=_safe_byline(item))

    newsml_text = _extract_newsml_text(item=item, item_id=item_id, token=token, timeout=timeout)
    text = _compose_text(item, newsml_text=newsml_text)
    if not text:
        text = _safe_title(item, item_id)

    article_payload = {
        "title": _safe_title(item, item_id),
        "byline": _safe_byline(item),
        "pubdate": _safe_pubdate(item),
        "text": text,
        "images": [],
        "videos": [{"path": video_result.rel_path, "byline": video_result.byline}],
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
    (project_dir / "working" / "reuters_source.json").write_text(
        json.dumps({"itemId": item_id, "item": item}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Created project: {canonical_project_id}")
    print(f"Path: {project_dir}")
    print("Images downloaded: 0")
    print("Videos downloaded: 1")

    return project_dir


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch a Reuters item and create a new minimal project folder.",
    )
    parser.add_argument(
        "item_id",
        help="Reuters item id (tag:reuters.com,...) or Reuters Connect discover URL",
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
        import_reuters_item(
            item_ref=args.item_id,
            project_id=args.project_id,
            projects_root=Path(args.projects_root),
            timeout=args.timeout,
            force=args.force,
        )
    except ReutersImportError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

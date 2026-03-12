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
from urllib.parse import urlparse
from urllib.request import Request, urlopen

AP_CONTENT_BASE_URL = "https://api.ap.org/media/v/content"
REQUEST_TIMEOUT_SECONDS = 45


class ApImportError(Exception):
    pass


@dataclass
class ParsedRemoteContent:
    href: str
    rendition: str | None
    content_type: str | None
    width: int | None
    height: int | None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sanitize_project_id(raw: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._")
    if not candidate:
        raise ApImportError("Could not derive a valid project id")
    if not candidate[0].isalnum():
        candidate = f"p-{candidate}"
    return candidate


def _looks_like_ap_id(value: str) -> bool:
    return re.fullmatch(r"[A-Za-z0-9._:-]+", value) is not None


def normalize_content_id(content_ref: str) -> str:
    raw = content_ref.strip()
    if not raw:
        raise ApImportError("AP content id is empty")

    parsed = urlparse(raw)
    if parsed.scheme in {"http", "https"} and "apvideohub.ap.org" in parsed.netloc.lower():
        segments = [segment for segment in parsed.path.split("/") if segment]
        if "video" in segments:
            idx = segments.index("video")
            if idx + 1 < len(segments) and segments[idx + 1]:
                return segments[idx + 1]
        if segments:
            return segments[-1]
        raise ApImportError("Could not parse AP content id from URL")

    if _looks_like_ap_id(raw):
        return raw

    raise ApImportError(
        "Unsupported AP id format. Use AP content id or an apvideohub.ap.org URL.",
    )


def derive_project_id(content_id: str, project_id: str | None) -> str:
    if project_id:
        return sanitize_project_id(project_id)
    return sanitize_project_id(f"ap-{content_id}".lower())


def get_api_key() -> str:
    fallback = os.getenv("AP_API_KEY", "").strip()
    if fallback:
        return fallback
    raise ApImportError("Missing environment variable: AP_API_KEY")


def _http_get(url: str, headers: dict[str, str], timeout: int) -> bytes:
    req = Request(url=url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=timeout) as response:
            return response.read()
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:600]
        raise ApImportError(f"HTTP {exc.code} from {url}: {details}") from exc
    except URLError as exc:
        raise ApImportError(f"Request failed for {url}: {exc.reason}") from exc


def fetch_metadata_xml(content_id: str, api_key: str, timeout: int) -> str:
    metadata_url = f"{AP_CONTENT_BASE_URL}/{content_id}?format=newsmlg2"
    body = _http_get(metadata_url, headers={"x-api-key": api_key}, timeout=timeout)
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("latin-1", errors="replace")


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _find_attr_local(element: ET.Element, name: str) -> str | None:
    for key, value in element.attrib.items():
        if _local_name(key) == name:
            return value
    return None


def _as_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


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


def _iter_remote_contents(root: ET.Element) -> list[ParsedRemoteContent]:
    rows: list[ParsedRemoteContent] = []
    for element in root.iter():
        if _local_name(element.tag) != "remoteContent":
            continue
        href = _find_attr_local(element, "href")
        if not href:
            continue
        rows.append(
            ParsedRemoteContent(
                href=href,
                rendition=_find_attr_local(element, "rendition"),
                content_type=_find_attr_local(element, "contenttype"),
                width=_as_int(_find_attr_local(element, "width")),
                height=_as_int(_find_attr_local(element, "height")),
            )
        )
    return rows


def _select_video_remote(remote_contents: list[ParsedRemoteContent]) -> ParsedRemoteContent | None:
    candidates: list[ParsedRemoteContent] = []
    for row in remote_contents:
        ctype = (row.content_type or "").lower()
        if "video" in ctype and "mp4" in ctype:
            candidates.append(row)
    if not candidates:
        return None

    def score(row: ParsedRemoteContent) -> tuple[int, int]:
        width = row.width or 0
        height = row.height or 0
        return (width * height, width + height)

    return max(candidates, key=score)


def _select_script_remote(remote_contents: list[ParsedRemoteContent]) -> ParsedRemoteContent | None:
    for row in remote_contents:
        rendition = (row.rendition or "").lower()
        ctype = (row.content_type or "").lower()
        if "script" in rendition or ctype in {"text/xml", "application/xml"}:
            return row
    return None


def _extract_text_by_local_name(root: ET.Element, names: set[str]) -> str | None:
    for element in root.iter():
        if _local_name(element.tag) not in names:
            continue
        text = "".join(element.itertext()).strip()
        if text:
            return _normalize_text(text)
    return None


def _extract_script_text(script_xml: str) -> str:
    try:
        root = ET.fromstring(script_xml)
    except ET.ParseError:
        return _normalize_text(script_xml)

    for element in root.iter():
        if _local_name(element.tag) == "body.content":
            text = "".join(element.itertext())
            normalized = _normalize_text(text)
            if normalized:
                return normalized

    return _normalize_text(" ".join(root.itertext()))


def _safe_pubdate(raw: str | None) -> str:
    if raw and raw.strip():
        return raw.strip()
    return utc_now_iso()


def _safe_title(root: ET.Element, content_id: str) -> str:
    text = _extract_text_by_local_name(root, {"slugline", "headline", "title"})
    return text if text else content_id


def _safe_byline(root: ET.Element) -> str:
    byline = _extract_text_by_local_name(root, {"byline", "byLine"})
    if byline:
        return byline
    provider_name = _extract_text_by_local_name(root, {"provider", "name"})
    if provider_name:
        return provider_name
    return "AP"


def _download_binary(url: str, target_file: Path, timeout: int, api_key: str) -> None:
    req = Request(
        url=url,
        headers={
            "x-api-key": api_key,
            "User-Agent": "videofy-minimal-fetch-ap/1.0",
        },
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


def download_file(url: str, target_file: Path, timeout: int, api_key: str) -> None:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        _download_binary(url, target_file, timeout=timeout, api_key=api_key)
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:400]
        raise ApImportError(f"Download failed ({exc.code}) for {url}: {details}") from exc
    except URLError as exc:
        raise ApImportError(f"Download failed for {url}: {exc.reason}") from exc


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
            raise ApImportError(
                f"Project directory already exists and is non-empty: {project_dir}. "
                "Use --force to replace it."
            )
        shutil.rmtree(project_dir)

    for rel in ("input/images", "input/videos", "working/uploads", "working/audio", "output"):
        (project_dir / rel).mkdir(parents=True, exist_ok=True)


def import_ap_item(
    content_ref: str,
    project_id: str | None,
    projects_root: Path,
    timeout: int,
    force: bool,
) -> Path:
    content_id = normalize_content_id(content_ref)
    canonical_project_id = derive_project_id(content_id, project_id)
    project_dir = (projects_root / canonical_project_id).resolve()
    if not str(project_dir).startswith(str(projects_root.resolve())):
        raise ApImportError(f"Unsafe project path resolved: {project_dir}")

    api_key = get_api_key()
    metadata_xml = fetch_metadata_xml(content_id=content_id, api_key=api_key, timeout=timeout)
    try:
        metadata_root = ET.fromstring(metadata_xml)
    except ET.ParseError as exc:
        raise ApImportError(f"Failed to parse AP metadata XML: {exc}") from exc

    remote_contents = _iter_remote_contents(metadata_root)
    selected_video = _select_video_remote(remote_contents)
    if not selected_video:
        raise ApImportError(f"No downloadable MP4 remoteContent found for AP item: {content_id}")

    selected_script = _select_script_remote(remote_contents)
    script_xml = ""
    script_text = ""
    if selected_script:
        script_bytes = _http_get(selected_script.href, headers={"x-api-key": api_key}, timeout=timeout)
        try:
            script_xml = script_bytes.decode("utf-8")
        except UnicodeDecodeError:
            script_xml = script_bytes.decode("latin-1", errors="replace")
        script_text = _extract_script_text(script_xml)

    create_project_layout(project_dir, force=force)

    video_digest = hashlib.sha1(selected_video.href.encode("utf-8")).hexdigest()[:8]
    video_filename = f"video-{sanitize_project_id(content_id)}-{video_digest}.mp4"
    video_path = project_dir / "input" / "videos" / video_filename
    download_file(selected_video.href, video_path, timeout=timeout, api_key=api_key)

    title = _safe_title(metadata_root, content_id)
    byline = _safe_byline(metadata_root)
    pubdate = _safe_pubdate(_extract_text_by_local_name(metadata_root, {"versionCreated", "contentCreated"}))
    text_parts = [title]
    description = _extract_text_by_local_name(metadata_root, {"description", "headline"})
    if description and description not in text_parts:
        text_parts.append(description)
    if script_text and script_text not in text_parts:
        text_parts.append(script_text)
    text = "\n\n".join(text_parts).strip()

    article_payload = {
        "title": title,
        "byline": byline,
        "pubdate": pubdate,
        "text": text,
        "images": [],
        "videos": [{"path": f"videos/{video_filename}", "byline": byline}],
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
    (project_dir / "working" / "ap_source.json").write_text(
        json.dumps(
            {
                "contentId": content_id,
                "videoUrl": selected_video.href,
                "scriptUrl": selected_script.href if selected_script else None,
                "videoRemoteContent": selected_video.__dict__,
                "scriptRemoteContent": selected_script.__dict__ if selected_script else None,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (project_dir / "working" / "ap_metadata.xml").write_text(metadata_xml, encoding="utf-8")
    if script_xml:
        (project_dir / "working" / "ap_script.xml").write_text(script_xml, encoding="utf-8")

    print(f"Created project: {canonical_project_id}")
    print(f"Path: {project_dir}")
    print("Images downloaded: 0")
    print("Videos downloaded: 1")

    return project_dir


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch an AP item and create a new minimal project folder.",
    )
    parser.add_argument(
        "content_id",
        help="AP content id or AP Video Hub URL",
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
        import_ap_item(
            content_ref=args.content_id,
            project_id=args.project_id,
            projects_root=Path(args.projects_root),
            timeout=args.timeout,
            force=args.force,
        )
    except ApImportError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3

"""
Fetcher plugin template.

Contract:
- Create a project folder under `projects/<project_id>`
- Write:
  - `generation.json`
  - `input/article.json`
- Print a line with: `Created project: <project_id>`
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


class FetcherError(Exception):
    pass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sanitize_project_id(raw: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._")
    if not candidate:
        raise FetcherError("Could not derive a valid project id")
    if not candidate[0].isalnum():
        candidate = f"p-{candidate}"
    return candidate


def derive_project_id(input_id: str, project_id: str | None) -> str:
    if project_id:
        return sanitize_project_id(project_id)
    return sanitize_project_id(f"example-{input_id}".lower())


def create_project_layout(project_dir: Path, force: bool) -> None:
    if project_dir.exists() and any(project_dir.iterdir()):
        if not force:
            raise FetcherError(
                f"Project directory already exists and is non-empty: {project_dir}. "
                "Use --force to replace it."
            )
        shutil.rmtree(project_dir)

    for rel in ("input/images", "input/videos", "working/uploads", "working/audio", "output"):
        (project_dir / rel).mkdir(parents=True, exist_ok=True)


def build_generation_manifest(project_id: str) -> dict[str, object]:
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


def import_item(input_id: str, project_id: str | None, projects_root: Path, force: bool) -> Path:
    canonical_project_id = derive_project_id(input_id, project_id)
    project_dir = (projects_root / canonical_project_id).resolve()
    if not str(project_dir).startswith(str(projects_root.resolve())):
        raise FetcherError(f"Unsafe project path resolved: {project_dir}")

    create_project_layout(project_dir, force=force)

    article_payload = {
        "title": f"Example item {input_id}",
        "byline": "Example Fetcher",
        "pubdate": utc_now_iso(),
        "text": f"Replace this with extracted text for input '{input_id}'.",
        "images": [],
        "videos": [],
    }

    (project_dir / "generation.json").write_text(
        json.dumps(build_generation_manifest(canonical_project_id), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (project_dir / "input" / "article.json").write_text(
        json.dumps(article_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Created project: {canonical_project_id}")
    print(f"Path: {project_dir}")
    return project_dir


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Example fetcher template")
    parser.add_argument("input_id", help="Primary input")
    parser.add_argument("--project-id", dest="project_id", default=None)
    parser.add_argument("--projects-root", dest="projects_root", default="projects")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        import_item(
            input_id=args.input_id,
            project_id=args.project_id,
            projects_root=Path(args.projects_root),
            force=args.force,
        )
    except FetcherError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

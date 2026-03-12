from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .schemas import ArticleInput, GenerationManifest


class ProjectStoreError(Exception):
    pass


class ProjectStore:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def list_projects(self) -> list[str]:
        return sorted(
            [
                p.name
                for p in self.root.iterdir()
                if p.is_dir() and not p.name.startswith(".")
            ]
        )

    def project_path(self, project_id: str) -> Path:
        if not project_id or not project_id.replace(".", "").replace("_", "").replace("-", "").isalnum():
            raise ProjectStoreError(f"Invalid project id '{project_id}'")
        path = (self.root / project_id).resolve()
        if not str(path).startswith(str(self.root)):
            raise ProjectStoreError(f"Unsafe project path for '{project_id}'")
        return path

    def generation_file(self, project_id: str) -> Path:
        return self.project_path(project_id) / "generation.json"

    def ensure_layout(self, project_id: str) -> Path:
        project_dir = self.project_path(project_id)
        for rel in [
            "input",
            "input/images",
            "input/videos",
            "working",
            "working/analysis",
            "working/analysis/frames",
            "working/uploads",
            "working/audio",
            "output",
        ]:
            (project_dir / rel).mkdir(parents=True, exist_ok=True)

        manifest_path = self.generation_file(project_id)
        if not manifest_path.exists():
            now = datetime.now(timezone.utc).isoformat()
            manifest = GenerationManifest(
                projectId=project_id,
                createdAt=datetime.fromisoformat(now),
                updatedAt=datetime.fromisoformat(now),
            )
            manifest_path.write_text(
                manifest.model_dump_json(indent=2),
                encoding="utf-8",
            )

        return project_dir

    def load_generation_manifest(self, project_id: str) -> GenerationManifest:
        self.ensure_layout(project_id)
        manifest_path = self.generation_file(project_id)
        with manifest_path.open("r", encoding="utf-8") as handle:
            return GenerationManifest.model_validate(json.load(handle))

    def save_generation_manifest(self, manifest: GenerationManifest) -> Path:
        self.ensure_layout(manifest.projectId)
        manifest.updatedAt = datetime.now(timezone.utc)
        target = self.generation_file(manifest.projectId)
        target.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
        return target

    def article_file(self, project_id: str) -> Path:
        return self.project_path(project_id) / "input" / "article.json"

    def load_article(self, project_id: str) -> ArticleInput:
        article_path = self.article_file(project_id)
        if not article_path.exists():
            raise ProjectStoreError(
                f"Missing input file: {article_path}. Expected project input/article.json"
            )
        with article_path.open("r", encoding="utf-8") as handle:
            return ArticleInput.model_validate(json.load(handle))

    def save_json(self, project_id: str, rel_path: str, data: dict) -> Path:
        self.ensure_layout(project_id)
        target = (self.project_path(project_id) / rel_path).resolve()
        if not str(target).startswith(str(self.project_path(project_id))):
            raise ProjectStoreError(f"Unsafe write path '{rel_path}'")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
        return target

    def load_json(self, project_id: str, rel_path: str) -> dict:
        target = (self.project_path(project_id) / rel_path).resolve()
        if not str(target).startswith(str(self.project_path(project_id))):
            raise ProjectStoreError(f"Unsafe read path '{rel_path}'")
        if not target.exists():
            raise ProjectStoreError(f"Missing file '{rel_path}' for project '{project_id}'")
        with target.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def save_upload(self, project_id: str, rel_dir: str, source_file: Path, original_name: str) -> Path:
        self.ensure_layout(project_id)
        suffix = Path(original_name).suffix.lower()
        safe_name = f"{uuid4().hex}{suffix}"
        target_dir = (self.project_path(project_id) / rel_dir).resolve()
        if not str(target_dir).startswith(str(self.project_path(project_id))):
            raise ProjectStoreError(f"Unsafe upload directory '{rel_dir}'")
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / safe_name
        shutil.copy2(source_file, target)
        return target

    def rel_to_project(self, project_id: str, path: Path) -> str:
        project_dir = self.project_path(project_id)
        return str(path.resolve().relative_to(project_dir))

    def resolve_asset_path(self, project_id: str, rel_asset_path: str) -> Path:
        path = (self.project_path(project_id) / rel_asset_path).resolve()
        if not str(path).startswith(str(self.project_path(project_id))):
            raise ProjectStoreError(f"Unsafe asset path '{rel_asset_path}'")
        if not path.exists():
            raise ProjectStoreError(f"Asset not found: {rel_asset_path}")
        return path

from pathlib import Path

import pytest

from api.project_store import ProjectStore
from api.project_store import ProjectStoreError


def test_project_store_list_and_article_loading(tmp_path: Path):
    projects_root = tmp_path / "projects"
    store = ProjectStore(projects_root)

    project_id = "alpha"
    store.ensure_layout(project_id)
    article = {
        "title": "T",
        "byline": "B",
        "pubdate": "2026-01-01T00:00:00Z",
        "text": "hello",
        "script_lines": ["one", "two"],
        "images": [],
        "videos": [],
    }
    store.save_json(project_id, "input/article.json", article)

    assert store.list_projects() == ["alpha"]

    loaded = store.load_article(project_id)
    assert loaded.title == "T"
    assert loaded.script_lines == ["one", "two"]

    manifest = store.load_generation_manifest(project_id)
    assert manifest.projectId == "alpha"
    assert manifest.brandId == "default"


def test_project_store_rejects_invalid_project_ids(tmp_path: Path):
    store = ProjectStore(tmp_path / "projects")
    with pytest.raises(ProjectStoreError):
        store.ensure_layout("bad id")

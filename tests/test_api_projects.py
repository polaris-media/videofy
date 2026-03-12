from pathlib import Path

from fastapi.testclient import TestClient

from api.factory import create_app
from api.settings import Settings


def write_brand_config(config_root: Path) -> None:
    config_root.mkdir(parents=True, exist_ok=True)
    (config_root / "default.json").write_text(
        '{"openai":{"manuscriptModel":"gpt-4o-mini","mediaModel":"gpt-4o"},"options":{"segmentPauseSeconds":0.4},"prompts":{"scriptPrompt":"Return JSON with lines."},"people":{"default":{"voice":"brand-voice-id","model_id":"eleven_turbo_v2_5"}}}',
        encoding="utf-8",
    )


def test_api_lists_projects_and_generates(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root)

    project_id = "demo"
    (projects_root / project_id / "input" / "images").mkdir(parents=True)
    (projects_root / project_id / "input" / "images" / "img.jpg").write_bytes(b"x")

    article = {
        "title": "Demo",
        "byline": "Test",
        "pubdate": "2026-01-01T00:00:00Z",
        "text": "Body",
        "script_lines": ["A", "B", "C"],
        "images": [{"path": "images/img.jpg"}],
        "videos": [],
    }

    article_path = projects_root / project_id / "input" / "article.json"
    article_path.write_text(__import__("json").dumps(article), encoding="utf-8")

    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://testserver",
        openai_api_key="",
        elevenlabs_api_key="",
    )
    app = create_app(settings)

    with TestClient(app) as client:
        projects = client.get("/api/projects")
        assert projects.status_code == 200
        assert projects.json()["projects"] == [project_id]

        generated = client.post(f"/api/projects/{project_id}/generate", json={})
        assert generated.status_code == 200
        payload = generated.json()
        assert payload["status"] == "generated"
        assert payload["project_id"] == project_id
        assert payload["manuscript_json"] is not None


def test_api_upload_image_and_reject_invalid_project_id(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root)

    project_id = "demo"
    (projects_root / project_id / "input" / "images").mkdir(parents=True, exist_ok=True)
    (projects_root / project_id / "input" / "article.json").write_text(
        __import__("json").dumps(
            {
                "title": "Demo",
                "byline": "Test",
                "pubdate": "2026-01-01T00:00:00Z",
                "text": "Body",
                "script_lines": ["A"],
                "images": [],
                "videos": [],
            }
        ),
        encoding="utf-8",
    )

    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://testserver",
    )
    app = create_app(settings)

    with TestClient(app) as client:
        upload_ok = client.post(
            f"/api/projects/{project_id}/upload-image",
            files={"file": ("test.jpg", b"abc", "image/jpeg")},
        )
        assert upload_ok.status_code == 200
        body = upload_ok.json()
        assert body["path"].startswith("working/uploads/")
        assert body["url"].startswith("http://testserver/projects/demo/files/")

        upload_invalid = client.post(
            "/api/projects/bad%20id/upload-image",
            files={"file": ("test.jpg", b"abc", "image/jpeg")},
        )
        assert upload_invalid.status_code == 400

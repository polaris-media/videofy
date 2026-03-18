import json
import os
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest


def _live_tests_enabled() -> bool:
    return os.environ.get("RUN_LIVE_CMS_TESTS") == "1"


def _base_url() -> str:
    return os.environ.get("LIVE_CMS_BASE_URL", "http://127.0.0.1:3000").rstrip("/")


def _newsroom() -> str:
    return os.environ.get("LIVE_POLARIS_NEWSROOM", "fvn").strip().lower()


def _request(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 120.0,
) -> tuple[int, bytes, dict[str, str]]:
    url = f"{_base_url()}{path}"
    body = None
    request_headers = dict(headers or {})

    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    request = Request(url, data=body, method=method, headers=request_headers)

    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.read(), dict(response.headers.items())
    except HTTPError as error:
        return error.code, error.read(), dict(error.headers.items())


def _request_json(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 120.0,
) -> tuple[int, dict[str, Any], dict[str, str]]:
    status, body, response_headers = _request(
        method,
        path,
        payload=payload,
        headers=headers,
        timeout=timeout,
    )
    parsed = json.loads(body.decode("utf-8"))
    return status, parsed, response_headers


def _require_json_ok(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 120.0,
) -> dict[str, Any]:
    status, data, _ = _request_json(
        method,
        path,
        payload=payload,
        headers=headers,
        timeout=timeout,
    )
    assert status == 200, data
    return data


def _article_refs() -> list[str]:
    configured = os.environ.get("LIVE_POLARIS_ARTICLE_REFS", "").strip()
    if configured:
        return [item.strip() for item in configured.split(",") if item.strip()]

    params = urlencode({"newsroom": _newsroom()})
    payload = _require_json_ok("GET", f"/api/polaris/articles?{params}", timeout=180.0)
    items = payload.get("items", [])
    refs = [
        item["id"]
        for item in items
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip()
    ]
    return refs[:2]


def _wait_for_job(job_id: str) -> dict[str, Any]:
    timeout_seconds = int(os.environ.get("LIVE_RENDER_TIMEOUT_SECONDS", "600"))
    deadline = time.monotonic() + timeout_seconds

    while time.monotonic() < deadline:
        snapshot = _require_json_ok("GET", f"/api/jobs/{job_id}", timeout=60.0)
        if snapshot["status"] in {"completed", "failed"}:
            return snapshot
        time.sleep(2)

    raise AssertionError(f"Timed out waiting for job {job_id}")


@pytest.mark.skipif(
    not _live_tests_enabled(),
    reason="Set RUN_LIVE_CMS_TESTS=1 to run live CMS download tests.",
)
def test_live_two_article_story_can_download_vertical_without_elevenlabs():
    fetchers_payload = _require_json_ok("GET", "/api/fetchers")
    fetcher_ids = {
        item["id"]
        for item in fetchers_payload.get("fetchers", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    assert "polaris-capi" in fetcher_ids, fetchers_payload

    article_refs = _article_refs()
    assert len(article_refs) >= 2, article_refs

    imported_project_ids: list[str] = []
    tabs: list[dict[str, Any]] = []
    processed_manuscripts: list[dict[str, Any]] = []
    player_config: dict[str, Any] | None = None

    for article_ref in article_refs[:2]:
        fetch_result = _require_json_ok(
            "POST",
            "/api/fetchers",
            payload={
                "fetcherId": "polaris-capi",
                "inputs": {
                    "newsroom": _newsroom(),
                    "article_ref": article_ref,
                },
            },
            timeout=180.0,
        )
        project_id = fetch_result["projectId"]
        imported_project_ids.append(project_id)

        manifest = _require_json_ok(
            "PATCH",
            f"/api/projects/{project_id}/manifest",
            payload={"brandId": "default"},
        )
        assert manifest["brandId"] == "default", manifest

        config_payload = _require_json_ok(
            "GET",
            f"/api/configs?{urlencode({'projectId': project_id})}",
        )
        config = config_payload["config"]
        player_config = {
            **config["player"],
            "assetBaseUrl": _base_url(),
        }

        generated = _require_json_ok(
            "POST",
            "/api/manuscripts/generate",
            payload={"projectId": project_id},
            timeout=420.0,
        )
        manuscript = generated["manuscript"]
        tabs.append(
            {
                "articleUrl": project_id,
                "projectId": project_id,
                "manuscript": manuscript,
            }
        )

        processed = _require_json_ok(
            "POST",
            "/api/manuscripts/process",
            payload={
                "projectId": project_id,
                "manuscript": manuscript,
                "audioMode": "none",
            },
            timeout=240.0,
        )
        processed_manuscripts.append(processed["processed"])

    assert player_config is not None

    generation_id = imported_project_ids[0]
    generation = _require_json_ok(
        "POST",
        "/api/generations",
        payload={
            "projectId": generation_id,
            "brandId": "default",
            "project": {
                "id": generation_id,
                "name": generation_id,
            },
            "data": tabs,
        },
    )
    assert generation["id"] == generation_id, generation

    stored_generation = _require_json_ok(
        "GET",
        f"/api/generations?{urlencode({'id': generation_id})}",
    )
    assert len(stored_generation["data"]) == 2, stored_generation

    job = _require_json_ok(
        "POST",
        "/api/jobs",
        payload={
            "kind": "render-video",
            "payload": {
                "projectId": generation_id,
                "orientations": ["vertical"],
                "manuscripts": processed_manuscripts,
                "playerConfig": player_config,
                "voice": False,
                "backgroundMusic": False,
                "disabledLogo": False,
                "splitArticles": False,
            },
        },
        timeout=120.0,
    )

    snapshot = _wait_for_job(job["jobId"])
    assert snapshot["status"] == "completed", snapshot

    result = snapshot["result"]
    assert result["downloadUrl"].endswith("/output/render-vertical.mp4"), result

    download_status, download_body, download_headers = _request(
        "GET",
        result["downloadUrl"],
        headers={"Range": "bytes=0-1023"},
        timeout=120.0,
    )
    assert download_status in {200, 206}, {
        "status": download_status,
        "headers": download_headers,
        "body": download_body.decode("utf-8", errors="ignore"),
    }
    assert len(download_body) > 0
    assert "video" in download_headers.get("Content-Type", "").lower()

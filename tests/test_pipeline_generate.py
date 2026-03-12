import json
import time
from pathlib import Path

from api.asset_analysis import AssetAnalysisResult, AssetAnalysisService
from api.config_resolver import ConfigResolver
from api.llm_service import LLMService
from api.pipeline import PipelineService
from api.project_store import ProjectStore
from api.settings import Settings
from api.tts_service import ElevenLabsService


def write_brand_config(config_root: Path) -> None:
    config_root.mkdir(parents=True, exist_ok=True)
    (config_root / "default.json").write_text(
        '{"openai":{"manuscriptModel":"gpt-4o-mini","mediaModel":"gpt-4o"},"options":{"segmentPauseSeconds":0.4},"prompts":{"scriptPrompt":"Return JSON with lines."},"people":{"default":{"voice":"brand-voice-id","model_id":"eleven_turbo_v2_5"}},"player":{"defaultCameraMovements":["pan-left","zoom-out"]}}',
        encoding="utf-8",
    )


def test_generate_manuscript_uses_script_lines_from_article(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root)

    store = ProjectStore(projects_root)
    project_id = "demo"
    store.ensure_layout(project_id)

    image_path = store.project_path(project_id) / "input" / "images" / "a.jpg"
    image_path.write_bytes(b"jpg")

    store.save_json(
        project_id,
        "input/article.json",
        {
            "title": "Demo",
            "byline": "Tester",
            "pubdate": "2026-01-01T00:00:00Z",
            "text": "Long text",
            "script_lines": ["Line 1", "Line 2", "Line 3"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
    )

    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=ElevenLabsService(
            api_key="",
            voice_id="voice",
            ffprobe_bin="ffprobe",
            ffmpeg_bin="ffmpeg",
        ),
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    manuscript = pipeline.generate_manuscript(project_id)

    assert len(manuscript.segments) == 3
    assert manuscript.segments[0].texts[0].text == "Line 1"
    assert manuscript.segments[0].images[0].path == "input/images/a.jpg"
    assert manuscript.segments[0].cameraMovement == "pan-left"
    assert manuscript.segments[1].cameraMovement == "zoom-out"
    assert manuscript.segments[2].cameraMovement == "pan-left"
    assert manuscript.segments[0].images[0].type == "image"
    assert manuscript.segments[0].images[0].imageAsset is not None

    analysis_dir = store.project_path(project_id) / "working" / "analysis"
    catalog = analysis_dir / "assets.catalog.json"
    descriptions = analysis_dir / "descriptions.json"
    placements = analysis_dir / "placements.json"
    hotspots = analysis_dir / "hotspots.json"
    video_scenes = analysis_dir / "video_scenes.json"
    run_file = analysis_dir / "run.json"
    assert catalog.exists()
    assert descriptions.exists()
    assert placements.exists()
    assert hotspots.exists()
    assert video_scenes.exists()
    assert run_file.exists()

    run_payload = json.loads(run_file.read_text(encoding="utf-8"))
    assert run_payload["assetCount"] == 1
    assert run_payload["lineCount"] == 3

    placement_payload = json.loads(placements.read_text(encoding="utf-8"))
    assert len(placement_payload["lineAssetIds"]) == 3


def test_generate_recomputes_analysis_on_each_run(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root)

    store = ProjectStore(projects_root)
    project_id = "rerun"
    store.ensure_layout(project_id)
    image_path = store.project_path(project_id) / "input" / "images" / "a.jpg"
    image_path.write_bytes(b"jpg")

    store.save_json(
        project_id,
        "input/article.json",
        {
            "title": "Rerun Demo",
            "byline": "Tester",
            "pubdate": "2026-01-01T00:00:00Z",
            "text": "Long text",
            "script_lines": ["One", "Two"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
    )
    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=ElevenLabsService(
            api_key="",
            voice_id="voice",
            ffprobe_bin="ffprobe",
            ffmpeg_bin="ffmpeg",
        ),
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    pipeline.generate_manuscript(project_id)
    analysis_dir = store.project_path(project_id) / "working" / "analysis"
    descriptions_before = json.loads(
        (analysis_dir / "descriptions.json").read_text(encoding="utf-8")
    )
    first_created_at = descriptions_before["createdAt"]

    time.sleep(0.01)
    pipeline.generate_manuscript(project_id)

    descriptions_after = json.loads(
        (analysis_dir / "descriptions.json").read_text(encoding="utf-8")
    )
    second_created_at = descriptions_after["createdAt"]
    assert second_created_at != first_created_at

    run_payload = json.loads((analysis_dir / "run.json").read_text(encoding="utf-8"))
    assert "cache" not in run_payload


class _FakeAssetAnalysisService:
    def __init__(self, app_base_url: str):
        self._app_base_url = app_base_url

    def analyze(
        self,
        project_id: str,
        script_lines: list[str],
        input_assets: list,
        describe_prompt: str,
        placement_prompt: str,
        media_model: str,
    ) -> AssetAnalysisResult:
        assert len(script_lines) == 2
        return AssetAnalysisResult(
            assets=[
                {
                    "asset_id": "vid-001",
                    "type": "video",
                    "rel_path": "input/videos/a.mp4",
                    "url": f"{self._app_base_url}/projects/{project_id}/files/input/videos/a.mp4",
                    "description": "Video summary",
                    "videoAsset": {
                        "id": "input/videos/a.mp4",
                        "title": "a.mp4",
                        "duration": 10000,
                        "streamUrls": {
                            "mp4": f"{self._app_base_url}/projects/{project_id}/files/input/videos/a.mp4"
                        },
                    },
                    "videoScenes": [
                        {
                            "scene_id": "vid-001-scene-001",
                            "start_seconds": 1.0,
                            "end_seconds": 3.0,
                            "description": "Scene one",
                        },
                        {
                            "scene_id": "vid-001-scene-002",
                            "start_seconds": 3.0,
                            "end_seconds": 5.0,
                            "description": "Scene two",
                        },
                    ],
                }
            ],
            placement_asset_ids=["vid-001", "vid-001"],
            used_fallback_placement=False,
            hotspot_provider="noop",
            description_model="gpt-4o",
            placement_model="gpt-4o",
        )


def test_generate_wires_video_scenes_into_segment_trims(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root)

    store = ProjectStore(projects_root)
    project_id = "video-scenes"
    store.ensure_layout(project_id)

    video_path = store.project_path(project_id) / "input" / "videos" / "a.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"video")

    store.save_json(
        project_id,
        "input/article.json",
        {
            "title": "Video Demo",
            "byline": "Tester",
            "pubdate": "2026-01-01T00:00:00Z",
            "text": "Long text",
            "script_lines": ["Line 1", "Line 2"],
            "images": [],
            "videos": [{"path": "videos/a.mp4"}],
        },
    )

    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
    )

    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=ElevenLabsService(
            api_key="",
            voice_id="voice",
            ffprobe_bin="ffprobe",
            ffmpeg_bin="ffmpeg",
        ),
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=_FakeAssetAnalysisService(settings.app_base_url),  # type: ignore[arg-type]
    )

    manuscript = pipeline.generate_manuscript(project_id)
    first_segment_video = manuscript.segments[0].images[0]
    second_segment_video = manuscript.segments[1].images[0]
    assert first_segment_video.type == "video"
    assert second_segment_video.type == "video"
    assert first_segment_video.start_from == 1.0
    assert first_segment_video.end_at == 3.0
    assert second_segment_video.start_from == 3.0
    assert second_segment_video.end_at == 5.0

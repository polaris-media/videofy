from pathlib import Path

from api.asset_analysis import AssetAnalysisService
from api.config_resolver import ConfigResolver
from api.llm_service import LLMService
from api.pipeline import PipelineService
from api.project_store import ProjectStore
from api.schemas import Hotspot
from api.settings import Settings


class FakeTTSService:
    def __init__(self):
        self.calls: list[dict] = []
        self.silence_calls: list[float] = []
        self.concat_inputs: list[Path] = []

    def can_synthesize(self) -> bool:
        return True

    def synthesize_line(
        self,
        text: str,
        output_mp3: Path,
        voice_id: str | None = None,
        model_id: str = "eleven_turbo_v2_5",
        voice_settings: dict | None = None,
    ) -> None:
        self.calls.append(
            {
                "text": text,
                "voice_id": voice_id,
                "model_id": model_id,
                "voice_settings": voice_settings or {},
            }
        )
        output_mp3.parent.mkdir(parents=True, exist_ok=True)
        output_mp3.write_bytes(b"line")

    def get_duration_seconds(self, audio_file: Path) -> float:
        return 1.0

    def concat_mp3(self, inputs: list[Path], output_file: Path) -> None:
        self.concat_inputs = list(inputs)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_bytes(b"combined")

    def create_silence_mp3(self, duration_seconds: float, output_file: Path) -> None:
        self.silence_calls.append(duration_seconds)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_bytes(b"silence")


def write_brand_config(config_root: Path, *, segment_pause_seconds: float) -> None:
    config_root.mkdir(parents=True, exist_ok=True)
    (config_root / "default.json").write_text(
        (
            '{"openai":{"manuscriptModel":"gpt-4o-mini","mediaModel":"gpt-4o"},'
            '"options":{"segmentPauseSeconds":'
            f"{segment_pause_seconds}"
            '},'
            '"prompts":{"scriptPrompt":"Return JSON with lines."},'
            '"people":{"default":{"voice":"brand-voice-id","model_id":"eleven_turbo_v2_5",'
            '"stability":1,"similarity_boost":1,"style":0,"use_speaker_boost":true}}}'
        ),
        encoding="utf-8",
    )


def test_pipeline_process_uses_brand_voice_and_settings(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root, segment_pause_seconds=0.4)

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
            "script_lines": ["Line 1"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    fake_tts = FakeTTSService()
    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
        elevenlabs_api_key="test-key",
    )

    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=fake_tts,  # type: ignore[arg-type]
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    manuscript = pipeline.generate_manuscript(project_id)
    pipeline.process_manuscript(project_id, manuscript)

    assert len(fake_tts.calls) == 1
    assert fake_tts.calls[0]["voice_id"] == "brand-voice-id"
    assert fake_tts.calls[0]["model_id"] == "eleven_turbo_v2_5"
    assert fake_tts.calls[0]["voice_settings"]["stability"] == 1
    assert fake_tts.calls[0]["voice_settings"]["similarity_boost"] == 1
    assert fake_tts.calls[0]["voice_settings"]["style"] == 0
    assert fake_tts.calls[0]["voice_settings"]["use_speaker_boost"] is True


def test_pipeline_process_inserts_pause_audio_between_lines(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root, segment_pause_seconds=0.4)

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
            "script_lines": ["Line 1", "Line 2"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    fake_tts = FakeTTSService()
    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
        elevenlabs_api_key="test-key",
    )

    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=fake_tts,  # type: ignore[arg-type]
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    manuscript = pipeline.generate_manuscript(project_id)
    pipeline.process_manuscript(project_id, manuscript)

    assert len(fake_tts.calls) == 2
    assert fake_tts.silence_calls == [0.4]
    assert len(fake_tts.concat_inputs) == 3
    assert fake_tts.concat_inputs[0].name == "line-001.mp3"
    assert fake_tts.concat_inputs[1].name == "pause-400ms.mp3"
    assert fake_tts.concat_inputs[2].name == "line-002.mp3"


def test_process_preserves_media_metadata(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root, segment_pause_seconds=0.0)

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
            "script_lines": ["Line 1"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    fake_tts = FakeTTSService()
    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
        elevenlabs_api_key="test-key",
    )
    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=fake_tts,  # type: ignore[arg-type]
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    manuscript = pipeline.generate_manuscript(project_id)
    image = manuscript.segments[0].images[0]
    image.hotspot = Hotspot(x=10, y=20, width=100, height=120)
    image.description = "King in recovery"
    image.displayMode = "contain-blur"

    processed = pipeline.process_manuscript(project_id, manuscript)
    processed_image = processed.segments[0].images[0]
    assert processed_image.hotspot is not None
    assert processed_image.hotspot.x == 10
    assert processed_image.description == "King in recovery"
    assert processed_image.displayMode == "contain-blur"


def test_pipeline_process_applies_duration_override_with_padding(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root, segment_pause_seconds=0.0)

    store = ProjectStore(projects_root)
    project_id = "override-padding"
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
            "script_lines": ["Line 1"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    fake_tts = FakeTTSService()
    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
        elevenlabs_api_key="test-key",
    )
    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=fake_tts,  # type: ignore[arg-type]
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    manuscript = pipeline.generate_manuscript(project_id)
    manuscript.segments[0].durationOverrideSeconds = 3.0
    processed = pipeline.process_manuscript(project_id, manuscript)

    assert processed.segments[0].start == 0
    assert processed.segments[0].end == 3.0
    assert fake_tts.silence_calls == [2.0]


def test_pipeline_process_ignores_duration_override_shorter_than_required_audio(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root, segment_pause_seconds=0.0)

    store = ProjectStore(projects_root)
    project_id = "override-too-short"
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
            "script_lines": ["Line 1"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    fake_tts = FakeTTSService()
    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
        elevenlabs_api_key="test-key",
    )
    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=fake_tts,  # type: ignore[arg-type]
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    manuscript = pipeline.generate_manuscript(project_id)
    manuscript.segments[0].durationOverrideSeconds = 0.5
    processed = pipeline.process_manuscript(project_id, manuscript)

    assert processed.segments[0].start == 0
    assert processed.segments[0].end == 1.0
    assert fake_tts.silence_calls == []


def test_pipeline_process_without_tts_generates_timeline_without_audio(tmp_path: Path):
    projects_root = tmp_path / "projects"
    config_root = tmp_path / "brands"
    write_brand_config(config_root, segment_pause_seconds=0.4)

    store = ProjectStore(projects_root)
    project_id = "no-tts"
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
            "script_lines": ["Kort linje", "En litt lengre linje for testing"],
            "images": [{"path": "images/a.jpg"}],
            "videos": [],
        },
    )

    fake_tts = FakeTTSService()

    settings = Settings(
        projects_root=projects_root,
        config_root=config_root,
        app_base_url="http://localhost:8001",
        elevenlabs_api_key="test-key",
    )

    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=LLMService(api_key="", model="gpt-4o-mini"),
        tts_service=fake_tts,  # type: ignore[arg-type]
        config_resolver=ConfigResolver(settings.config_root_abs),
        asset_analysis_service=AssetAnalysisService(
            store=store,
            openai_api_key="",
            ffmpeg_bin=settings.ffmpeg_bin,
            ffprobe_bin=settings.ffprobe_bin,
        ),
    )

    manuscript = pipeline.generate_manuscript(project_id)
    processed = pipeline.process_manuscript(project_id, manuscript, audio_mode="none")

    assert processed.meta.audio == {}
    assert processed.segments[0].start == 0
    assert processed.segments[0].end > 0
    assert processed.segments[1].start > processed.segments[0].end
    assert processed.segments[0].texts[0].end > processed.segments[0].texts[0].start
    assert fake_tts.calls == []
    assert not (store.project_path(project_id) / "output" / "narration.mp3").exists()

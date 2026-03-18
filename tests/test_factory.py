from pathlib import Path

from api.factory import create_app
from api.settings import Settings


def test_create_app_disables_local_fallback_when_elevenlabs_key_exists(tmp_path: Path):
    settings = Settings(
        projects_root=tmp_path / "projects",
        config_root=tmp_path / "brands",
        elevenlabs_api_key="test-key",
        local_tts_enabled=True,
    )

    app = create_app(settings)
    providers = app.state.app_state.pipeline.tts_service._providers

    assert [type(provider).__name__ for provider in providers] == ["ElevenLabsService"]

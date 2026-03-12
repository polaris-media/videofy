from pathlib import Path

import pytest

from api.config_resolver import ConfigResolver, ConfigResolverError
from api.schemas import GenerationManifest


def test_brand_people_default_overrides_elevenlabs_voice_defaults(tmp_path: Path):
    config_root = tmp_path / "brands"
    config_root.mkdir(parents=True, exist_ok=True)
    (config_root / "default.json").write_text(
        '{"openai":{"manuscriptModel":"gpt-4o-mini","mediaModel":"gpt-4o"},"options":{"segmentPauseSeconds":0.4},"people":{"default":{"voice":"brand-voice","model_id":"eleven_turbo_v2_5","stability":1,"similarity_boost":1,"style":0,"use_speaker_boost":true}},"prompts":{"scriptPrompt":"brand-prompt"}}',
        encoding="utf-8",
    )

    resolver = ConfigResolver(config_root)
    manifest = GenerationManifest(projectId="demo")

    resolved = resolver.resolve(manifest)

    assert resolved.voice_id == "brand-voice"
    assert resolved.voice_settings["stability"] == 1
    assert resolved.voice_settings["similarity_boost"] == 1
    assert resolved.voice_settings["style"] == 0
    assert resolved.voice_settings["use_speaker_boost"] is True
    assert resolved.tts_model_id == "eleven_turbo_v2_5"
    assert resolved.script_prompt == "brand-prompt"
    assert resolved.manuscript_model == "gpt-4o-mini"
    assert resolved.media_model == "gpt-4o"


def test_brand_must_define_voice_and_model(tmp_path: Path):
    config_root = tmp_path / "brands"
    config_root.mkdir(parents=True, exist_ok=True)
    (config_root / "default.json").write_text(
        '{"people":{"default":{"voice":"brand-voice"}}}',
        encoding="utf-8",
    )

    resolver = ConfigResolver(config_root)
    manifest = GenerationManifest(projectId="demo")

    with pytest.raises(ConfigResolverError, match="people.default.model_id"):
        resolver.resolve(manifest)

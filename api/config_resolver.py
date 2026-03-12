from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .schemas import GenerationManifest


class ConfigResolverError(Exception):
    pass


@dataclass
class ResolvedConfig:
    manuscript_model: str
    media_model: str
    script_prompt: str
    placement_prompt: str
    describe_images_prompt: str
    voice_id: str
    tts_model_id: str
    voice_settings: dict[str, Any]
    segment_pause_seconds: float
    player: dict[str, Any]
    export_defaults: dict[str, Any]


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ConfigResolverError(f"Missing config file: {path}")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ConfigResolverError(f"Invalid config JSON object in {path}")
    return data


def _merge_dict(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge_dict(result[key], value)
        else:
            result[key] = value
    return result


class ConfigResolver:
    def __init__(self, config_root: Path):
        self.config_root = config_root

    def _resolve_brand_path(self, brand_id: str) -> Path:
        direct = self.config_root / f"{brand_id}.json"
        if direct.exists():
            return direct

        fallback_paths = sorted(path for path in self.config_root.glob("*.json") if path.is_file())
        if not fallback_paths:
            raise ConfigResolverError(f"Missing config file: {direct}")

        preferred = self.config_root / "default.json"
        if preferred.exists():
            return preferred
        return fallback_paths[0]

    def resolve(self, manifest: GenerationManifest) -> ResolvedConfig:
        brand = _read_json(self._resolve_brand_path(manifest.brandId))
        options = brand.get("options", {}) if isinstance(brand.get("options"), dict) else {}
        player = brand.get("player", {}) if isinstance(brand.get("player"), dict) else {}
        prompts = brand.get("prompts", {}) if isinstance(brand.get("prompts"), dict) else {}
        openai_cfg = brand.get("openai", {}) if isinstance(brand.get("openai"), dict) else {}
        people_cfg = brand.get("people", {}) if isinstance(brand.get("people"), dict) else {}
        default_person = (
            people_cfg.get("default", {})
            if isinstance(people_cfg.get("default"), dict)
            else {}
        )
        export_defaults = (
            brand.get("exportDefaults", {}) if isinstance(brand.get("exportDefaults"), dict) else {}
        )

        pause = manifest.options.segmentPauseSeconds
        if pause is None:
            pause = float(options.get("segmentPauseSeconds", 0.4))

        voice_id = default_person.get("voice")
        if not isinstance(voice_id, str) or not voice_id:
            raise ConfigResolverError(
                f"Brand '{manifest.brandId}' must define people.default.voice"
            )

        voice_settings: dict[str, Any] = {}
        for key in ("stability", "similarity_boost", "style"):
            value = default_person.get(key)
            if isinstance(value, (int, float)):
                voice_settings[key] = value
        use_speaker_boost = default_person.get("use_speaker_boost")
        if isinstance(use_speaker_boost, bool):
            voice_settings["use_speaker_boost"] = use_speaker_boost

        tts_model_id = default_person.get("model_id")
        if not isinstance(tts_model_id, str) or not tts_model_id:
            tts_model_id = default_person.get("modelId")
        if not isinstance(tts_model_id, str) or not tts_model_id:
            raise ConfigResolverError(
                f"Brand '{manifest.brandId}' must define people.default.model_id"
            )

        manuscript_model = str(openai_cfg.get("manuscriptModel", "gpt-4o"))
        media_model = str(openai_cfg.get("mediaModel", manuscript_model))

        return ResolvedConfig(
            manuscript_model=manuscript_model,
            media_model=media_model,
            script_prompt=str(
                prompts.get(
                    "scriptPrompt",
                    "Return JSON with key lines and 3-4 short factual lines suitable for voice-over.",
                )
            ),
            placement_prompt=str(prompts.get("placementPrompt", "")),
            describe_images_prompt=str(prompts.get("describeImagesPrompt", "")),
            voice_id=voice_id,
            tts_model_id=tts_model_id,
            voice_settings=voice_settings,
            segment_pause_seconds=float(pause),
            player=player,
            export_defaults=export_defaults,
        )

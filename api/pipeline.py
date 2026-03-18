from __future__ import annotations

import logging
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .asset_analysis import AnalysisInputAsset, AssetAnalysisService, AssetAnalysisResult
from .config_resolver import ConfigResolver, ResolvedConfig
from .llm_service import LLMService
from .project_store import ProjectStore, ProjectStoreError
from .schemas import (
    ArticleInput,
    Manuscript,
    ManuscriptMeta,
    MediaAssetImage,
    MediaAssetVideo,
    Segment,
    TextLine,
)
from .settings import Settings
from .tts_service import TTSService
from .usage_tracker import UsageTracker

logger = logging.getLogger(__name__)

DEFAULT_CAMERA_MOVEMENTS = [
    "zoom-in",
    "pan-right",
    "zoom-in",
    "pan-left",
    "zoom-in",
    "zoom-out",
]
VALID_CAMERA_MOVEMENTS = {
    "none",
    "pan-left",
    "pan-right",
    "pan-up",
    "pan-down",
    "zoom-in",
    "zoom-out",
    "zoom-rotate-left",
    "zoom-rotate-right",
    "zoom-out-rotate-left",
    "zoom-out-rotate-right",
}


class PipelineService:
    def __init__(
        self,
        settings: Settings,
        store: ProjectStore,
        llm_service: LLMService,
        tts_service: TTSService,
        config_resolver: ConfigResolver,
        asset_analysis_service: AssetAnalysisService,
        usage_tracker: UsageTracker | None = None,
    ):
        self.settings = settings
        self.store = store
        self.llm_service = llm_service
        self.tts_service = tts_service
        self.config_resolver = config_resolver
        self.asset_analysis_service = asset_analysis_service
        self.usage_tracker = usage_tracker

    def _asset_url(self, project_id: str, project_relative_path: str) -> str:
        return f"{self.settings.app_base_url}/projects/{project_id}/files/{project_relative_path}"

    def _load_project_config_override(self, project_id: str) -> dict[str, Any]:
        try:
            override = self.store.load_json(project_id, "working/config.override.json")
            if isinstance(override, dict):
                return override
        except ProjectStoreError:
            pass

        # Backward-compatible fallback for sessions created before config.override.json
        # started being persisted separately from the CMS session record.
        try:
            generation = self.store.load_json(project_id, "working/cms-generation.json")
        except ProjectStoreError:
            return {}

        if not isinstance(generation, dict):
            return {}

        config = generation.get("config")
        return config if isinstance(config, dict) else {}

    def _apply_project_config_override(
        self,
        project_id: str,
        resolved_config: ResolvedConfig,
    ) -> ResolvedConfig:
        override = self._load_project_config_override(project_id)
        if not override:
            return resolved_config

        openai_cfg = override.get("openai")
        if isinstance(openai_cfg, dict):
            manuscript_model = openai_cfg.get("manuscriptModel")
            if isinstance(manuscript_model, str) and manuscript_model.strip():
                resolved_config.manuscript_model = manuscript_model.strip()

            media_model = openai_cfg.get("mediaModel")
            if isinstance(media_model, str) and media_model.strip():
                resolved_config.media_model = media_model.strip()

        manuscript_cfg = override.get("manuscript")
        if isinstance(manuscript_cfg, dict):
            script_prompt = manuscript_cfg.get("script_prompt")
            if isinstance(script_prompt, str) and script_prompt.strip():
                resolved_config.script_prompt = script_prompt

            placement_prompt = manuscript_cfg.get("placement_prompt")
            if isinstance(placement_prompt, str) and placement_prompt.strip():
                resolved_config.placement_prompt = placement_prompt

            describe_images_prompt = manuscript_cfg.get("describe_images_prompt")
            if isinstance(describe_images_prompt, str) and describe_images_prompt.strip():
                resolved_config.describe_images_prompt = describe_images_prompt

        people_cfg = override.get("people")
        if isinstance(people_cfg, dict):
            default_person = people_cfg.get("default")
            if isinstance(default_person, dict):
                voice_id = default_person.get("voice")
                if isinstance(voice_id, str) and voice_id.strip():
                    resolved_config.voice_id = voice_id.strip()

                for key in ("stability", "similarity_boost", "style"):
                    value = default_person.get(key)
                    if isinstance(value, (int, float)):
                        resolved_config.voice_settings[key] = value

                use_speaker_boost = default_person.get("use_speaker_boost")
                if isinstance(use_speaker_boost, bool):
                    resolved_config.voice_settings["use_speaker_boost"] = use_speaker_boost

        audio_cfg = override.get("audio")
        if isinstance(audio_cfg, dict):
            segment_pause = audio_cfg.get("segment_pause")
            if isinstance(segment_pause, (int, float)):
                resolved_config.segment_pause_seconds = float(segment_pause)

        player_cfg = override.get("player")
        if isinstance(player_cfg, dict):
            resolved_config.player = {
                **deepcopy(resolved_config.player),
                **deepcopy(player_cfg),
            }

        export_defaults = override.get("exportDefaults")
        if isinstance(export_defaults, dict):
            resolved_config.export_defaults = {
                **deepcopy(resolved_config.export_defaults),
                **deepcopy(export_defaults),
            }

        return resolved_config

    def _normalize_input_asset_path(self, input_folder: str, provided_path: str) -> str:
        if provided_path.startswith("input/"):
            return provided_path
        if provided_path.startswith(f"{input_folder}/"):
            return f"input/{provided_path}"
        return f"input/{input_folder}/{provided_path.lstrip('/')}"

    def _resolve_script_lines(
        self,
        project_id: str,
        article: ArticleInput,
        resolved_config: ResolvedConfig,
        script_prompt_override: str | None,
    ) -> list[str]:
        if article.script_lines:
            return article.script_lines

        override_prompt = (
            script_prompt_override.strip()
            if isinstance(script_prompt_override, str) and script_prompt_override.strip()
            else None
        )
        script_prompt = override_prompt or resolved_config.script_prompt

        return self.llm_service.summarize_into_lines(
            text=article.text,
            title=article.title,
            system_prompt=script_prompt,
            model_override=resolved_config.manuscript_model,
            project_id=project_id,
        )

    def _build_analysis_input_assets(
        self,
        project_id: str,
        article: ArticleInput,
    ) -> list[AnalysisInputAsset]:
        analysis_input_assets: list[AnalysisInputAsset] = []

        for index, image in enumerate(article.images):
            project_relative_path = self._normalize_input_asset_path("images", image.path)
            local_file_path = self.store.resolve_asset_path(project_id, project_relative_path)
            analysis_input_assets.append(
                AnalysisInputAsset(
                    asset_id=f"img-{index + 1:03}",
                    type="image",
                    rel_path=project_relative_path,
                    local_path=local_file_path,
                    url=self._asset_url(project_id, project_relative_path),
                    byline=image.byline,
                )
            )

        for index, video in enumerate(article.videos):
            project_relative_path = self._normalize_input_asset_path("videos", video.path)
            local_file_path = self.store.resolve_asset_path(project_id, project_relative_path)
            analysis_input_assets.append(
                AnalysisInputAsset(
                    asset_id=f"vid-{index + 1:03}",
                    type="video",
                    rel_path=project_relative_path,
                    local_path=local_file_path,
                    url=self._asset_url(project_id, project_relative_path),
                    byline=video.byline,
                    start_from=video.start_from,
                    end_at=video.end_at,
                )
            )

        return analysis_input_assets

    def _map_analysis_asset_to_media_asset(
        self,
        project_id: str,
        analysis_asset: dict[str, Any],
        video_scene_index: int | None = None,
    ) -> MediaAssetImage | MediaAssetVideo | None:
        analysis_asset_type = str(analysis_asset.get("type", ""))
        project_relative_path = str(analysis_asset.get("rel_path", ""))
        asset_url = str(analysis_asset.get("url", self._asset_url(project_id, project_relative_path)))

        raw_byline = analysis_asset.get("byline")
        byline = str(raw_byline) if raw_byline is not None else None

        if analysis_asset_type == "image":
            return MediaAssetImage(
                path=project_relative_path,
                url=asset_url,
                byline=byline,
                imageAsset=analysis_asset.get("imageAsset"),
                hotspot=analysis_asset.get("hotspot"),
                description=analysis_asset.get("description"),
            )

        if analysis_asset_type != "video":
            return None

        raw_video_scenes = analysis_asset.get("videoScenes")
        video_scenes = (
            [scene for scene in raw_video_scenes if isinstance(scene, dict)]
            if isinstance(raw_video_scenes, list)
            else []
        )

        selected_video_scene: dict[str, Any] | None = None
        if video_scenes:
            if video_scene_index is None:
                selected_video_scene = video_scenes[0]
            elif 0 <= video_scene_index < len(video_scenes):
                selected_video_scene = video_scenes[video_scene_index]

        start_from = analysis_asset.get("start_from")
        end_at = analysis_asset.get("end_at")
        description = analysis_asset.get("description")

        if selected_video_scene:
            scene_start = selected_video_scene.get("start_seconds")
            scene_end = selected_video_scene.get("end_seconds")
            if isinstance(scene_start, (int, float)):
                start_from = float(scene_start)
            if isinstance(scene_end, (int, float)):
                end_at = float(scene_end)

            scene_description = selected_video_scene.get("description")
            if isinstance(scene_description, str) and scene_description.strip():
                description = scene_description.strip()

        video_asset = analysis_asset.get("videoAsset")
        if isinstance(video_asset, dict):
            video_asset = deepcopy(video_asset)
            if selected_video_scene and isinstance(description, str) and description:
                video_asset["title"] = description

        return MediaAssetVideo(
            path=project_relative_path,
            url=asset_url,
            byline=byline,
            start_from=start_from,
            end_at=end_at,
            videoAsset=video_asset,
            description=description,
        )

    def _build_global_media_assets(
        self,
        project_id: str,
        analysis_result: AssetAnalysisResult,
    ) -> tuple[dict[str, dict[str, Any]], list[MediaAssetImage | MediaAssetVideo]]:
        analysis_assets_by_id: dict[str, dict[str, Any]] = {}
        global_media_assets: list[MediaAssetImage | MediaAssetVideo] = []

        for analysis_asset in analysis_result.assets:
            asset_id = str(analysis_asset.get("asset_id", ""))
            if asset_id:
                analysis_assets_by_id[asset_id] = analysis_asset

            media_asset = self._map_analysis_asset_to_media_asset(
                project_id=project_id,
                analysis_asset=analysis_asset,
                video_scene_index=0 if isinstance(analysis_asset.get("videoScenes"), list) else None,
            )
            if media_asset is not None:
                global_media_assets.append(media_asset)

        return analysis_assets_by_id, global_media_assets

    def _resolve_camera_movements(self, player_config: dict[str, Any]) -> list[str]:
        configured_camera_movements = player_config.get("defaultCameraMovements", [])
        if (
            not isinstance(configured_camera_movements, list)
            or len(configured_camera_movements) == 0
            or not all(
                isinstance(item, str) and item in VALID_CAMERA_MOVEMENTS
                for item in configured_camera_movements
            )
        ):
            return DEFAULT_CAMERA_MOVEMENTS
        return configured_camera_movements

    def _build_segments_from_analysis(
        self,
        project_id: str,
        script_lines: list[str],
        analysis_result: AssetAnalysisResult,
        analysis_assets_by_id: dict[str, dict[str, Any]],
        default_camera_movements: list[str],
    ) -> list[Segment]:
        segments: list[Segment] = []
        next_video_scene_index_by_asset_id: dict[str, int] = {}

        for index, script_line in enumerate(script_lines):
            selected_media_assets: list[MediaAssetImage | MediaAssetVideo] = []
            placed_asset_id = (
                analysis_result.placement_asset_ids[index]
                if index < len(analysis_result.placement_asset_ids)
                else None
            )

            if placed_asset_id and placed_asset_id in analysis_assets_by_id:
                placed_analysis_asset = analysis_assets_by_id[placed_asset_id]
                video_scene_index: int | None = None
                video_scenes = placed_analysis_asset.get("videoScenes")
                if isinstance(video_scenes, list) and len(video_scenes) > 0:
                    next_scene_index = next_video_scene_index_by_asset_id.get(placed_asset_id, 0)
                    video_scene_index = next_scene_index % len(video_scenes)
                    next_video_scene_index_by_asset_id[placed_asset_id] = next_scene_index + 1

                mapped_media_asset = self._map_analysis_asset_to_media_asset(
                    project_id=project_id,
                    analysis_asset=placed_analysis_asset,
                    video_scene_index=video_scene_index,
                )
                if mapped_media_asset is not None:
                    selected_media_assets = [mapped_media_asset]
            elif analysis_result.assets:
                fallback_analysis_asset = analysis_result.assets[index % len(analysis_result.assets)]
                fallback_media_asset = self._map_analysis_asset_to_media_asset(
                    project_id=project_id,
                    analysis_asset=fallback_analysis_asset,
                    video_scene_index=0 if isinstance(fallback_analysis_asset.get("videoScenes"), list) else None,
                )
                if fallback_media_asset is not None:
                    selected_media_assets = [fallback_media_asset]

            segments.append(
                Segment(
                    id=index + 1,
                    texts=[TextLine(text=script_line, line_id=index + 1)],
                    text=script_line,
                    images=selected_media_assets,
                    mood="neutral",
                    style="bottom",
                    cameraMovement=default_camera_movements[index % len(default_camera_movements)],
                )
            )

        return segments

    def _save_generation_outputs(
        self,
        project_id: str,
        manuscript: Manuscript,
        resolved_config: ResolvedConfig,
        analysis_result: AssetAnalysisResult,
    ) -> None:
        self.store.save_json(
            project_id,
            "working/manuscript.json",
            manuscript.model_dump(mode="json", exclude_none=True),
        )
        self.store.save_json(
            project_id,
            "working/resolved_config.json",
            {
                "manuscriptModel": resolved_config.manuscript_model,
                "openaiModel": resolved_config.manuscript_model,
                "mediaModel": resolved_config.media_model,
                "voiceId": resolved_config.voice_id,
                "ttsModelId": resolved_config.tts_model_id,
                "segmentPauseSeconds": resolved_config.segment_pause_seconds,
                "player": resolved_config.player,
                "analysis": {
                    "descriptionModel": analysis_result.description_model,
                    "placementModel": analysis_result.placement_model,
                    "hotspotProvider": analysis_result.hotspot_provider,
                    "usedFallbackPlacement": analysis_result.used_fallback_placement,
                },
            },
        )

    def generate_manuscript(
        self,
        project_id: str,
        script_prompt_override: str | None = None,
        model_override: str | None = None,
    ) -> Manuscript:
        logger.info("[pipeline:%s] Manuscript generation started", project_id)
        self.store.ensure_layout(project_id)
        logger.info("[pipeline:%s] Step 1/7: Resolving config", project_id)
        generation_manifest = self.store.load_generation_manifest(project_id)
        resolved_config = self.config_resolver.resolve(generation_manifest)
        resolved_config = self._apply_project_config_override(project_id, resolved_config)
        if isinstance(model_override, str) and model_override.strip():
            selected_model = model_override.strip()
            resolved_config.manuscript_model = selected_model
            resolved_config.media_model = selected_model
        logger.info(
            "[pipeline:%s] Config resolved (brand=%s, model=%s)",
            project_id,
            generation_manifest.brandId,
            resolved_config.manuscript_model,
        )

        logger.info("[pipeline:%s] Step 2/7: Loading article", project_id)
        article = self.store.load_article(project_id)
        logger.info(
            "[pipeline:%s] Article loaded (images=%d, videos=%d, has_script_lines=%s)",
            project_id,
            len(article.images),
            len(article.videos),
            bool(article.script_lines),
        )

        logger.info("[pipeline:%s] Step 3/7: Resolving script lines", project_id)
        script_lines = self._resolve_script_lines(
            project_id=project_id,
            article=article,
            resolved_config=resolved_config,
            script_prompt_override=script_prompt_override,
        )
        logger.info(
            "[pipeline:%s] Script lines resolved (lines=%d)",
            project_id,
            len(script_lines),
        )

        logger.info("[pipeline:%s] Step 4/7: Preparing analysis input assets", project_id)
        analysis_input_assets = self._build_analysis_input_assets(project_id=project_id, article=article)
        logger.info(
            "[pipeline:%s] Analysis input prepared (assets=%d)",
            project_id,
            len(analysis_input_assets),
        )

        logger.info("[pipeline:%s] Step 5/7: Running asset analysis", project_id)
        analysis_result = self.asset_analysis_service.analyze(
            project_id=project_id,
            script_lines=script_lines,
            input_assets=analysis_input_assets,
            describe_prompt=resolved_config.describe_images_prompt,
            placement_prompt=resolved_config.placement_prompt,
            media_model=resolved_config.media_model,
        )
        logger.info(
            "[pipeline:%s] Asset analysis completed (assets=%d, hotspot_provider=%s)",
            project_id,
            len(analysis_result.assets),
            analysis_result.hotspot_provider,
        )

        logger.info("[pipeline:%s] Step 6/7: Mapping media assets", project_id)
        analysis_assets_by_id, global_media_assets = self._build_global_media_assets(
            project_id=project_id,
            analysis_result=analysis_result,
        )
        logger.info(
            "[pipeline:%s] Global media mapped (media_assets=%d)",
            project_id,
            len(global_media_assets),
        )

        default_camera_movements = self._resolve_camera_movements(resolved_config.player)
        logger.info("[pipeline:%s] Building manuscript segments", project_id)
        segments = self._build_segments_from_analysis(
            project_id=project_id,
            script_lines=script_lines,
            analysis_result=analysis_result,
            analysis_assets_by_id=analysis_assets_by_id,
            default_camera_movements=default_camera_movements,
        )
        logger.info(
            "[pipeline:%s] Segments built (segments=%d)",
            project_id,
            len(segments),
        )

        manuscript = Manuscript(
            meta=ManuscriptMeta(
                title=article.title,
                byline=article.byline,
                pubdate=article.pubdate,
                uniqueId=str(uuid4()),
                id=1,
                articleUrl=project_id,
                audio={},
            ),
            segments=segments,
            media=global_media_assets,
        )

        self._save_generation_outputs(
            project_id=project_id,
            manuscript=manuscript,
            resolved_config=resolved_config,
            analysis_result=analysis_result,
        )
        logger.info(
            "[pipeline:%s] Step 7/7: Saved manuscript outputs",
            project_id,
        )
        logger.info("[pipeline:%s] Manuscript generation finished", project_id)
        return manuscript

    def _load_manuscript_for_processing(
        self,
        project_id: str,
        manuscript: Manuscript | None,
    ) -> Manuscript:
        if manuscript is None:
            stored_manuscript_payload = self.store.load_json(project_id, "working/manuscript.json")
            return Manuscript.model_validate(stored_manuscript_payload)

        self.store.save_json(
            project_id,
            "working/manuscript.json",
            manuscript.model_dump(mode="json", exclude_none=True),
        )
        return manuscript

    def _render_segment_audio_timeline(
        self,
        project_id: str,
        manuscript: Manuscript,
        resolved_config: ResolvedConfig,
        audio_mode: str,
    ) -> list[Path]:
        rendered_audio_clips: list[Path] = []
        current_timeline_seconds = 0.0
        if audio_mode == "elevenlabs":
            if not self.settings.elevenlabs_api_key.strip():
                raise ValueError("ElevenLabs is not configured for this environment")
            if not self._tts_is_available():
                raise ValueError("ElevenLabs is unavailable for manuscript processing")
            tts_available = True
        else:
            tts_available = False
        segment_pause_seconds = (
            resolved_config.segment_pause_seconds
            if resolved_config.segment_pause_seconds is not None
            else self.settings.segment_pause_seconds
        )
        total_line_count = sum(len(segment.texts) for segment in manuscript.segments)
        rendered_line_count = 0
        silence_audio_clip_paths: dict[int, Path] = {}
        logger.info(
            "[pipeline:%s] Audio rendering started (segments=%d, lines=%d, segment_pause=%.2fs, audio_mode=%s, tts_available=%s)",
            project_id,
            len(manuscript.segments),
            total_line_count,
            segment_pause_seconds,
            audio_mode,
            tts_available,
        )

        def append_silence(duration_seconds: float) -> None:
            nonlocal current_timeline_seconds
            if duration_seconds <= 0:
                return

            silence_duration_key = int(round(duration_seconds * 1000))
            if tts_available:
                silence_clip_path = silence_audio_clip_paths.get(silence_duration_key)
                if silence_clip_path is None:
                    silence_clip_path = (
                        self.store.project_path(project_id)
                        / "working"
                        / "audio"
                        / f"pause-{silence_duration_key}ms.mp3"
                    )
                    self.tts_service.create_silence_mp3(duration_seconds, silence_clip_path)
                    silence_audio_clip_paths[silence_duration_key] = silence_clip_path
                rendered_audio_clips.append(silence_clip_path)

            current_timeline_seconds += duration_seconds

        for segment_index, segment in enumerate(manuscript.segments, start=1):
            segment_start_seconds = current_timeline_seconds
            custom_audio_length = (
                float(segment.customAudio.length)
                if segment.customAudio and segment.customAudio.length is not None
                else None
            )

            if custom_audio_length is not None and custom_audio_length > 0:
                for text_line in segment.texts:
                    text_line.start = round(segment_start_seconds, 3)
                    text_line.end = round(segment_start_seconds + custom_audio_length, 3)
                current_timeline_seconds += custom_audio_length
                rendered_line_count += len(segment.texts)
                logger.info(
                    "[pipeline:%s] Segment %d/%d timed from custom audio (duration=%.3fs)",
                    project_id,
                    segment_index,
                    len(manuscript.segments),
                    custom_audio_length,
                )
            else:
                for line_index, text_line in enumerate(segment.texts, start=1):
                    next_line_number = rendered_line_count + 1
                    logger.info(
                        "[pipeline:%s] Synthesizing line %d/%d (segment=%d, line_id=%d)",
                        project_id,
                        next_line_number,
                        total_line_count,
                        segment_index,
                        text_line.line_id,
                    )
                    line_audio_clip_path = (
                        self.store.project_path(project_id)
                        / "working"
                        / "audio"
                        / f"line-{text_line.line_id:03}.mp3"
                    )
                    if tts_available:
                        self.tts_service.synthesize_line(
                            text=text_line.text,
                            output_mp3=line_audio_clip_path,
                            voice_id=resolved_config.voice_id,
                            model_id=resolved_config.tts_model_id,
                            voice_settings=resolved_config.voice_settings,
                        )
                        clip_duration_seconds = self.tts_service.get_duration_seconds(
                            line_audio_clip_path
                        )
                        rendered_audio_clips.append(line_audio_clip_path)
                        if self.usage_tracker is not None:
                            self.usage_tracker.record_elevenlabs_request(
                                project_id,
                                model_id=resolved_config.tts_model_id,
                                voice_id=resolved_config.voice_id,
                                text=text_line.text,
                                operation="process-manuscript",
                            )
                        logger.info(
                            "[pipeline:%s] Line %d/%d synthesized",
                            project_id,
                            next_line_number,
                            total_line_count,
                        )
                    else:
                        clip_duration_seconds = self._estimate_line_duration_seconds(text_line.text)
                        logger.info(
                            "[pipeline:%s] Line %d/%d timed without TTS (duration=%.3fs)",
                            project_id,
                            next_line_number,
                            total_line_count,
                            clip_duration_seconds,
                        )

                    text_line.start = round(current_timeline_seconds, 3)
                    text_line.end = round(current_timeline_seconds + clip_duration_seconds, 3)
                    current_timeline_seconds += clip_duration_seconds
                    rendered_line_count += 1

                    is_last_line_in_segment = line_index == len(segment.texts)
                    if segment_pause_seconds > 0 and not is_last_line_in_segment:
                        append_silence(segment_pause_seconds)

            natural_segment_duration = current_timeline_seconds - segment_start_seconds
            segment_duration_override = segment.durationOverrideSeconds
            if segment_duration_override is not None:
                normalized_override = round(float(segment_duration_override), 3)
                if natural_segment_duration - normalized_override > 0.01:
                    logger.warning(
                        "[pipeline:%s] Segment %s override %.3fs is shorter than required duration %.3fs; ignoring override",
                        project_id,
                        segment.id,
                        normalized_override,
                        natural_segment_duration,
                    )
                    segment_duration_seconds = round(natural_segment_duration, 3)
                elif normalized_override > natural_segment_duration:
                    append_silence(normalized_override - natural_segment_duration)
                    segment_duration_seconds = normalized_override
                else:
                    segment_duration_seconds = normalized_override
            else:
                segment_duration_seconds = round(current_timeline_seconds - segment_start_seconds, 3)

            segment.start = round(segment_start_seconds, 3)
            segment.end = round(segment_start_seconds + segment_duration_seconds, 3)
            segment.text = "\n\n".join([text_line.displayText or text_line.text for text_line in segment.texts])
            logger.info(
                "[pipeline:%s] Segment %d/%d rendered (start=%.3fs, end=%.3fs)",
                project_id,
                segment_index,
                len(manuscript.segments),
                segment.start,
                segment.end,
            )

            if segment_pause_seconds > 0 and segment_index < len(manuscript.segments):
                append_silence(segment_pause_seconds)

        logger.info(
            "[pipeline:%s] Audio rendering completed (clips=%d)",
            project_id,
            len(rendered_audio_clips),
        )
        return rendered_audio_clips

    def _tts_is_available(self) -> bool:
        can_synthesize = getattr(self.tts_service, "can_synthesize", None)
        if callable(can_synthesize):
            try:
                return bool(can_synthesize())
            except Exception:
                logger.warning("TTS availability check failed; assuming enabled")
                return True
        return True

    def _estimate_line_duration_seconds(self, text: str) -> float:
        words = len(re.findall(r"\S+", text))
        punctuation_bonus = text.count(",") * 0.12 + sum(text.count(mark) for mark in ".:;!?") * 0.18
        estimated = 0.6 + max(words, 1) * 0.42 + punctuation_bonus
        return round(max(1.2, estimated), 3)

    def process_manuscript(
        self,
        project_id: str,
        manuscript: Manuscript | None = None,
        audio_mode: str = "elevenlabs",
    ) -> Manuscript:
        logger.info("[pipeline:%s] Manuscript processing started", project_id)
        self.store.ensure_layout(project_id)
        logger.info("[pipeline:%s] Step 1/4: Resolving processing config", project_id)
        generation_manifest = self.store.load_generation_manifest(project_id)
        resolved_config = self.config_resolver.resolve(generation_manifest)
        resolved_config = self._apply_project_config_override(project_id, resolved_config)
        logger.info("[pipeline:%s] Processing config resolved", project_id)

        logger.info("[pipeline:%s] Step 2/4: Loading manuscript", project_id)
        manuscript_to_process = self._load_manuscript_for_processing(project_id, manuscript)
        logger.info(
            "[pipeline:%s] Manuscript loaded for processing (segments=%d)",
            project_id,
            len(manuscript_to_process.segments),
        )

        logger.info("[pipeline:%s] Step 3/4: Rendering audio timeline", project_id)
        rendered_audio_clips = self._render_segment_audio_timeline(
            project_id=project_id,
            manuscript=manuscript_to_process,
            resolved_config=resolved_config,
            audio_mode=audio_mode,
        )
        logger.info(
            "[pipeline:%s] Segment audio timeline ready (clips=%d)",
            project_id,
            len(rendered_audio_clips),
        )

        logger.info("[pipeline:%s] Step 4/4: Concatenating narration and saving output", project_id)
        if rendered_audio_clips:
            full_narration_path = self.store.project_path(project_id) / "output" / "narration.mp3"
            self.tts_service.concat_mp3(rendered_audio_clips, full_narration_path)
            logger.info(
                "[pipeline:%s] Narration concatenated (%s)",
                project_id,
                full_narration_path,
            )

            project_relative_audio_path = self.store.rel_to_project(project_id, full_narration_path)
            manuscript_to_process.meta.audio = {
                "src": self._asset_url(project_id, project_relative_audio_path)
            }
        else:
            manuscript_to_process.meta.audio = {}
            logger.info(
                "[pipeline:%s] Narration skipped because audio mode is '%s'",
                project_id,
                audio_mode,
            )

        output_payload = manuscript_to_process.model_dump(mode="json", exclude_none=True)
        output_payload["meta"]["processedAt"] = datetime.now(timezone.utc).isoformat()

        self.store.save_json(project_id, "output/processed_manuscript.json", output_payload)
        if self.usage_tracker is not None:
            self.usage_tracker.record_preview_run(project_id, audio_mode=audio_mode)
        logger.info("[pipeline:%s] Manuscript processing finished", project_id)
        return manuscript_to_process

    def get_processed_file(self, project_id: str) -> Path:
        processed_file_path = self.store.project_path(project_id) / "output" / "processed_manuscript.json"
        if not processed_file_path.exists():
            raise ProjectStoreError("Processed manuscript not found")
        return processed_file_path

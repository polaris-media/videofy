from __future__ import annotations

import base64
import json
import logging
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai import OpenAI
from pydantic import BaseModel

from .openai_models import response_parse_options_for_model
from .project_store import ProjectStore

logger = logging.getLogger(__name__)


class DescriptionResult(BaseModel):
    description: str


class PlacementResult(BaseModel):
    asset_ids: list[str]


@dataclass
class AnalysisInputAsset:
    asset_id: str
    type: str
    rel_path: str
    local_path: Path
    url: str
    byline: str | None
    start_from: float | None = None
    end_at: float | None = None


@dataclass
class AssetAnalysisResult:
    assets: list[dict[str, Any]]
    placement_asset_ids: list[str]
    used_fallback_placement: bool
    hotspot_provider: str
    description_model: str
    placement_model: str


def _json_dump(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _json_load(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ms(start: float, end: float) -> int:
    return int((end - start) * 1000)


def _fallback_description(asset: dict[str, Any]) -> str:
    byline = asset.get("byline")
    rel_path = str(asset.get("rel_path", ""))
    name = Path(rel_path).name or "asset"
    kind = str(asset.get("type", "asset"))
    if byline:
        return f"{kind.capitalize()} {name} ({byline})"
    return f"{kind.capitalize()} {name}"


def _to_data_url(image_path: Path) -> str:
    suffix = image_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        mime = "image/jpeg"
    elif suffix == ".png":
        mime = "image/png"
    elif suffix == ".webp":
        mime = "image/webp"
    else:
        mime = "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _probe_dimensions(ffprobe_bin: str, media_path: Path) -> tuple[int, int]:
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        str(media_path),
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        raw = result.stdout.strip()
        width_raw, height_raw = raw.split("x", 1)
        width = int(width_raw)
        height = int(height_raw)
        if width > 0 and height > 0:
            return width, height
    except Exception:
        pass
    return 1080, 1080


def _probe_video_duration_seconds(ffprobe_bin: str, media_path: Path) -> float | None:
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        value = float(result.stdout.strip())
        if value > 0:
            return value
    except Exception:
        pass
    return None


def _clean_asset_for_json(asset: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in asset.items():
        if key.startswith("_"):
            continue
        if value is None:
            continue
        cleaned[key] = value
    return cleaned


def _is_valid_hotspot(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    required = ("x", "y", "width", "height")
    for key in required:
        if key not in value:
            return False
        if not isinstance(value[key], (int, float)):
            return False
    return True


class AssetAnalysisService:
    def __init__(
        self,
        store: ProjectStore,
        openai_api_key: str,
        ffmpeg_bin: str,
        ffprobe_bin: str,
    ):
        self._store = store
        self._ffmpeg_bin = ffmpeg_bin
        self._ffprobe_bin = ffprobe_bin
        self._client = OpenAI(api_key=openai_api_key) if openai_api_key else None

    def analyze(
        self,
        project_id: str,
        script_lines: list[str],
        input_assets: list[AnalysisInputAsset],
        describe_prompt: str,
        placement_prompt: str,
        media_model: str,
    ) -> AssetAnalysisResult:
        logger.info(
            "[asset-analysis:%s] Started (script_lines=%d, input_assets=%d)",
            project_id,
            len(script_lines),
            len(input_assets),
        )
        analysis_dir = self._store.project_path(project_id) / "working" / "analysis"
        frames_dir = analysis_dir / "frames"
        analysis_dir.mkdir(parents=True, exist_ok=True)
        frames_dir.mkdir(parents=True, exist_ok=True)

        started_at = _now_iso()
        t0 = time.perf_counter()
        analyzed_assets = self._build_analysis_input_assets(
            input_assets=input_assets,
            frames_dir=frames_dir,
        )
        logger.info(
            "[asset-analysis:%s] Step 1/4: Catalog prepared (assets=%d)",
            project_id,
            len(analyzed_assets),
        )
        t1 = time.perf_counter()

        self._write_catalog(
            project_id=project_id,
            analysis_dir=analysis_dir,
            catalog=analyzed_assets,
        )
        descriptions_payload, descriptions_by_asset_id, video_scenes_by_asset_id = (
            self._describe_media_assets(
            analysis_dir=analysis_dir,
            assets=analyzed_assets,
            describe_prompt=describe_prompt,
            model=media_model,
            )
        )
        logger.info(
            "[asset-analysis:%s] Step 2/4: Descriptions generated",
            project_id,
        )
        t2 = time.perf_counter()

        # Placement needs access to generated descriptions and scenes.
        for asset in analyzed_assets:
            asset_id = str(asset["asset_id"])
            description = descriptions_by_asset_id.get(asset_id)
            if isinstance(description, str) and description:
                asset["description"] = description
            scene_payload = video_scenes_by_asset_id.get(asset_id)
            if isinstance(scene_payload, dict):
                scenes = scene_payload.get("scenes")
                if isinstance(scenes, list) and scenes:
                    asset["videoScenes"] = scenes

        (
            placements_payload,
            placement_asset_ids,
            used_fallback_placement,
        ) = self._assign_assets_to_script_lines(
            analysis_dir=analysis_dir,
            assets=analyzed_assets,
            script_lines=script_lines,
            placement_prompt=placement_prompt,
            model=media_model,
        )
        logger.info(
            "[asset-analysis:%s] Step 3/4: Placement generated (fallback=%s)",
            project_id,
            used_fallback_placement,
        )
        t3 = time.perf_counter()

        hotspots_payload, hotspot_provider = self._predict_image_hotspots(
            analysis_dir=analysis_dir,
            assets=analyzed_assets,
        )
        logger.info(
            "[asset-analysis:%s] Step 4/4: Hotspots generated (provider=%s)",
            project_id,
            hotspot_provider,
        )
        t4 = time.perf_counter()

        hotspot_by_asset = hotspots_payload.get("assets", {})
        if not isinstance(hotspot_by_asset, dict):
            hotspot_by_asset = {}

        for asset in analyzed_assets:
            asset_id = str(asset["asset_id"])
            hotspot_entry = hotspot_by_asset.get(asset_id)
            if isinstance(hotspot_entry, dict) and _is_valid_hotspot(
                hotspot_entry.get("hotspot")
            ):
                asset["hotspot"] = hotspot_entry["hotspot"]

        self._write_catalog(
            project_id=project_id,
            analysis_dir=analysis_dir,
            catalog=analyzed_assets,
        )

        _json_dump(
            analysis_dir / "run.json",
            {
                "version": 1,
                "projectId": project_id,
                "startedAt": started_at,
                "completedAt": _now_iso(),
                "lineCount": len(script_lines),
                "assetCount": len(analyzed_assets),
                "videoAssetCount": len(
                    [asset for asset in analyzed_assets if asset.get("type") == "video"]
                ),
                "usedFallbackPlacement": used_fallback_placement,
                "descriptionModel": descriptions_payload.get("model", media_model),
                "placementModel": placements_payload.get("model", media_model),
                "hotspotProvider": hotspot_provider,
                "timingsMs": {
                    "catalog": _ms(t0, t1),
                    "descriptions": _ms(t1, t2),
                    "placements": _ms(t2, t3),
                    "hotspots": _ms(t3, t4),
                    "total": _ms(t0, t4),
                },
            },
        )

        clean_assets = [_clean_asset_for_json(asset) for asset in analyzed_assets]
        logger.info(
            "[asset-analysis:%s] Finished",
            project_id,
        )
        return AssetAnalysisResult(
            assets=clean_assets,
            placement_asset_ids=placement_asset_ids,
            used_fallback_placement=used_fallback_placement,
            hotspot_provider=hotspot_provider,
            description_model=str(descriptions_payload.get("model", media_model)),
            placement_model=str(placements_payload.get("model", media_model)),
        )

    def _write_catalog(
        self,
        project_id: str,
        analysis_dir: Path,
        catalog: list[dict[str, Any]],
    ) -> None:
        _json_dump(
            analysis_dir / "assets.catalog.json",
            {
                "version": 1,
                "projectId": project_id,
                "createdAt": _now_iso(),
                "assets": [_clean_asset_for_json(asset) for asset in catalog],
            },
        )

    def _build_analysis_input_assets(
        self,
        input_assets: list[AnalysisInputAsset],
        frames_dir: Path,
    ) -> list[dict[str, Any]]:
        catalog: list[dict[str, Any]] = []
        for idx, item in enumerate(input_assets):
            if not item.local_path.exists() or not item.local_path.is_file():
                logger.warning("Skipping missing asset file: %s", item.local_path)
                continue

            asset_type = item.type if item.type in {"image", "video"} else "image"
            asset_id = item.asset_id or f"asset-{idx + 1:03}"
            entry: dict[str, Any] = {
                "asset_id": asset_id,
                "type": asset_type,
                "rel_path": item.rel_path,
                "url": item.url,
                "byline": item.byline,
                "start_from": item.start_from,
                "end_at": item.end_at,
                "_local_path": str(item.local_path),
            }

            if asset_type == "image":
                width, height = _probe_dimensions(self._ffprobe_bin, item.local_path)
                entry["imageAsset"] = {
                    "id": item.rel_path,
                    "size": {"width": width, "height": height},
                }

            if asset_type == "video":
                duration_seconds = _probe_video_duration_seconds(
                    self._ffprobe_bin, item.local_path
                )
                if duration_seconds is not None:
                    entry["_duration_seconds"] = duration_seconds
                frames = self._extract_video_analysis_frames(
                    video_path=item.local_path,
                    frames_dir=frames_dir,
                    asset_id=asset_id,
                    duration_seconds=duration_seconds,
                )
                if frames:
                    entry["analysisFrames"] = [
                        {
                            "path": frame["rel_path"],
                            "time_seconds": frame["time_seconds"],
                        }
                        for frame in frames
                    ]
                    entry["_analysis_frame_paths"] = [
                        str(frame["path"]) for frame in frames
                    ]
                    entry["keyframe_path"] = str(frames[0]["rel_path"])
                    entry["_keyframe_local_path"] = str(frames[0]["path"])
                entry["videoAsset"] = {
                    "id": item.rel_path,
                    "title": Path(item.rel_path).name,
                    "streamUrls": {"mp4": item.url},
                }
                if duration_seconds is not None:
                    entry["videoAsset"]["duration"] = int(duration_seconds * 1000)

            catalog.append(entry)
        return catalog

    def _extract_video_analysis_frames(
        self,
        video_path: Path,
        frames_dir: Path,
        asset_id: str,
        duration_seconds: float | None,
    ) -> list[dict[str, Any]]:
        frames_dir.mkdir(parents=True, exist_ok=True)

        targets: list[float] = []
        if duration_seconds is not None and duration_seconds > 0:
            frame_count = min(6, max(2, int(duration_seconds // 4) + 1))
            step = duration_seconds / frame_count
            targets = [round(idx * step, 3) for idx in range(frame_count)]
        else:
            targets = [0.0, 1.0]

        extracted: list[dict[str, Any]] = []
        for idx, target in enumerate(targets):
            frame_path = frames_dir / f"{asset_id}-{idx + 1:03}.jpg"
            cmd = [
                self._ffmpeg_bin,
                "-y",
                "-ss",
                f"{max(0.0, target):.3f}",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                str(frame_path),
            ]
            try:
                subprocess.run(cmd, check=True, capture_output=True)
                if frame_path.exists() and frame_path.stat().st_size > 0:
                    extracted.append(
                        {
                            "path": frame_path,
                            "rel_path": f"working/analysis/frames/{frame_path.name}",
                            "time_seconds": float(target),
                        }
                    )
            except Exception:
                continue

        if extracted:
            return extracted

        fallback = frames_dir / f"{asset_id}.jpg"
        self._extract_video_keyframe(video_path, fallback)
        if fallback.exists() and fallback.stat().st_size > 0:
            return [
                {
                    "path": fallback,
                    "rel_path": f"working/analysis/frames/{fallback.name}",
                    "time_seconds": 0.0,
                }
            ]
        return []

    def _extract_video_keyframe(self, video_path: Path, frame_path: Path) -> None:
        frame_path.parent.mkdir(parents=True, exist_ok=True)
        attempts = [
            [
                self._ffmpeg_bin,
                "-y",
                "-i",
                str(video_path),
                "-vf",
                "thumbnail,scale=1280:-1",
                "-frames:v",
                "1",
                str(frame_path),
            ],
            [
                self._ffmpeg_bin,
                "-y",
                "-ss",
                "00:00:01",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                str(frame_path),
            ],
        ]
        for cmd in attempts:
            try:
                subprocess.run(cmd, check=True, capture_output=True)
                if frame_path.exists() and frame_path.stat().st_size > 0:
                    return
            except Exception:
                continue
        logger.warning("Failed to extract keyframe for video: %s", video_path)

    def _describe_media_assets(
        self,
        analysis_dir: Path,
        assets: list[dict[str, Any]],
        describe_prompt: str,
        model: str,
    ) -> tuple[dict[str, Any], dict[str, str], dict[str, dict[str, Any]]]:
        target_path = analysis_dir / "descriptions.json"
        output_descriptions: dict[str, str] = {}
        payload_assets: dict[str, Any] = {}
        video_scenes_by_asset: dict[str, dict[str, Any]] = {}

        logger.info(
            "Describing %d assets with model '%s'",
            len(assets),
            model,
        )
        for index, asset in enumerate(assets, start=1):
            asset_id = str(asset["asset_id"])
            logger.info(
                "Describing asset %d/%d: %s (type=%s)",
                index,
                len(assets),
                asset_id,
                asset.get("type"),
            )
            if asset.get("type") == "video":
                scenes = self._describe_video_scenes(
                    asset=asset,
                    describe_prompt=describe_prompt,
                    model=model,
                )
                if scenes:
                    description = " ".join(
                        scene.get("description", "").strip()
                        for scene in scenes[:3]
                        if isinstance(scene, dict) and scene.get("description")
                    ).strip()
                else:
                    description = ""
                if not description:
                    description = _fallback_description(asset)
                video_scenes_by_asset[asset_id] = {
                    "status": "ok" if scenes else "fallback",
                    "updatedAt": _now_iso(),
                    "scenes": scenes,
                }
            else:
                description = self._describe_single_asset(
                    asset=asset,
                    describe_prompt=describe_prompt,
                    model=model,
                )
            status = "ok" if self._client and describe_prompt else "fallback"
            payload_assets[asset_id] = {
                "description": description,
                "status": status,
                "updatedAt": _now_iso(),
            }
            output_descriptions[asset_id] = description

        payload = {
            "version": 1,
            "model": model,
            "createdAt": _now_iso(),
            "assets": payload_assets,
        }
        _json_dump(target_path, payload)
        _json_dump(
            analysis_dir / "video_scenes.json",
            {
                "version": 1,
                "model": model,
                "createdAt": _now_iso(),
                "assets": video_scenes_by_asset,
            },
        )
        return payload, output_descriptions, video_scenes_by_asset

    def _describe_video_scenes(
        self,
        asset: dict[str, Any],
        describe_prompt: str,
        model: str,
    ) -> list[dict[str, Any]]:
        asset_id = str(asset.get("asset_id", "video"))
        frame_paths_raw = asset.get("_analysis_frame_paths")
        frame_paths: list[Path] = []
        if isinstance(frame_paths_raw, list):
            for raw in frame_paths_raw:
                if isinstance(raw, str):
                    frame_paths.append(Path(raw))

        frame_meta_raw = asset.get("analysisFrames")
        frame_meta: list[dict[str, Any]] = []
        if isinstance(frame_meta_raw, list):
            frame_meta = [item for item in frame_meta_raw if isinstance(item, dict)]

        duration_seconds: float | None = None
        duration_raw = asset.get("_duration_seconds")
        if isinstance(duration_raw, (int, float)) and float(duration_raw) > 0:
            duration_seconds = float(duration_raw)

        if not frame_meta:
            start = float(asset.get("start_from") or 0.0)
            end = float(asset.get("end_at") or (duration_seconds or (start + 3.0)))
            if end <= start:
                end = start + 3.0
            return [
                {
                    "scene_id": f"{asset_id}-scene-001",
                    "start_seconds": round(start, 3),
                    "end_seconds": round(end, 3),
                    "description": _fallback_description(asset),
                }
            ]

        scenes: list[dict[str, Any]] = []
        for idx, meta in enumerate(frame_meta):
            start_raw = meta.get("time_seconds", 0.0)
            start_seconds = float(start_raw) if isinstance(start_raw, (int, float)) else 0.0

            next_start_seconds: float | None = None
            if idx + 1 < len(frame_meta):
                next_raw = frame_meta[idx + 1].get("time_seconds", start_seconds + 2.0)
                if isinstance(next_raw, (int, float)):
                    next_start_seconds = float(next_raw)

            end_seconds = (
                next_start_seconds
                if next_start_seconds is not None
                else duration_seconds
            )
            if end_seconds is None or end_seconds <= start_seconds:
                end_seconds = start_seconds + 2.0

            image_path = frame_paths[idx] if idx < len(frame_paths) else None
            description = self._describe_image_path(
                image_path=image_path,
                fallback_asset=asset,
                describe_prompt=describe_prompt,
                model=model,
            )
            if not description.strip():
                description = _fallback_description(asset)

            scene_id = f"{asset_id}-scene-{idx + 1:03}"
            scene: dict[str, Any] = {
                "scene_id": scene_id,
                "start_seconds": round(start_seconds, 3),
                "end_seconds": round(float(end_seconds), 3),
                "description": description.strip(),
            }
            path_value = meta.get("path")
            if isinstance(path_value, str):
                scene["frame_path"] = path_value
            scenes.append(scene)

        return scenes

    def _describe_image_path(
        self,
        image_path: Path | None,
        fallback_asset: dict[str, Any],
        describe_prompt: str,
        model: str,
    ) -> str:
        if self._client is None or not describe_prompt:
            return _fallback_description(fallback_asset)
        if image_path is None or not image_path.exists():
            return _fallback_description(fallback_asset)
        try:
            logger.info(
                "[asset-analysis] Requesting description for asset %s with model '%s'",
                fallback_asset.get("asset_id"),
                model,
            )
            data_url = _to_data_url(image_path)
            response = self._client.responses.parse(
                model=model,
                input=[
                    {"role": "system", "content": describe_prompt},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": json.dumps(
                                    {
                                        "asset_id": fallback_asset.get("asset_id"),
                                        "type": fallback_asset.get("type"),
                                        "byline": fallback_asset.get("byline"),
                                        "path": fallback_asset.get("rel_path"),
                                    },
                                    ensure_ascii=False,
                                ),
                            },
                            {"type": "input_image", "image_url": data_url},
                        ],
                    },
                ],
                text_format=DescriptionResult,
                max_output_tokens=180,
                **response_parse_options_for_model(model),
            )
            parsed = response.output_parsed
            if parsed and parsed.description.strip():
                logger.info(
                    "[asset-analysis] Description completed for asset %s",
                    fallback_asset.get("asset_id"),
                )
                return parsed.description.strip()
        except Exception as exc:
            logger.warning(
                "Asset description failed for %s: %s",
                fallback_asset.get("asset_id"),
                exc,
            )
        return _fallback_description(fallback_asset)

    def _describe_single_asset(
        self,
        asset: dict[str, Any],
        describe_prompt: str,
        model: str,
    ) -> str:
        if self._client is None or not describe_prompt:
            return _fallback_description(asset)

        image_path: Path | None = None
        if asset.get("type") == "image":
            local_path = asset.get("_local_path")
            if isinstance(local_path, str):
                image_path = Path(local_path)
        elif asset.get("type") == "video":
            keyframe_local = asset.get("_keyframe_local_path")
            if isinstance(keyframe_local, str):
                image_path = Path(keyframe_local)

        return self._describe_image_path(
            image_path=image_path,
            fallback_asset=asset,
            describe_prompt=describe_prompt,
            model=model,
        )

    def _assign_assets_to_script_lines(
        self,
        analysis_dir: Path,
        assets: list[dict[str, Any]],
        script_lines: list[str],
        placement_prompt: str,
        model: str,
    ) -> tuple[dict[str, Any], list[str], bool]:
        target_path = analysis_dir / "placements.json"
        candidate_assets = self._order_assets_for_assignment(assets)
        candidate_ids = [str(asset["asset_id"]) for asset in candidate_assets]

        used_fallback = False
        validation_errors: list[str] = []
        selected_ids: list[str]
        if not candidate_ids:
            used_fallback = True
            selected_ids = []
            if script_lines:
                validation_errors.append("no-candidate-assets")
        elif self._client is None or not placement_prompt:
            used_fallback = True
            selected_ids = self._fallback_asset_assignment(script_lines, candidate_ids)
            validation_errors.append("placement-disabled")
        else:
            model_ids = self._openai_assign_assets_to_script_lines(
                script_lines=script_lines,
                candidate_assets=candidate_assets,
                placement_prompt=placement_prompt,
                model=model,
            )
            selected_ids, validation_errors = self._validate_placement(
                candidate_ids=candidate_ids,
                script_lines=script_lines,
                selected_ids=model_ids,
            )
            if not selected_ids:
                used_fallback = True
                selected_ids = self._fallback_asset_assignment(script_lines, candidate_ids)

        payload = {
            "version": 1,
            "model": model,
            "createdAt": _now_iso(),
            "usedFallback": used_fallback,
            "validationErrors": validation_errors,
            "lineAssetIds": selected_ids,
            "lineToAsset": [
                {"line_id": idx + 1, "asset_id": asset_id}
                for idx, asset_id in enumerate(selected_ids)
            ],
        }
        _json_dump(target_path, payload)
        return payload, selected_ids, used_fallback

    def _validate_placement(
        self,
        candidate_ids: list[str],
        script_lines: list[str],
        selected_ids: list[str],
    ) -> tuple[list[str], list[str]]:
        errors: list[str] = []
        if len(selected_ids) != len(script_lines):
            errors.append("line-count-mismatch")
            return [], errors
        valid_ids = set(candidate_ids)
        if any(item not in valid_ids for item in selected_ids):
            errors.append("unknown-asset-id")
            return [], errors
        return selected_ids, errors

    def _openai_assign_assets_to_script_lines(
        self,
        script_lines: list[str],
        candidate_assets: list[dict[str, Any]],
        placement_prompt: str,
        model: str,
    ) -> list[str]:
        if self._client is None:
            return []
        try:
            logger.info(
                "[asset-analysis] Requesting placement with model '%s' (lines=%d, candidates=%d)",
                model,
                len(script_lines),
                len(candidate_assets),
            )
            response = self._client.responses.parse(
                model=model,
                input=[
                    {"role": "system", "content": placement_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "lines": [
                                    {"line_id": idx + 1, "text": text}
                                    for idx, text in enumerate(script_lines)
                                ],
                                "assets": [
                                    {
                                        "asset_id": asset["asset_id"],
                                        "type": asset["type"],
                                        "description": asset.get("description", ""),
                                        "scenes": asset.get("videoScenes", []),
                                        "byline": asset.get("byline"),
                                        "path": asset.get("rel_path"),
                                    }
                                    for asset in candidate_assets
                                ],
                            },
                            ensure_ascii=False,
                        ),
                    },
                ],
                text_format=PlacementResult,
                max_output_tokens=300,
                **response_parse_options_for_model(model),
            )
            parsed = response.output_parsed
            if parsed is None:
                return []
            selected_ids = [
                asset_id.strip()
                for asset_id in parsed.asset_ids
                if asset_id and asset_id.strip()
            ]
            logger.info(
                "[asset-analysis] Placement completed (selected=%d)",
                len(selected_ids),
            )
            return selected_ids
        except Exception as exc:
            logger.warning("Placement with OpenAI failed: %s", exc)
            return []

    def _fallback_asset_assignment(
        self,
        script_lines: list[str],
        candidate_ids: list[str],
    ) -> list[str]:
        if not candidate_ids:
            return []
        return [candidate_ids[idx % len(candidate_ids)] for idx in range(len(script_lines))]

    def _order_assets_for_assignment(
        self,
        assets: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        videos = [asset for asset in assets if asset.get("type") == "video"]
        images = [asset for asset in assets if asset.get("type") == "image"]
        return videos + images

    def _predict_image_hotspots(
        self,
        analysis_dir: Path,
        assets: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], str]:
        target_path = analysis_dir / "hotspots.json"
        image_assets = [asset for asset in assets if asset.get("type") == "image"]
        logger.info("Starting hotspot prediction for %d image assets", len(image_assets))
        if not image_assets:
            payload = {
                "version": 1,
                "provider": "noop",
                "createdAt": _now_iso(),
                "assets": {},
            }
            _json_dump(target_path, payload)
            return payload, "noop"

        input_assets: list[dict[str, str]] = []
        next_assets: dict[str, Any] = {}
        for asset in image_assets:
            asset_id = str(asset["asset_id"])
            local_path = asset.get("_local_path")
            if isinstance(local_path, str):
                input_assets.append({"asset_id": asset_id, "path": local_path})
            else:
                next_assets[asset_id] = {"status": "noop", "updatedAt": _now_iso()}

        worker_result = self._run_hotspot_worker(analysis_dir, input_assets)
        provider = str(worker_result.get("provider", "noop"))
        worker_status = str(worker_result.get("status", "unknown"))
        worker_error = worker_result.get("error")
        if provider == "noop" or worker_status != "ok":
            if isinstance(worker_error, str) and worker_error:
                logger.warning(
                    "Hotspot worker returned provider=%s status=%s error=%s",
                    provider,
                    worker_status,
                    worker_error,
                )
            else:
                logger.warning(
                    "Hotspot worker returned provider=%s status=%s",
                    provider,
                    worker_status,
                )
        worker_assets = worker_result.get("results", {})
        if not isinstance(worker_assets, dict):
            worker_assets = {}

        for asset in image_assets:
            asset_id = str(asset["asset_id"])
            hotspot_value = worker_assets.get(asset_id)
            if _is_valid_hotspot(hotspot_value):
                next_assets[asset_id] = {
                    "hotspot": hotspot_value,
                    "status": "ok",
                    "updatedAt": _now_iso(),
                }
            elif asset_id not in next_assets:
                next_assets[asset_id] = {"status": "noop", "updatedAt": _now_iso()}

        payload = {
            "version": 1,
            "provider": provider,
            "createdAt": _now_iso(),
            "assets": next_assets,
        }
        _json_dump(target_path, payload)
        hotspot_hits = sum(
            1
            for entry in next_assets.values()
            if isinstance(entry, dict) and entry.get("status") == "ok"
        )
        logger.info(
            "Hotspot prediction completed: provider=%s, matched=%d/%d",
            provider,
            hotspot_hits,
            len(image_assets),
        )
        return payload, provider

    def _run_hotspot_worker(
        self,
        analysis_dir: Path,
        items: list[dict[str, str]],
    ) -> dict[str, Any]:
        if not items:
            return {"provider": "noop", "results": {}}

        input_path = analysis_dir / "hotspot.input.json"
        output_path = analysis_dir / "hotspot.output.json"
        _json_dump(input_path, {"assets": items})

        cmd = [
            sys.executable,
            str(Path(__file__).with_name("hotspot_worker.py")),
            "--input",
            str(input_path),
            "--output",
            str(output_path),
        ]
        try:
            logger.info(
                "Launching hotspot worker for %d assets (input=%s, output=%s)",
                len(items),
                input_path,
                output_path,
            )
            with subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            ) as process:
                if process.stdout is not None:
                    for line in process.stdout:
                        line_text = line.strip()
                        if line_text:
                            logger.info("[hotspot-worker] %s", line_text)
                exit_code = process.wait()
            if exit_code != 0:
                logger.warning("Hotspot worker exited with non-zero status: %d", exit_code)
                return {"provider": "noop", "results": {}}
            logger.info("Hotspot worker finished successfully")
        except Exception as exc:
            logger.warning("Hotspot worker execution failed: %s", exc)
            return {"provider": "noop", "results": {}}
        return _json_load(output_path, {"provider": "noop", "results": {}})

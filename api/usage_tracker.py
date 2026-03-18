from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .project_store import ProjectStore, ProjectStoreError

USAGE_FILE_PATH = "working/ai-usage.json"
MAX_RECENT_EVENTS = 80


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coerce_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    return 0


def _read_field(source: Any, field_name: str) -> Any:
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(field_name)
    return getattr(source, field_name, None)


def _empty_summary(project_id: str) -> dict[str, Any]:
    return {
        "projectId": project_id,
        "updatedAt": _now_iso(),
        "totals": {
            "openai": {
                "calls": 0,
                "inputTokens": 0,
                "outputTokens": 0,
                "totalTokens": 0,
                "reasoningTokens": 0,
            },
            "elevenlabs": {
                "calls": 0,
                "characters": 0,
            },
            "preview": {
                "withoutAudio": 0,
                "withElevenLabs": 0,
            },
        },
        "recent": [],
    }


class UsageTracker:
    def __init__(self, store: ProjectStore):
        self._store = store

    def load_summary(self, project_id: str) -> dict[str, Any]:
        try:
            raw = self._store.load_json(project_id, USAGE_FILE_PATH)
        except ProjectStoreError:
            return _empty_summary(project_id)

        summary = _empty_summary(project_id)
        if not isinstance(raw, dict):
            return summary

        totals = raw.get("totals")
        recent = raw.get("recent")
        summary.update(
            {
                "projectId": str(raw.get("projectId") or project_id),
                "updatedAt": str(raw.get("updatedAt") or summary["updatedAt"]),
                "totals": totals if isinstance(totals, dict) else summary["totals"],
                "recent": recent if isinstance(recent, list) else [],
            }
        )
        return summary

    def record_preview_run(self, project_id: str, *, audio_mode: str) -> None:
        summary = self.load_summary(project_id)
        preview_totals = summary["totals"]["preview"]
        preview_key = "withElevenLabs" if audio_mode == "elevenlabs" else "withoutAudio"
        preview_totals[preview_key] = _coerce_int(preview_totals.get(preview_key)) + 1
        self._append_event(
            summary,
            {
                "provider": "preview",
                "audioMode": audio_mode,
            },
        )
        self._save(project_id, summary)

    def record_openai_response(
        self,
        project_id: str,
        *,
        model: str,
        response: Any,
        operation: str,
        fallback_from: str | None = None,
    ) -> None:
        summary = self.load_summary(project_id)
        usage = _read_field(response, "usage")
        input_tokens = _coerce_int(
            _read_field(usage, "input_tokens") or _read_field(usage, "prompt_tokens")
        )
        output_tokens = _coerce_int(
            _read_field(usage, "output_tokens") or _read_field(usage, "completion_tokens")
        )
        total_tokens = _coerce_int(_read_field(usage, "total_tokens")) or (input_tokens + output_tokens)
        output_details = _read_field(usage, "output_tokens_details")
        reasoning_tokens = _coerce_int(_read_field(output_details, "reasoning_tokens"))

        openai_totals = summary["totals"]["openai"]
        openai_totals["calls"] = _coerce_int(openai_totals.get("calls")) + 1
        openai_totals["inputTokens"] = _coerce_int(openai_totals.get("inputTokens")) + input_tokens
        openai_totals["outputTokens"] = _coerce_int(openai_totals.get("outputTokens")) + output_tokens
        openai_totals["totalTokens"] = _coerce_int(openai_totals.get("totalTokens")) + total_tokens
        openai_totals["reasoningTokens"] = (
            _coerce_int(openai_totals.get("reasoningTokens")) + reasoning_tokens
        )

        event: dict[str, Any] = {
            "provider": "openai",
            "operation": operation,
            "model": model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
            "reasoningTokens": reasoning_tokens,
        }
        if fallback_from:
            event["fallbackFrom"] = fallback_from

        self._append_event(summary, event)
        self._save(project_id, summary)

    def record_elevenlabs_request(
        self,
        project_id: str,
        *,
        model_id: str,
        voice_id: str | None,
        text: str,
        operation: str,
    ) -> None:
        summary = self.load_summary(project_id)
        characters = len(text)
        elevenlabs_totals = summary["totals"]["elevenlabs"]
        elevenlabs_totals["calls"] = _coerce_int(elevenlabs_totals.get("calls")) + 1
        elevenlabs_totals["characters"] = _coerce_int(elevenlabs_totals.get("characters")) + characters

        self._append_event(
            summary,
            {
                "provider": "elevenlabs",
                "operation": operation,
                "modelId": model_id,
                "voiceId": voice_id,
                "characters": characters,
            },
        )
        self._save(project_id, summary)

    def _append_event(self, summary: dict[str, Any], event: dict[str, Any]) -> None:
        recent = summary.get("recent")
        if not isinstance(recent, list):
            recent = []

        recent.insert(0, {"timestamp": _now_iso(), **event})
        summary["recent"] = recent[:MAX_RECENT_EVENTS]
        summary["updatedAt"] = _now_iso()

    def _save(self, project_id: str, summary: dict[str, Any]) -> None:
        self._store.save_json(project_id, USAGE_FILE_PATH, summary)

from __future__ import annotations

from typing import Any

DEFAULT_GENERATION_MODEL = "gpt-4o"
SUPPORTED_GENERATION_MODELS = ("gpt-4o", "gpt-5.1", "gpt-5.4")
GPT5_REASONING_EFFORT = "low"


def response_parse_options_for_model(model: str) -> dict[str, Any]:
    if model.startswith("gpt-5"):
        return {
            "reasoning": {
                "effort": GPT5_REASONING_EFFORT,
            }
        }
    return {}


def fallback_generation_model_for_error(model: str, error: Exception) -> str | None:
    if model == DEFAULT_GENERATION_MODEL:
        return None

    body = getattr(error, "body", None)
    error_payload = body.get("error", {}) if isinstance(body, dict) else {}
    code = str(error_payload.get("code", "")).strip().lower()
    message = str(error_payload.get("message", "")).strip().lower()
    rendered_error = str(error).strip().lower()
    error_name = error.__class__.__name__

    if code == "model_not_found":
        return DEFAULT_GENERATION_MODEL

    if "model_not_found" in rendered_error:
        return DEFAULT_GENERATION_MODEL

    if "does not have access to model" in rendered_error:
        return DEFAULT_GENERATION_MODEL

    if error_name == "PermissionDeniedError":
        return DEFAULT_GENERATION_MODEL

    return None

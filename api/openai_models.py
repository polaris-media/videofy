from __future__ import annotations

from typing import Any

DEFAULT_GENERATION_MODEL = "gpt-4o"
SUPPORTED_GENERATION_MODELS = ("gpt-4o", "gpt-5.1", "gpt-5.4")


def response_parse_options_for_model(model: str) -> dict[str, Any]:
    if model.startswith("gpt-5"):
        return {
            "reasoning": {
                "effort": "minimal",
            }
        }
    return {}

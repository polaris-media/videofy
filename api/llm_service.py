from __future__ import annotations

import json
import logging

from openai import OpenAI

from .openai_models import (
    DEFAULT_GENERATION_MODEL,
    fallback_generation_model_for_error,
    response_parse_options_for_model,
)
from .schemas import SummarizationResult
from .usage_tracker import UsageTracker

logger = logging.getLogger(__name__)


class LLMService:
    def __init__(self, api_key: str, model: str, usage_tracker: UsageTracker | None = None):
        self._api_key = api_key
        self._model = model
        self._client = OpenAI(api_key=api_key) if api_key else None
        self._usage_tracker = usage_tracker

    def summarize_into_lines(
        self,
        text: str,
        title: str,
        system_prompt: str,
        model_override: str | None = None,
        project_id: str | None = None,
    ) -> list[str]:
        if not self._api_key:
            raise ValueError(
                "OPENAI_API_KEY is required to summarize article text when script_lines are not provided"
            )
        if self._client is None:
            raise ValueError("OpenAI client is not initialized")

        logger.info(
            "[llm] Requesting script summary with model '%s' (title=%r, text_chars=%d)",
            model_override or self._model,
            title,
            len(text),
        )
        selected_model = model_override or self._model
        fallback_from: str | None = None
        try:
            response = self._request_summary_response(
                selected_model=selected_model,
                text=text,
                title=title,
                system_prompt=system_prompt,
            )
        except Exception as error:
            fallback_model = fallback_generation_model_for_error(selected_model, error)
            if fallback_model is None:
                raise

            logger.warning(
                "[llm] Falling back from model '%s' to '%s' after access error: %s",
                selected_model,
                fallback_model,
                error,
            )
            fallback_from = selected_model
            selected_model = fallback_model
            response = self._request_summary_response(
                selected_model=selected_model,
                text=text,
                title=title,
                system_prompt=system_prompt,
            )

        if project_id and self._usage_tracker is not None:
            self._usage_tracker.record_openai_response(
                project_id,
                model=selected_model,
                response=response,
                operation="generate-manuscript",
                fallback_from=fallback_from,
            )

        parsed = response.output_parsed
        if parsed is None:
            raise ValueError("OpenAI summarization did not return a parseable response")

        lines = [line.strip() for line in parsed.lines if line and line.strip()]
        if not lines:
            raise ValueError("OpenAI summarization produced no usable script lines")
        logger.info("[llm] Script summary completed (lines=%d)", len(lines))
        return lines

    def _request_summary_response(
        self,
        *,
        selected_model: str,
        text: str,
        title: str,
        system_prompt: str,
    ):
        return self._client.responses.parse(
            model=selected_model,
            instructions=system_prompt,
            input=json.dumps({"title": title, "text": text}, ensure_ascii=False),
            text_format=SummarizationResult,
            max_output_tokens=400,
            **response_parse_options_for_model(selected_model),
        )

from api.openai_models import (
    DEFAULT_GENERATION_MODEL,
    fallback_generation_model_for_error,
    response_parse_options_for_model,
)


def test_gpt_5_models_use_supported_reasoning_effort():
    for model in ("gpt-5", "gpt-5.1", "gpt-5.4"):
        assert response_parse_options_for_model(model) == {
            "reasoning": {
                "effort": "low",
            }
        }


def test_non_gpt_5_models_do_not_add_reasoning_options():
    assert response_parse_options_for_model("gpt-4o") == {}


class FakePermissionDeniedError(Exception):
    def __init__(self, body):
        super().__init__("permission denied")
        self.body = body


def test_model_access_error_falls_back_to_default_generation_model():
    error = FakePermissionDeniedError(
        {
            "error": {
                "message": "Project does not have access to model gpt-5.4",
                "code": "model_not_found",
            }
        }
    )

    assert fallback_generation_model_for_error("gpt-5.4", error) == DEFAULT_GENERATION_MODEL


def test_default_model_does_not_fallback():
    error = FakePermissionDeniedError(
        {
            "error": {
                "message": "Project does not have access to model gpt-4o",
                "code": "model_not_found",
            }
        }
    )

    assert fallback_generation_model_for_error(DEFAULT_GENERATION_MODEL, error) is None

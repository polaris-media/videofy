from types import SimpleNamespace

from api.llm_service import LLMService


class FakePermissionDeniedError(Exception):
    def __init__(self, body):
        super().__init__("permission denied")
        self.body = body


class FakeResponses:
    def __init__(self):
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            raise FakePermissionDeniedError(
                {
                    "error": {
                        "message": "Project does not have access to model gpt-5.4",
                        "code": "model_not_found",
                    }
                }
            )

        return SimpleNamespace(output_parsed=SimpleNamespace(lines=["Linje 1", "Linje 2"]))


def test_summarize_into_lines_falls_back_to_default_model_on_access_error():
    service = LLMService(api_key="test-key", model="gpt-5.4")
    fake_responses = FakeResponses()
    service._client = SimpleNamespace(responses=fake_responses)

    lines = service.summarize_into_lines(
        text="Testtekst",
        title="Tittel",
        system_prompt="Skriv korte linjer",
    )

    assert lines == ["Linje 1", "Linje 2"]
    assert [call["model"] for call in fake_responses.calls] == ["gpt-5.4", "gpt-4o"]

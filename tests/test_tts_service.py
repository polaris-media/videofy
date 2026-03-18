from pathlib import Path
from subprocess import CompletedProcess

import api.tts_service as tts_module


class FakeTextToSpeechAPI:
    def __init__(self):
        self.calls: list[dict] = []

    def convert(self, **kwargs):
        self.calls.append(kwargs)
        return [b"abc"]


class FakeElevenLabsClient:
    last_instance = None

    def __init__(self, api_key: str, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url
        self.text_to_speech = FakeTextToSpeechAPI()
        FakeElevenLabsClient.last_instance = self


def test_tts_service_calls_elevenlabs_convert_with_voice_id(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(tts_module, "ElevenLabs", FakeElevenLabsClient)

    service = tts_module.ElevenLabsService(
        api_key="test-api-key",
        voice_id="fallback-voice",
        ffprobe_bin="ffprobe",
        ffmpeg_bin="ffmpeg",
    )

    out = tmp_path / "line.mp3"
    service.synthesize_line(
        text="Hei verden",
        output_mp3=out,
        voice_id="brand-voice-id",
        model_id="eleven_multilingual_v2",
        voice_settings={"stability": 1.0, "similarity_boost": 1.0},
    )

    client = FakeElevenLabsClient.last_instance
    assert client is not None
    assert client.base_url is None
    assert len(client.text_to_speech.calls) == 1

    payload = client.text_to_speech.calls[0]
    assert payload["voice_id"] == "brand-voice-id"
    assert payload["model_id"] == "eleven_multilingual_v2"
    assert payload["text"] == "Hei verden"
    assert payload["output_format"] == "mp3_44100_128"
    assert "voice_settings" in payload
    assert out.read_bytes() == b"abc"


def test_tts_service_uses_residency_base_url_from_api_key(monkeypatch):
    monkeypatch.setattr(tts_module, "ElevenLabs", FakeElevenLabsClient)

    service = tts_module.ElevenLabsService(
        api_key="test_residency_eu",
        voice_id="fallback-voice",
        ffprobe_bin="ffprobe",
        ffmpeg_bin="ffmpeg",
    )

    assert service.can_synthesize() is True
    client = FakeElevenLabsClient.last_instance
    assert client is not None
    assert client.base_url == "https://api.eu.residency.elevenlabs.io"


def test_tts_service_prefers_explicit_base_url(monkeypatch):
    monkeypatch.setattr(tts_module, "ElevenLabs", FakeElevenLabsClient)

    service = tts_module.ElevenLabsService(
        api_key="test_residency_eu",
        base_url="https://custom.elevenlabs.test",
        voice_id="fallback-voice",
        ffprobe_bin="ffprobe",
        ffmpeg_bin="ffmpeg",
    )

    assert service.can_synthesize() is True
    client = FakeElevenLabsClient.last_instance
    assert client is not None
    assert client.base_url == "https://custom.elevenlabs.test"


def test_local_macos_tts_service_synthesizes_with_nora(monkeypatch, tmp_path: Path):
    calls: list[list[str]] = []

    def fake_run(cmd, check, capture_output, text=False):
        calls.append(cmd)
        if cmd == ["say", "-v", "?"]:
            return CompletedProcess(
                cmd,
                0,
                stdout="Nora                nb_NO    # Hei! Jeg heter Nora.\n",
                stderr="",
            )
        if cmd[:6] == ["say", "-v", "Nora", "-r", "145", "-o"]:
            Path(cmd[6]).write_bytes(b"aiff")
            return CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd[0] == "ffmpeg":
            Path(cmd[-1]).write_bytes(b"mp3")
            return CompletedProcess(cmd, 0, stdout=b"", stderr=b"")
        raise AssertionError(f"Unexpected command: {cmd}")

    monkeypatch.setattr(tts_module.sys, "platform", "darwin", raising=False)
    monkeypatch.setattr(tts_module.shutil, "which", lambda name: "/usr/bin/say")
    monkeypatch.setattr(tts_module.subprocess, "run", fake_run)

    service = tts_module.MacOSSayTTSService(
        enabled=True,
        voice_name="Nora",
        speech_rate=145,
        ffprobe_bin="ffprobe",
        ffmpeg_bin="ffmpeg",
    )

    output = tmp_path / "line.mp3"
    assert service.can_synthesize() is True

    service.synthesize_line(text="Hei fra lokal stemme", output_mp3=output)

    assert output.read_bytes() == b"mp3"
    assert calls[0] == ["say", "-v", "?"]
    assert calls[1][:6] == ["say", "-v", "Nora", "-r", "145", "-o"]
    assert calls[2][0] == "ffmpeg"


def test_composite_tts_prefers_first_available_provider(tmp_path: Path):
    class UnavailableProvider:
        def can_synthesize(self) -> bool:
            return False

    class FakeProvider:
        def __init__(self):
            self.called = False

        def can_synthesize(self) -> bool:
            return True

        def synthesize_line(self, text: str, output_mp3: Path, **_kwargs) -> None:
            self.called = True
            output_mp3.parent.mkdir(parents=True, exist_ok=True)
            output_mp3.write_bytes(text.encode("utf-8"))

    provider = FakeProvider()
    service = tts_module.CompositeTTSService(
        providers=[UnavailableProvider(), provider],
        ffprobe_bin="ffprobe",
        ffmpeg_bin="ffmpeg",
    )

    output = tmp_path / "line.mp3"
    assert service.can_synthesize() is True

    service.synthesize_line(text="Hei", output_mp3=output)

    assert provider.called is True
    assert output.read_bytes() == b"Hei"

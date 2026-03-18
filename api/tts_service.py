from __future__ import annotations

import logging
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

try:
    from elevenlabs import VoiceSettings
    from elevenlabs.client import ElevenLabs
except ImportError:  # pragma: no cover - backward compatibility
    try:
        from elevenlabs import VoiceSettings
        from elevenlabs import ElevenLabs
    except ImportError:  # pragma: no cover - local TTS should still work without the SDK
        VoiceSettings = None  # type: ignore[assignment]
        ElevenLabs = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

ELEVENLABS_RESIDENCY_BASE_URLS = {
    "eu": "https://api.eu.residency.elevenlabs.io",
    "in": "https://api.in.residency.elevenlabs.io",
}


def resolve_elevenlabs_base_url(api_key: str, base_url: str | None = None) -> str | None:
    if base_url and base_url.strip():
        return base_url.strip()

    match = re.search(r"_residency_(?P<region>[a-z]+)$", api_key.strip())
    if not match:
        return None

    return ELEVENLABS_RESIDENCY_BASE_URLS.get(match.group("region"))


@runtime_checkable
class TTSService(Protocol):
    def can_synthesize(self) -> bool: ...

    def synthesize_line(
        self,
        text: str,
        output_mp3: Path,
        voice_id: str | None = None,
        model_id: str = "eleven_turbo_v2_5",
        voice_settings: dict[str, Any] | None = None,
    ) -> None: ...

    def get_duration_seconds(self, audio_file: Path) -> float: ...

    def concat_mp3(self, inputs: list[Path], output_file: Path) -> None: ...

    def create_silence_mp3(self, duration_seconds: float, output_file: Path) -> None: ...


class AudioToolsMixin:
    def __init__(self, ffprobe_bin: str, ffmpeg_bin: str):
        self._ffprobe_bin = ffprobe_bin
        self._ffmpeg_bin = ffmpeg_bin

    def get_duration_seconds(self, audio_file: Path) -> float:
        cmd = [
            self._ffprobe_bin,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_file),
        ]
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        return max(0.0, float(result.stdout.strip() or 0.0))

    def concat_mp3(self, inputs: list[Path], output_file: Path) -> None:
        if not inputs:
            raise ValueError("Cannot concatenate zero audio files")

        output_file.parent.mkdir(parents=True, exist_ok=True)
        concat_file = output_file.parent / "concat.txt"
        concat_lines = [f"file '{path.resolve()}'" for path in inputs]
        concat_file.write_text("\n".join(concat_lines), encoding="utf-8")

        cmd = [
            self._ffmpeg_bin,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(output_file),
        ]
        subprocess.run(cmd, check=True, capture_output=True)

    def create_silence_mp3(self, duration_seconds: float, output_file: Path) -> None:
        if duration_seconds <= 0:
            raise ValueError("Silence duration must be positive")

        output_file.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            self._ffmpeg_bin,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=mono",
            "-t",
            f"{duration_seconds:.3f}",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(output_file),
        ]
        subprocess.run(cmd, check=True, capture_output=True)


class ElevenLabsService(AudioToolsMixin):
    def __init__(
        self,
        api_key: str,
        voice_id: str,
        ffprobe_bin: str,
        ffmpeg_bin: str,
        base_url: str | None = None,
    ):
        super().__init__(ffprobe_bin=ffprobe_bin, ffmpeg_bin=ffmpeg_bin)
        self._api_key = api_key
        self._voice_id = voice_id
        self._base_url = resolve_elevenlabs_base_url(api_key=api_key, base_url=base_url)
        if self._base_url:
            logger.info("Using ElevenLabs base URL %s", self._base_url)
        self._client = (
            ElevenLabs(api_key=self._api_key, base_url=self._base_url)
            if self._api_key and ElevenLabs
            else None
        )

    def can_synthesize(self) -> bool:
        return self._client is not None

    def synthesize_line(
        self,
        text: str,
        output_mp3: Path,
        voice_id: str | None = None,
        model_id: str = "eleven_turbo_v2_5",
        voice_settings: dict[str, Any] | None = None,
    ) -> None:
        if not self._client:
            raise ValueError("ELEVENLABS_API_KEY is required for manuscript processing")

        output_mp3.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "voice_id": voice_id or self._voice_id,
            "model_id": model_id,
            "output_format": "mp3_44100_128",
            "text": text,
        }
        if voice_settings:
            try:
                if VoiceSettings is not None:
                    payload["voice_settings"] = VoiceSettings(**voice_settings)
                else:
                    payload["voice_settings"] = voice_settings
            except Exception:
                payload["voice_settings"] = voice_settings

        logger.info(
            "Calling ElevenLabs text_to_speech.convert with voice_id=%s model_id=%s",
            payload["voice_id"],
            model_id,
        )
        audio_stream = self._client.text_to_speech.convert(**payload)

        with output_mp3.open("wb") as handle:
            if isinstance(audio_stream, (bytes, bytearray)):
                handle.write(audio_stream)
            else:
                for chunk in audio_stream:
                    if chunk:
                        handle.write(chunk)


class MacOSSayTTSService(AudioToolsMixin):
    def __init__(
        self,
        enabled: bool,
        voice_name: str,
        speech_rate: int,
        ffprobe_bin: str,
        ffmpeg_bin: str,
    ):
        super().__init__(ffprobe_bin=ffprobe_bin, ffmpeg_bin=ffmpeg_bin)
        self._enabled = enabled
        self._voice_name = voice_name.strip() or "Nora"
        self._speech_rate = max(80, min(int(speech_rate), 260))
        self._resolved_voice_name: str | None = None
        self._voices_loaded = False

    def can_synthesize(self) -> bool:
        return self._enabled and self._resolve_voice_name() is not None

    def _resolve_voice_name(self) -> str | None:
        if self._voices_loaded:
            return self._resolved_voice_name

        self._voices_loaded = True
        if not self._enabled:
            return None
        if sys.platform != "darwin":
            logger.warning("Local TTS is enabled, but only macOS say is supported in this build")
            return None
        if shutil.which("say") is None:
            logger.warning("Local TTS is enabled, but the macOS 'say' binary was not found")
            return None

        cmd = ["say", "-v", "?"]
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        available_voices: list[str] = []
        for line in result.stdout.splitlines():
            match = re.match(r"^(?P<voice>.+?)\s{2,}[A-Za-z_]+(?:-[A-Za-z_]+)?\s+#", line)
            if match:
                available_voices.append(match.group("voice").strip())

        requested = self._voice_name.casefold()
        for voice in available_voices:
            if voice.casefold() == requested:
                self._resolved_voice_name = voice
                break
        if self._resolved_voice_name is None:
            for voice in available_voices:
                if voice.casefold().startswith(requested):
                    self._resolved_voice_name = voice
                    break

        if self._resolved_voice_name is None:
            logger.warning(
                "Local TTS voice '%s' was not found. Available voices: %s",
                self._voice_name,
                ", ".join(available_voices[:20]),
            )

        return self._resolved_voice_name

    def synthesize_line(
        self,
        text: str,
        output_mp3: Path,
        voice_id: str | None = None,
        model_id: str = "local-macos-say",
        voice_settings: dict[str, Any] | None = None,
    ) -> None:
        resolved_voice_name = self._resolve_voice_name()
        if resolved_voice_name is None:
            raise ValueError(
                "LOCAL_TTS_ENABLED=true requires a working macOS 'say' voice for manuscript processing"
            )

        del voice_id, model_id, voice_settings

        output_mp3.parent.mkdir(parents=True, exist_ok=True)
        intermediate_file = output_mp3.with_suffix(".aiff")
        try:
            say_cmd = [
                "say",
                "-v",
                resolved_voice_name,
                "-r",
                str(self._speech_rate),
                "-o",
                str(intermediate_file),
                text,
            ]
            subprocess.run(say_cmd, check=True, capture_output=True, text=True)

            ffmpeg_cmd = [
                self._ffmpeg_bin,
                "-y",
                "-i",
                str(intermediate_file),
                "-vn",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "2",
                str(output_mp3),
            ]
            subprocess.run(ffmpeg_cmd, check=True, capture_output=True)
        finally:
            intermediate_file.unlink(missing_ok=True)


class CompositeTTSService(AudioToolsMixin):
    def __init__(self, providers: list[TTSService], ffprobe_bin: str, ffmpeg_bin: str):
        super().__init__(ffprobe_bin=ffprobe_bin, ffmpeg_bin=ffmpeg_bin)
        self._providers = providers

    def _active_provider(self) -> TTSService | None:
        for provider in self._providers:
            try:
                if provider.can_synthesize():
                    return provider
            except Exception:
                logger.exception("TTS provider availability check failed")
        return None

    def can_synthesize(self) -> bool:
        return self._active_provider() is not None

    def synthesize_line(
        self,
        text: str,
        output_mp3: Path,
        voice_id: str | None = None,
        model_id: str = "eleven_turbo_v2_5",
        voice_settings: dict[str, Any] | None = None,
    ) -> None:
        provider = self._active_provider()
        if provider is None:
            raise ValueError("No enabled TTS provider is available for manuscript processing")

        provider_name = type(provider).__name__
        logger.info("Synthesizing narration with %s", provider_name)
        provider.synthesize_line(
            text=text,
            output_mp3=output_mp3,
            voice_id=voice_id,
            model_id=model_id,
            voice_settings=voice_settings,
        )

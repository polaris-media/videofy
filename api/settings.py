from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        populate_by_name=True,
        extra="ignore",
    )

    app_host: str = "0.0.0.0"
    app_port: int = 8001
    app_base_url: str = "http://127.0.0.1:8001"

    projects_root: Path = Field(default=Path("projects"))
    config_root: Path = Field(default=Path("brands"))

    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    elevenlabs_api_key: str = ""
    elevenlabs_base_url: str = ""
    local_tts_enabled: bool = False
    local_tts_voice: str = "Nora"
    local_tts_rate: int = 145

    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    segment_pause_seconds: float = 0.4
    cors_allow_origins: str = "http://127.0.0.1:3000,http://localhost:3000"

    @property
    def projects_root_abs(self) -> Path:
        return self.projects_root.resolve()

    @property
    def config_root_abs(self) -> Path:
        return self.config_root.resolve()

    @property
    def cors_allow_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]


def get_settings() -> Settings:
    return Settings()

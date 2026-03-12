from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import AppState, create_files_router, router
from .asset_analysis import AssetAnalysisService
from .config_resolver import ConfigResolver
from .llm_service import LLMService
from .pipeline import PipelineService
from .project_store import ProjectStore
from .settings import Settings, get_settings
from .tts_service import CompositeTTSService, ElevenLabsService, MacOSSayTTSService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    store = ProjectStore(settings.projects_root_abs)
    resolver = ConfigResolver(settings.config_root_abs)
    llm = LLMService(api_key=settings.openai_api_key, model=settings.openai_model)
    tts = CompositeTTSService(
        providers=[
            ElevenLabsService(
                api_key=settings.elevenlabs_api_key,
                voice_id="",
                ffprobe_bin=settings.ffprobe_bin,
                ffmpeg_bin=settings.ffmpeg_bin,
            ),
            MacOSSayTTSService(
                enabled=settings.local_tts_enabled,
                voice_name=settings.local_tts_voice,
                speech_rate=settings.local_tts_rate,
                ffprobe_bin=settings.ffprobe_bin,
                ffmpeg_bin=settings.ffmpeg_bin,
            ),
        ],
        ffprobe_bin=settings.ffprobe_bin,
        ffmpeg_bin=settings.ffmpeg_bin,
    )
    asset_analysis = AssetAnalysisService(
        store=store,
        openai_api_key=settings.openai_api_key,
        ffmpeg_bin=settings.ffmpeg_bin,
        ffprobe_bin=settings.ffprobe_bin,
    )

    pipeline = PipelineService(
        settings=settings,
        store=store,
        llm_service=llm,
        tts_service=tts,
        config_resolver=resolver,
        asset_analysis_service=asset_analysis,
    )

    app_state = AppState(
        store=store,
        pipeline=pipeline,
        app_base_url=settings.app_base_url,
    )

    app = FastAPI(title="Videofy Minimal")
    app.state.app_state = app_state
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    static_dir = Path(__file__).parent / "static"
    static_index = static_dir / "index.html"
    has_static = static_dir.is_dir() and static_index.is_file()
    if has_static:
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    def index():
        if has_static:
            return FileResponse(static_index)
        return {
            "name": "Videofy Minimal API",
            "status": "ok",
            "docs": "/docs",
            "health": "/health",
        }

    @app.get("/health")
    def health():
        return {"status": "ok"}

    app.include_router(router)
    app.include_router(create_files_router(app_state))

    return app

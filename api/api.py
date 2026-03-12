from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from .config_resolver import ConfigResolverError
from .pipeline import PipelineService
from .project_store import ProjectStore, ProjectStoreError
from .schemas import GenerateRequest, GenerationResponse, ProcessRequest, UploadResponse

logger = logging.getLogger(__name__)


@dataclass
class AppState:
    store: ProjectStore
    pipeline: PipelineService
    app_base_url: str


router = APIRouter(prefix="/api")


def get_state(request: Request) -> AppState:
    state: AppState | None = getattr(request.app.state, "app_state", None)
    if state is None:
        raise RuntimeError("Application state not initialized")
    return state


def _save_uploaded_file(
    state: AppState,
    project_id: str,
    file: UploadFile,
    upload_kind: str,
) -> UploadResponse:
    suffix = Path(file.filename or "upload.bin").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file.file.read())
        tmp_path = Path(tmp.name)

    try:
        saved = state.store.save_upload(project_id, "working/uploads", tmp_path, file.filename or upload_kind)
        project_relative_path = state.store.rel_to_project(project_id, saved)
        return UploadResponse(
            path=project_relative_path,
            url=f"{state.app_base_url}/projects/{project_id}/files/{project_relative_path}",
        )
    except ProjectStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.get("/projects")
def list_projects(state: AppState = Depends(get_state)) -> dict:
    return {"projects": state.store.list_projects()}


@router.get("/projects/{project_id}")
def get_project(project_id: str, state: AppState = Depends(get_state)) -> dict:
    try:
        state.store.ensure_layout(project_id)
        article = state.store.load_article(project_id).model_dump(mode="json", exclude_none=True)
        manifest = state.store.load_generation_manifest(project_id).model_dump(
            mode="json", exclude_none=True
        )
    except ProjectStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    project_dir = state.store.project_path(project_id)
    has_manuscript = (project_dir / "working/manuscript.json").exists()
    has_processed = (project_dir / "output/processed_manuscript.json").exists()

    return {
        "project_id": project_id,
        "manifest": manifest,
        "article": article,
        "has_manuscript": has_manuscript,
        "has_processed": has_processed,
    }


@router.post("/projects/{project_id}/generate", response_model=GenerationResponse)
def generate_project(
    project_id: str,
    payload: GenerateRequest,
    state: AppState = Depends(get_state),
) -> GenerationResponse:
    logger.info("[api] /generate started for project '%s'", project_id)
    try:
        manuscript = state.pipeline.generate_manuscript(
            project_id,
            script_prompt_override=payload.script_prompt,
            model_override=payload.model,
        )
    except ProjectStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConfigResolverError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "[api] /generate finished for project '%s' (segments=%d)",
        project_id,
        len(manuscript.segments),
    )
    return GenerationResponse(
        project_id=project_id,
        status="generated",
        manuscript_json=manuscript.model_dump(mode="json", exclude_none=True),
        processed_json=None,
    )


@router.post("/projects/{project_id}/process", response_model=GenerationResponse)
def process_project(
    project_id: str,
    payload: ProcessRequest,
    state: AppState = Depends(get_state),
) -> GenerationResponse:
    try:
        processed = state.pipeline.process_manuscript(project_id, payload.manuscript)
    except ProjectStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConfigResolverError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return GenerationResponse(
        project_id=project_id,
        status="processed",
        manuscript_json=None,
        processed_json=processed.model_dump(mode="json", exclude_none=True),
    )


@router.post("/projects/{project_id}/upload-image", response_model=UploadResponse)
def upload_image(
    project_id: str,
    file: UploadFile = File(...),
    state: AppState = Depends(get_state),
) -> UploadResponse:
    return _save_uploaded_file(state=state, project_id=project_id, file=file, upload_kind="image")


@router.post("/projects/{project_id}/upload-audio", response_model=UploadResponse)
def upload_audio(
    project_id: str,
    file: UploadFile = File(...),
    state: AppState = Depends(get_state),
) -> UploadResponse:
    return _save_uploaded_file(state=state, project_id=project_id, file=file, upload_kind="audio")


@router.get("/projects/{project_id}/article")
def get_project_article(project_id: str, state: AppState = Depends(get_state)) -> dict:
    try:
        article = state.store.load_article(project_id)
        return article.model_dump(mode="json", exclude_none=True)
    except ProjectStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def create_files_router(state: AppState) -> APIRouter:
    files_router = APIRouter()

    @files_router.get("/projects/{project_id}/files/{file_path:path}")
    def project_file(project_id: str, file_path: str):
        try:
            path = state.store.resolve_asset_path(project_id, file_path)
            return FileResponse(path)
        except ProjectStoreError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return files_router

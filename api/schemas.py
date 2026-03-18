from datetime import datetime, timezone
from typing import Any, Literal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class ArticleImageInput(BaseModel):
    path: str
    byline: str | None = None


class ArticleVideoInput(BaseModel):
    path: str
    byline: str | None = None
    start_from: float | None = None
    end_at: float | None = None


class ArticleInput(BaseModel):
    title: str
    byline: str = ""
    pubdate: datetime
    text: str
    script_lines: list[str] | None = None
    images: list[ArticleImageInput] = Field(default_factory=list)
    videos: list[ArticleVideoInput] = Field(default_factory=list)


class GenerationManifestOptions(BaseModel):
    orientationDefault: Literal["vertical", "horizontal"] = "vertical"
    segmentPauseSeconds: float | None = None


class GenerationManifest(BaseModel):
    projectId: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
    brandId: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")] = "default"
    promptPack: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")] = "default"
    voicePack: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")] = "default"
    options: GenerationManifestOptions = Field(default_factory=GenerationManifestOptions)
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TextLine(BaseModel):
    type: Literal["text"] = "text"
    text: str
    line_id: int
    who: str = "default"
    start: float | None = None
    end: float | None = None
    displayText: str | None = None


class Hotspot(BaseModel):
    x: float
    y: float
    width: float
    height: float
    x_norm: float | None = None
    y_norm: float | None = None
    width_norm: float | None = None
    height_norm: float | None = None


class MediaSize(BaseModel):
    width: int
    height: int


class ImageAssetRef(BaseModel):
    id: str
    size: MediaSize


class VideoStreamUrls(BaseModel):
    hls: str | None = None
    hds: str | None = None
    mp4: str | None = None
    pseudostreaming: list[str] | None = None


class VideoAssetRef(BaseModel):
    id: str
    title: str
    streamUrls: VideoStreamUrls
    assetType: Literal["audio", "video"] | None = None
    displays: int | None = None
    duration: float | None = None


class MapLocation(BaseModel):
    lat: float
    lon: float
    stillTime: float | None = None
    zoomStart: float | None = None
    zoomEnd: float | None = None
    rotation: float | None = None


class MediaAssetImage(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["image"] = "image"
    path: str
    url: str
    byline: str | None = None
    displayMode: Literal["cover", "contain-blur"] | None = None
    imageAsset: ImageAssetRef | None = None
    hotspot: Hotspot | None = None
    description: str | None = None


class MediaAssetVideo(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["video"] = "video"
    path: str
    url: str
    byline: str | None = None
    start_from: float | None = None
    end_at: float | None = None
    changedId: str | None = None
    videoAsset: VideoAssetRef | None = None
    description: str | None = None


class MediaAssetMap(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["map"] = "map"
    location: MapLocation
    label: str | None = None
    showLabel: bool | None = None
    detailLevel: Literal["overview", "standard", "close"] | None = None


class CustomAudio(BaseModel):
    src: str | None = None
    length: float | None = None


class Segment(BaseModel):
    id: int
    mood: str = "neutral"
    type: str = "segment"
    style: str = "bottom"
    cameraMovement: str = "none"
    texts: list[TextLine]
    text: str | None = None
    durationOverrideSeconds: float | None = None
    images: list[MediaAssetImage | MediaAssetVideo | MediaAssetMap] = Field(default_factory=list)
    customAudio: CustomAudio | None = None
    start: float | None = None
    end: float | None = None


class ManuscriptMeta(BaseModel):
    title: str
    byline: str
    pubdate: datetime
    id: int = 1
    uniqueId: str
    articleUrl: str | None = None
    description: str = ""
    audio: dict[str, Any] = Field(default_factory=dict)


class Manuscript(BaseModel):
    meta: ManuscriptMeta
    segments: list[Segment]
    media: list[MediaAssetImage | MediaAssetVideo | MediaAssetMap] | None = None


class GenerateRequest(BaseModel):
    script_prompt: str | None = None
    model: Literal["gpt-4o", "gpt-5.1", "gpt-5.4"] | None = None


class ProcessRequest(BaseModel):
    manuscript: Manuscript | None = None
    audio_mode: Literal["none", "elevenlabs"] = "elevenlabs"


class GenerationResponse(BaseModel):
    project_id: str
    status: str
    manuscript_json: dict | None = None
    processed_json: dict | None = None


class UploadResponse(BaseModel):
    path: str
    url: str


class SummarizationResult(BaseModel):
    lines: list[str]

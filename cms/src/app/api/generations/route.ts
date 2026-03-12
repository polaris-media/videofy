import { NextRequest, NextResponse } from "next/server";
import { appConfigSchema, manuscriptSchema } from "@videofy/types";
import { z } from "zod";
import {
  cmsGenerationPath,
  generationManifestPath,
  listProjectIds,
  readJson,
  writeJson,
} from "@/lib/projectFiles";
import { resolveConfigForProject } from "@/lib/configResolver";

const projectIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const FALLBACK_IMAGE_SIZE = { width: 1080, height: 1080 };
const ALLOWED_MOODS = new Set([
  "mellow",
  "sad",
  "dramatic",
  "neutral",
  "hopeful",
  "upbeat",
] as const);
const ALLOWED_STYLES = new Set(["top", "middle", "bottom"] as const);
const ALLOWED_CAMERA_MOVEMENTS = new Set([
  "none",
  "pan-left",
  "pan-right",
  "pan-up",
  "pan-down",
  "zoom-in",
  "zoom-out",
  "zoom-rotate-left",
  "zoom-rotate-right",
  "zoom-out-rotate-left",
  "zoom-out-rotate-right",
] as const);
const ALLOWED_MAP_DETAIL_LEVELS = new Set([
  "overview",
  "standard",
  "close",
] as const);

const generationTabSchema = z.object({
  articleUrl: z.string().min(1),
  manuscript: z.unknown(),
  projectId: projectIdSchema.optional(),
  backendGenerationId: z.string().min(1).optional(),
});

type GenerationTab = z.infer<typeof generationTabSchema>;
type GenerationConfig = z.infer<typeof appConfigSchema>;

type GenerationRecord = {
  id: string;
  projectId: string;
  data: GenerationTab[];
  retiredProjectIds?: string[];
  config?: GenerationConfig;
  brandId?: string;
  project?: {
    id: string;
    name: string;
  };
  createdDate: string;
  updatedAt: string;
};

const postBodySchema = z.object({
  projectId: projectIdSchema.optional(),
  data: z.array(generationTabSchema).min(1),
  retiredProjectIds: z.array(projectIdSchema).optional(),
  config: appConfigSchema.optional(),
  brandId: projectIdSchema.optional(),
  project: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
});

const putBodySchema = z.object({
  id: z.string().min(1),
  data: z.array(generationTabSchema),
  retiredProjectIds: z.array(projectIdSchema).optional(),
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected error";
}

function toDefinedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toDefinedNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toDefinedUrl(value: unknown): string | undefined {
  const maybeString = toDefinedString(value);
  if (!maybeString) {
    return undefined;
  }

  try {
    new URL(maybeString);
    return maybeString;
  } catch {
    return undefined;
  }
}

function toDateTimeString(value: unknown): string {
  const maybeString = toDefinedString(value);
  if (!maybeString) {
    return new Date().toISOString();
  }

  const parsed = new Date(maybeString);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeHotspot(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const hotspot = value as Record<string, unknown>;
  const x = toDefinedNumber(hotspot.x);
  const y = toDefinedNumber(hotspot.y);
  const width = toDefinedNumber(hotspot.width);
  const height = toDefinedNumber(hotspot.height);

  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }

  return {
    x,
    y,
    width,
    height,
    x_norm: toDefinedNumber(hotspot.x_norm),
    y_norm: toDefinedNumber(hotspot.y_norm),
    width_norm: toDefinedNumber(hotspot.width_norm),
    height_norm: toDefinedNumber(hotspot.height_norm),
  };
}

function normalizeImageAsset(value: unknown, fallbackId: string) {
  const imageAsset =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const size =
    imageAsset.size && typeof imageAsset.size === "object"
      ? (imageAsset.size as Record<string, unknown>)
      : {};

  return {
    id: toDefinedString(imageAsset.id) || fallbackId,
    size: {
      width: toDefinedNumber(size.width) || FALLBACK_IMAGE_SIZE.width,
      height: toDefinedNumber(size.height) || FALLBACK_IMAGE_SIZE.height,
    },
  };
}

function normalizeStreamUrls(value: unknown) {
  const streamUrls =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    hls: toDefinedUrl(streamUrls.hls) ?? null,
    hds: toDefinedUrl(streamUrls.hds) ?? null,
    mp4: toDefinedUrl(streamUrls.mp4) ?? null,
    pseudostreaming: Array.isArray(streamUrls.pseudostreaming)
      ? streamUrls.pseudostreaming
          .map((item) => toDefinedUrl(item))
          .filter((item): item is string => Boolean(item))
      : null,
  };
}

function normalizeMediaAsset(value: unknown, index: number) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const media = value as Record<string, unknown>;
  const type = toDefinedString(media.type);

  if (type === "map") {
    const location =
      media.location && typeof media.location === "object"
        ? (media.location as Record<string, unknown>)
        : {};
    const lat = toDefinedNumber(location.lat ?? location.latitude ?? media.lat);
    const lon = toDefinedNumber(
      location.lon ?? location.lng ?? location.longitude ?? media.lon ?? media.lng
    );

    if (lat === undefined || lon === undefined) {
      return undefined;
    }

    const detailLevel = toDefinedString(media.detailLevel);

    return {
      type: "map" as const,
      location: {
        lat,
        lon,
        stillTime: toDefinedNumber(location.stillTime),
        zoomStart: toDefinedNumber(location.zoomStart),
        zoomEnd: toDefinedNumber(location.zoomEnd),
        rotation: toDefinedNumber(location.rotation),
      },
      label: toDefinedString(media.label),
      showLabel: Boolean(media.showLabel),
      detailLevel: detailLevel && ALLOWED_MAP_DETAIL_LEVELS.has(detailLevel as "overview" | "standard" | "close")
        ? (detailLevel as "overview" | "standard" | "close")
        : undefined,
    };
  }

  if (type === "video") {
    const videoAsset =
      media.videoAsset && typeof media.videoAsset === "object"
        ? (media.videoAsset as Record<string, unknown>)
        : {};
    const streamUrls = normalizeStreamUrls(videoAsset.streamUrls);
    const url =
      toDefinedUrl(media.url) ||
      streamUrls.mp4 ||
      streamUrls.pseudostreaming?.[0];

    if (!url) {
      return undefined;
    }

    return {
      type: "video" as const,
      url,
      byline: toDefinedString(media.byline),
      description: toDefinedString(media.description),
      changedId: toDefinedString(media.changedId),
      startFrom: toDefinedNumber(media.startFrom),
      endAt: toDefinedNumber(media.endAt),
      videoAsset: {
        id: toDefinedString(videoAsset.id) || `video-${index + 1}`,
        assetType:
          videoAsset.assetType === "audio" || videoAsset.assetType === "video"
            ? videoAsset.assetType
            : undefined,
        displays: toDefinedNumber(videoAsset.displays),
        duration: toDefinedNumber(videoAsset.duration),
        title: toDefinedString(videoAsset.title) || `Video ${index + 1}`,
        streamUrls: {
          ...streamUrls,
          mp4: streamUrls.mp4 || url,
        },
      },
    };
  }

  if (type === "image") {
    const url = toDefinedUrl(media.url);
    if (!url) {
      return undefined;
    }

    return {
      type: "image" as const,
      url,
      byline: toDefinedString(media.byline),
      description: toDefinedString(media.description),
      imageAsset: normalizeImageAsset(media.imageAsset, `image-${index + 1}`),
      hotspot: normalizeHotspot(media.hotspot),
    };
  }

  return undefined;
}

function normalizeSegmentTextLines(value: unknown, fallbackText: string, segmentIndex: number) {
  if (Array.isArray(value) && value.length > 0) {
    const lines = value
      .map((item, lineIndex) => {
        if (!item || typeof item !== "object") {
          return undefined;
        }

        const line = item as Record<string, unknown>;
        const text = toDefinedString(line.text);
        if (!text) {
          return undefined;
        }

        return {
          type: "text" as const,
          text,
          line_id:
            toDefinedNumber(line.line_id) ??
            segmentIndex * 100 +
              lineIndex +
              1,
        };
      })
      .filter(
        (item): item is { type: "text"; text: string; line_id: number } =>
          Boolean(item)
      );

    if (lines.length > 0) {
      return lines;
    }
  }

  const fallbackLines = fallbackText
    .split("\n\n")
    .map((item) => item.trim())
    .filter(Boolean);

  return fallbackLines.map((text, lineIndex) => ({
    type: "text" as const,
    text,
    line_id: segmentIndex * 100 + lineIndex + 1,
  }));
}

function normalizeManuscript(raw: unknown, fallbackArticleUrl: string) {
  const manuscript =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const meta =
    manuscript.meta && typeof manuscript.meta === "object"
      ? (manuscript.meta as Record<string, unknown>)
      : {};
  const rawSegments = Array.isArray(manuscript.segments) ? manuscript.segments : [];

  const segments = rawSegments.map((segmentValue, segmentIndex) => {
    const segment =
      segmentValue && typeof segmentValue === "object"
        ? (segmentValue as Record<string, unknown>)
        : {};
    const text = toDefinedString(segment.text) || "";
    const mood = toDefinedString(segment.mood);
    const style = toDefinedString(segment.style);
    const cameraMovement = toDefinedString(segment.cameraMovement);
    const texts = normalizeSegmentTextLines(segment.texts, text, segmentIndex);
    const images = Array.isArray(segment.images)
      ? segment.images
          .map((item, mediaIndex) =>
            normalizeMediaAsset(item, segmentIndex * 10 + mediaIndex)
          )
          .filter(Boolean)
      : undefined;
    const mainMedia = normalizeMediaAsset(segment.mainMedia, segmentIndex * 10 + 1000);
    const customAudio =
      segment.customAudio && typeof segment.customAudio === "object"
        ? {
            src: toDefinedString((segment.customAudio as Record<string, unknown>).src),
            length: toDefinedNumber(
              (segment.customAudio as Record<string, unknown>).length
            ),
          }
        : undefined;

    return {
      id: Math.round(toDefinedNumber(segment.id) ?? segmentIndex + 1),
      mood: mood && ALLOWED_MOODS.has(mood as
            | "mellow"
            | "sad"
            | "dramatic"
            | "neutral"
            | "hopeful"
            | "upbeat")
        ? (mood as
            | "mellow"
            | "sad"
            | "dramatic"
            | "neutral"
            | "hopeful"
            | "upbeat")
        : "neutral",
      type: "segment",
      style: style && ALLOWED_STYLES.has(style as "top" | "middle" | "bottom")
        ? (style as "top" | "middle" | "bottom")
        : "bottom",
      text: texts.map((line) => line.text).join("\n\n"),
      texts,
      cameraMovement: cameraMovement &&
        ALLOWED_CAMERA_MOVEMENTS.has(cameraMovement as
            | "none"
            | "pan-left"
            | "pan-right"
            | "pan-up"
            | "pan-down"
            | "zoom-in"
            | "zoom-out"
            | "zoom-rotate-left"
            | "zoom-rotate-right"
            | "zoom-out-rotate-left"
            | "zoom-out-rotate-right")
        ? (cameraMovement as
            | "none"
            | "pan-left"
            | "pan-right"
            | "pan-up"
            | "pan-down"
            | "zoom-in"
            | "zoom-out"
            | "zoom-rotate-left"
            | "zoom-rotate-right"
            | "zoom-out-rotate-left"
            | "zoom-out-rotate-right")
        : "zoom-in",
      images,
      mainMedia,
      customAudio:
        customAudio?.src || customAudio?.length !== undefined ? customAudio : undefined,
    };
  });

  const media = Array.isArray(manuscript.media)
    ? manuscript.media
        .map((item, index) => normalizeMediaAsset(item, index))
        .filter(Boolean)
    : undefined;

  const normalized = {
    meta: {
      title: toDefinedString(meta.title) || "Untitled",
      pubdate: toDateTimeString(meta.pubdate),
      byline: toDefinedString(meta.byline) || "",
      articleUrl: toDefinedString(meta.articleUrl) || fallbackArticleUrl,
      uniqueId: toDefinedString(meta.uniqueId) || crypto.randomUUID(),
      prompt: Array.isArray(meta.prompt) ? meta.prompt : undefined,
      generatedSegments: Array.isArray(meta.generatedSegments)
        ? meta.generatedSegments
        : undefined,
    },
    segments,
    media,
  };

  const parsed = manuscriptSchema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")} - ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid manuscript payload: ${issues}`);
  }

  return parsed.data;
}

function normalizeGenerationTab(rawTab: GenerationTab, index: number): GenerationTab {
  const articleUrl =
    toDefinedString(rawTab.articleUrl) ||
    toDefinedString(rawTab.projectId) ||
    `article-${index + 1}`;

  return {
    articleUrl,
    projectId: projectIdSchema.safeParse(rawTab.projectId).success
      ? rawTab.projectId
      : undefined,
    backendGenerationId: toDefinedString(rawTab.backendGenerationId),
    manuscript: normalizeManuscript(rawTab.manuscript, articleUrl),
  };
}

function normalizeGenerationTabs(rawTabs: GenerationTab[]): GenerationTab[] {
  return rawTabs.map((tab, index) => normalizeGenerationTab(tab, index));
}

function mergeRetiredProjectIds(
  existingIds: string[] | undefined,
  nextIds: string[] | undefined,
  currentProjectId: string
): string[] | undefined {
  const merged = [...(existingIds || []), ...(nextIds || [])].filter(
    (projectId, index, allIds) =>
      projectId &&
      projectId !== currentProjectId &&
      allIds.indexOf(projectId) === index
  );

  return merged.length > 0 ? merged : undefined;
}

async function readManifest(projectId: string) {
  return readJson<{
    projectId: string;
    brandId: string;
    promptPack: string;
    voicePack: string;
    options?: {
      orientationDefault?: "vertical" | "horizontal";
      segmentPauseSeconds?: number;
    };
    createdAt: string;
    updatedAt: string;
  } | null>(generationManifestPath(projectId), null);
}

function normalizeId(rawId: string): string {
  let decodedId = "";
  try {
    decodedId = decodeURIComponent(rawId);
  } catch {
    throw new Error("Invalid generation id");
  }

  if (!projectIdSchema.safeParse(decodedId).success) {
    throw new Error("Invalid generation id");
  }

  return decodedId;
}

export async function POST(req: NextRequest) {
  try {
    const body = postBodySchema.parse(await req.json());
    const normalizedTabs = normalizeGenerationTabs(body.data);
    const firstTab = normalizedTabs[0];
    const fallbackProjectId = firstTab?.projectId || firstTab?.articleUrl;
    const projectId = body.projectId || fallbackProjectId;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const generation: GenerationRecord = {
      id: projectId,
      projectId,
      data: normalizedTabs,
      retiredProjectIds: mergeRetiredProjectIds(
        undefined,
        body.retiredProjectIds,
        projectId
      ),
      config: body.config,
      brandId: body.brandId,
      project: body.project || { id: projectId, name: projectId },
      createdDate: now,
      updatedAt: now,
    };

    await writeJson(cmsGenerationPath(projectId), generation);
    return NextResponse.json({ id: generation.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const projectId = normalizeId(id);
    const generation = await readJson<GenerationRecord | null>(
      cmsGenerationPath(projectId),
      null
    );

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }

    const manifest = await readManifest(projectId);
    const resolvedConfig =
      manifest ? await resolveConfigForProject(projectId, manifest) : generation.config;

    return NextResponse.json({
      ...generation,
      config: resolvedConfig || generation.config,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid generation id") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = putBodySchema.parse(await req.json());
    const projectId = normalizeId(body.id);
    const normalizedTabs = normalizeGenerationTabs(body.data);

    const existing = await readJson<GenerationRecord | null>(
      cmsGenerationPath(projectId),
      null
    );

    if (!existing) {
      const knownProjects = await listProjectIds();
      if (!knownProjects.includes(projectId)) {
        return NextResponse.json({ error: "Generation not found" }, { status: 404 });
      }
    }

    const next: GenerationRecord = {
      id: projectId,
      projectId,
      config: existing?.config,
      brandId: existing?.brandId,
      project: existing?.project || { id: projectId, name: projectId },
      data: normalizedTabs,
      retiredProjectIds: mergeRetiredProjectIds(
        existing?.retiredProjectIds,
        body.retiredProjectIds,
        projectId
      ),
      createdDate: existing?.createdDate || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writeJson(cmsGenerationPath(projectId), next);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid generation id") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

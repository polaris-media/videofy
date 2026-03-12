import { NextResponse } from "next/server";
import { z } from "zod";
import { detectProjectNewsroom } from "@/lib/newsroomBranding";
import { normalizeSvpKey, resolveSvpProvider } from "@/lib/svp";
import { normalizedSvpVideoSchema } from "@/lib/svpTypes";

const paramsSchema = z.object({
  newsroom: z.string().optional(),
  projectId: z.string().optional(),
  assetId: z.string().regex(/^\d+$/).optional(),
});

const streamUrlsSchema = z.object({
  hls: z.string().url().nullable().optional(),
  hds: z.string().url().nullable().optional(),
  mp4: z.string().url().nullable().optional(),
  pseudostreaming: z.array(z.string().url()).nullable().optional(),
});

const assetSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  published: z.number().nullable().optional(),
  provider: z
    .union([
      z.string(),
      z.object({
        id: z.string().nullable().optional(),
        service: z.string().nullable().optional(),
      }),
    ])
    .optional(),
  images: z
    .object({
      main: z.string().url().nullable().optional(),
      front: z.string().url().nullable().optional(),
      snapshots: z.string().url().nullable().optional(),
      featured: z.string().url().nullable().optional(),
    })
    .optional(),
  streamUrls: streamUrlsSchema.optional(),
  category: z
    .object({
      id: z.number().nullable().optional(),
      title: z.string().nullable().optional(),
    })
    .optional(),
  additional: z
    .object({
      metadata: z
        .object({
          aspectRatio: z.string().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  streamConfiguration: z
    .object({
      properties: z.array(z.string()).optional(),
    })
    .optional(),
});

const assetListResponseSchema = z.object({
  total: z.number().optional(),
  total_items: z.number().optional(),
  _embedded: z.object({
    assets: z.array(assetSchema),
  }),
});

const SVP_BASE_URL = "https://svp.vg.no/svp/api/v1";
const SVP_APP_NAME = "docs";

type SvpAsset = z.infer<typeof assetSchema>;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected error";
}

async function resolveRequestedNewsroom(
  newsroom: string | undefined,
  projectId: string | undefined
): Promise<string> {
  const explicitNewsroom = normalizeSvpKey(newsroom);
  if (explicitNewsroom) {
    return explicitNewsroom;
  }

  if (!projectId) {
    throw new Error("Either newsroom or projectId is required");
  }

  const detectedNewsroom = await detectProjectNewsroom(projectId);
  if (!detectedNewsroom) {
    throw new Error(`Could not determine newsroom for project ${projectId}`);
  }

  return detectedNewsroom;
}

function buildStreamUrls(asset: SvpAsset) {
  return {
    hls: asset.streamUrls?.hls ?? null,
    hds: asset.streamUrls?.hds ?? null,
    mp4: asset.streamUrls?.mp4 ?? null,
    pseudostreaming: asset.streamUrls?.pseudostreaming ?? null,
  };
}

function getImageUrl(asset: SvpAsset): string | null {
  return (
    asset.images?.main ||
    asset.images?.snapshots ||
    asset.images?.front ||
    asset.images?.featured ||
    null
  );
}

function getProviderId(provider: SvpAsset["provider"]): string | null {
  if (typeof provider === "string") {
    return provider;
  }

  if (provider && typeof provider.id === "string" && provider.id.trim()) {
    return provider.id.trim();
  }

  return null;
}

function normalizeAsset(asset: SvpAsset) {
  const streamUrls = buildStreamUrls(asset);
  return normalizedSvpVideoSchema.parse({
    id: String(asset.id),
    title: asset.title?.trim() || String(asset.id),
    description: asset.description ?? null,
    duration: asset.duration ?? null,
    published: asset.published ?? null,
    provider: getProviderId(asset.provider),
    categoryTitle: asset.category?.title ?? null,
    imageUrl: getImageUrl(asset),
    streamUrls,
    playableUrl: streamUrls.mp4 || streamUrls.pseudostreaming?.[0] || null,
    aspectRatio: asset.additional?.metadata?.aspectRatio ?? null,
    streamProperties: asset.streamConfiguration?.properties ?? [],
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SVP request failed (${response.status}): ${body || response.statusText}`);
  }

  return response.json();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = paramsSchema.parse({
      newsroom: searchParams.get("newsroom") ?? undefined,
      projectId: searchParams.get("projectId") ?? undefined,
      assetId: searchParams.get("assetId") ?? undefined,
    });

    const newsroom = await resolveRequestedNewsroom(params.newsroom, params.projectId);
    const provider = resolveSvpProvider(newsroom);

    if (!provider) {
      throw new Error(`Could not resolve SVP provider for newsroom ${newsroom}`);
    }

    if (params.assetId) {
      const payload = assetSchema.parse(
        await fetchJson(`${SVP_BASE_URL}/${provider}/assets/${params.assetId}?appName=${SVP_APP_NAME}`)
      );

      return NextResponse.json({
        newsroom,
        provider,
        item: normalizeAsset(payload),
      });
    }

    const payload = assetListResponseSchema.parse(
      await fetchJson(`${SVP_BASE_URL}/${provider}/assets?appName=${SVP_APP_NAME}`)
    );

    return NextResponse.json({
      newsroom,
      provider,
      total: payload.total ?? payload._embedded.assets.length,
      totalItems: payload.total_items ?? payload._embedded.assets.length,
      items: payload._embedded.assets.map((asset) => normalizeAsset(asset)),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnvVar } from "@/lib/serverEnv";

const paramsSchema = z.object({
  newsroom: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
});

const collectionItemSchema = z.object({
  id: z.string(),
  locale: z.string().optional(),
  newsroom: z.string(),
  type: z.string(),
});

const collectionResponseSchema = z.object({
  items: z.array(collectionItemSchema),
  hits: z
    .object({
      total: z.number(),
      from: z.number(),
      size: z.number(),
    })
    .optional(),
});

type CollectionItem = z.infer<typeof collectionItemSchema>;

const COLLECTIONS_BASE_URL = "https://content.api.plan3.se/collections/v1";
const ENTITIES_BASE_URL = "https://content.api.plan3.se/entities/v1";
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected error";
}

function buildBasicAuthHeader(): string {
  const username = getServerEnvVar("CAPI_USERNAME")?.trim();
  const password = getServerEnvVar("CAPI_PASSWORD")?.trim();
  if (!(username && password)) {
    throw new Error("CAPI_USERNAME and CAPI_PASSWORD are required");
  }
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function extractArticleTitle(article: unknown, fallbackId: string): string {
  if (!article || typeof article !== "object") {
    return fallbackId;
  }

  const candidatePaths = [
    ["title", "value"],
    ["title"],
    ["headline", "value"],
    ["headline"],
    ["presentationTitle", "value"],
    ["presentationTitle"],
    ["seoTitle"],
    ["name"],
  ];

  for (const path of candidatePaths) {
    let current: unknown = article;
    for (const part of path) {
      if (!current || typeof current !== "object" || !(part in current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
  }

  return fallbackId;
}

async function fetchCollectionItems(
  newsroom: string,
  authHeader: string
): Promise<z.infer<typeof collectionResponseSchema>> {
  const url = new URL(`${COLLECTIONS_BASE_URL}/${newsroom}/articles`);
  url.searchParams.set("source.id", "!");
  url.searchParams.set("characteristics.hotness", "20..100");
  url.searchParams.set("sort", "PUBLISHED");
  url.searchParams.set("size", "20");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to fetch Polaris article list (${response.status}): ${body || response.statusText}`
    );
  }

  const payload = await response.json();
  return collectionResponseSchema.parse(payload);
}

async function fetchArticleTitle(
  item: CollectionItem,
  authHeader: string
): Promise<string> {
  try {
    const response = await fetch(
      `${ENTITIES_BASE_URL}/${item.newsroom}/article/${item.id}?format=v5`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authHeader,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      return item.id;
    }

    const payload = await response.json();
    return extractArticleTitle(payload, item.id);
  } catch {
    return item.id;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = paramsSchema.parse({
      newsroom: searchParams.get("newsroom"),
    });

    const authHeader = buildBasicAuthHeader();
    const collection = await fetchCollectionItems(params.newsroom, authHeader);

    const items = await Promise.all(
      collection.items.map(async (item) => ({
        ...item,
        title: await fetchArticleTitle(item, authHeader),
      }))
    );

    return NextResponse.json({
      items,
      hits: collection.hits,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Timed out while fetching Polaris articles after ${EXTERNAL_FETCH_TIMEOUT_MS}ms`
        : toErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

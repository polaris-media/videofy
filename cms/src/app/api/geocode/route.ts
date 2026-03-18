import { NextResponse } from "next/server";
import { z } from "zod";

const querySchema = z.object({
  q: z.string().trim().min(2).max(200),
});

const nominatimItemSchema = z.object({
  place_id: z.union([z.string(), z.number()]),
  display_name: z.string(),
  lat: z.string(),
  lon: z.string(),
  type: z.string().optional(),
  importance: z.number().optional(),
});

const responseSchema = z.array(nominatimItemSchema);

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected error";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      q: searchParams.get("q") ?? "",
    });

    const params = new URLSearchParams({
      q: query.q,
      format: "jsonv2",
      addressdetails: "0",
      limit: "8",
      "accept-language": "nb,en",
    });

    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "videofy-minimal-cms/1.0 (maps)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to search map locations (${response.status}): ${body || response.statusText}`
      );
    }

    const payload = responseSchema.parse(await response.json());
    const items = payload.map((item) => ({
      id: String(item.place_id),
      label: item.display_name,
      lat: Number(item.lat),
      lon: Number(item.lon),
      type: item.type || "",
      importance: item.importance ?? 0,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Timed out while searching map locations after ${EXTERNAL_FETCH_TIMEOUT_MS}ms`
        : toErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";

const NEWSROOMS_DIRECTORY_URL = "https://micro.fvn.no/newsrooms?extended";

const newsroomSchema = z.object({
  name: z.string(),
  region: z.string().optional().default(""),
  domain: z.string(),
  newsroom: z.string(),
  lang: z.string().optional().default(""),
  municipality: z.string().optional().default(""),
  county: z.string().optional().default(""),
});

const responseSchema = z.array(newsroomSchema);

export async function GET() {
  try {
    const response = await fetch(NEWSROOMS_DIRECTORY_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to fetch Polaris newsrooms (${response.status}): ${body || response.statusText}`
      );
    }

    const payload = responseSchema.parse(await response.json());
    const items = [...payload].sort((left, right) =>
      left.name.localeCompare(right.name, "nb")
    );

    return NextResponse.json({ items });
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  detectProjectNewsroom,
  readNewsroomBrandingFile,
  type NewsroomBrandingEntry,
  type NewsroomBrandingFile,
} from "@/lib/newsroomBranding";
import { newsroomBrandingPath, writeJson } from "@/lib/projectFiles";

const projectIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const newsroomSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

const querySchema = z.object({
  projectId: projectIdSchema,
});

const entrySchema = z.object({
  domain: z.string().optional(),
  image: z.string().optional(),
  text: z.string().optional(),
  logoMode: z.enum(["auto", "image", "text"]).optional(),
  logoStyle: z.string().optional(),
  logoTextStyle: z.string().optional(),
  disableIntro: z.boolean().optional(),
  disableWipe: z.boolean().optional(),
  disableOutro: z.boolean().optional(),
  player: z.record(z.string(), z.unknown()).optional(),
});

const saveSchema = z.object({
  newsroom: newsroomSchema,
  entry: entrySchema,
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unexpected error";
}

function stripEmptyStrings(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const nextItems = value
      .map((item) => stripEmptyStrings(item))
      .filter((item) => item !== undefined);
    return nextItems.length > 0 ? nextItems : undefined;
  }

  if (value && typeof value === "object") {
    const nextEntries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stripEmptyStrings(item)] as const)
      .filter(([, item]) => item !== undefined);

    if (nextEntries.length === 0) {
      return undefined;
    }

    return Object.fromEntries(nextEntries);
  }

  return value;
}

function sanitizeEntry(entry: NewsroomBrandingEntry): NewsroomBrandingEntry {
  const normalized = stripEmptyStrings(entry);
  if (!normalized || typeof normalized !== "object") {
    return {};
  }

  return normalized as NewsroomBrandingEntry;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { projectId } = querySchema.parse({
      projectId: searchParams.get("projectId"),
    });

    const brandingFile = await readNewsroomBrandingFile();
    const newsroom = await detectProjectNewsroom(projectId);
    const entry = newsroom ? brandingFile.newsrooms?.[newsroom] || {} : {};

    return NextResponse.json({
      projectId,
      newsroom,
      entry,
      defaultEntry: brandingFile.default || {},
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { newsroom, entry } = saveSchema.parse(await request.json());
    const brandingFile = await readNewsroomBrandingFile();
    const nextFile: NewsroomBrandingFile = {
      ...brandingFile,
      newsrooms: {
        ...(brandingFile.newsrooms || {}),
      },
    };

    const sanitizedEntry = sanitizeEntry(entry);
    if (Object.keys(sanitizedEntry).length === 0) {
      delete nextFile.newsrooms?.[newsroom];
    } else {
      nextFile.newsrooms![newsroom] = sanitizedEntry;
    }

    await writeJson(newsroomBrandingPath(), nextFile);
    return NextResponse.json({
      success: true,
      newsroom,
      entry: nextFile.newsrooms?.[newsroom] || {},
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

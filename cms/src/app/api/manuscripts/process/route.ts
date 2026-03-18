import { NextResponse } from "next/server";
import { manuscriptSchema } from "@videofy/types";
import { z } from "zod";
import { processProjectManuscript } from "@/lib/server/processManuscript";

const requestSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  manuscript: manuscriptSchema,
  audioMode: z.enum(["none", "elevenlabs"]).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const processed = await processProjectManuscript({
      manuscript: payload.manuscript,
      projectId: payload.projectId,
      audioMode: payload.audioMode,
    });

    return NextResponse.json({ processed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process manuscript" },
      { status: 500 }
    );
  }
}

export const revalidate = 0;

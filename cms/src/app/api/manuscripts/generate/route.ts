import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProjectManuscript } from "@/lib/server/generateManuscript";

const requestSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const manuscript = await generateProjectManuscript(payload.projectId);
    return NextResponse.json({ manuscript });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate manuscript" },
      { status: 500 }
    );
  }
}

export const revalidate = 0;

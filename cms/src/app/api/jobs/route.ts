import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob } from "@/lib/jobQueue";

const JOB_KINDS = ["generate-manuscript", "process-manuscript", "render-video"] as const;
const jobKindSchema = z.enum(JOB_KINDS);

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("generate-manuscript"),
    payload: z.object({
      projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    }),
  }),
  z.object({
    kind: z.literal("process-manuscript"),
    payload: z.object({
      projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
      manuscript: z.unknown(),
      audioMode: z.enum(["none", "elevenlabs"]),
    }),
  }),
  z.object({
    kind: z.literal("render-video"),
    payload: z.object({
      projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
      orientations: z.array(z.enum(["vertical", "horizontal"])).min(1),
      manuscripts: z.array(z.unknown()).min(1),
      playerConfig: z.unknown(),
      voice: z.boolean(),
      backgroundMusic: z.boolean(),
      disabledLogo: z.boolean(),
      splitArticles: z.boolean().default(true),
    }),
  }),
]);

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const job = await createJob(body.kind, body.payload);
    return NextResponse.json({
      jobId: job.id,
      kind: job.kind,
      status: job.status,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create job" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: `Method not supported. Use /api/jobs/{jobId}. Supported kinds: ${jobKindSchema.options.join(", ")}`,
    },
    { status: 405 }
  );
}

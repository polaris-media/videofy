import { NextResponse } from "next/server";
import { z } from "zod";
import { getJob } from "@/lib/jobQueue";

const paramsSchema = z.object({
  jobId: z.string().regex(/^job-[A-Za-z0-9._-]+$/),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const job = await getJob(params.jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: job.id,
      kind: job.kind,
      status: job.status,
      projectId: job.projectId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      result: job.result,
      error: job.error,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load job" },
      { status: 500 }
    );
  }
}

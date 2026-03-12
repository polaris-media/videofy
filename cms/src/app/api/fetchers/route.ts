import { NextResponse } from "next/server";
import { z } from "zod";
import { listFetchers, runFetcher } from "@/lib/fetchers";

const runSchema = z.object({
  fetcherId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  inputs: z.record(z.string(), z.string()).default({}),
});

export async function GET() {
  try {
    const fetchers = await listFetchers();
    return NextResponse.json({ fetchers });
  } catch (error) {
    console.error("Failed to list fetchers:", error);
    return NextResponse.json({ fetchers: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = runSchema.parse(await request.json());
    const result = await runFetcher(body.fetcherId, body.inputs);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to run fetcher:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run fetcher" },
      { status: 400 }
    );
  }
}

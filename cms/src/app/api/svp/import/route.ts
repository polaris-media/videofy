import { NextResponse } from "next/server";
import { z } from "zod";
import { VideoType, videoSchema } from "@videofy/types";
import { importRemoteVideoToProject } from "@/lib/importRemoteVideo";
import { normalizedSvpVideoSchema } from "@/lib/svpTypes";

const requestSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  item: normalizedSvpVideoSchema,
});

function toVideoAsset(
  item: z.infer<typeof normalizedSvpVideoSchema>,
  localUrl: string
): VideoType {
  return videoSchema.parse({
    type: "video",
    url: localUrl,
    description: item.description ?? undefined,
    byline: item.provider ? item.provider.toUpperCase() : undefined,
    changedId: item.id,
    videoAsset: {
      id: item.id,
      assetType: "video",
      title: item.title,
      duration: item.duration ?? undefined,
      streamUrls: {
        hls: item.streamUrls.hls ?? null,
        hds: item.streamUrls.hds ?? null,
        mp4: localUrl,
        pseudostreaming: item.streamUrls.pseudostreaming ?? null,
      },
    },
  });
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    if (!payload.item.playableUrl) {
      return NextResponse.json(
        { error: `SVP asset ${payload.item.id} does not expose a direct MP4 stream` },
        { status: 400 }
      );
    }

    const imported = await importRemoteVideoToProject({
      projectId: payload.projectId,
      assetId: payload.item.id,
      sourceUrl: payload.item.playableUrl,
    });

    return NextResponse.json({
      video: toVideoAsset(payload.item, imported.url),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const revalidate = 0;

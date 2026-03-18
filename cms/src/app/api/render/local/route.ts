import { NextResponse } from "next/server";
import { playerSchema, processedManuscriptSchema } from "@videofy/types";
import { z } from "zod";
import { renderProjectVideo } from "@/lib/remotionRender";
import { buildProjectFileUrl } from "@/lib/projectFileUrl";

export const runtime = "nodejs";

type RenderDownload = {
  kind: "combined" | "article";
  orientation: "vertical" | "horizontal";
  downloadUrl: string;
  articleIndex?: number;
  articleTitle?: string;
};

const bodySchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  orientations: z.array(z.enum(["vertical", "horizontal"])).min(1).optional(),
  manuscripts: z.array(processedManuscriptSchema).min(1),
  playerConfig: playerSchema,
  voice: z.boolean().default(true),
  backgroundMusic: z.boolean().default(true),
  disabledLogo: z.boolean().default(false),
  splitArticles: z.boolean().default(true),
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected error";
}

function resolveOrientations(body: z.infer<typeof bodySchema>) {
  if (body.orientations?.length) {
    return [...new Set(body.orientations)];
  }

  return [body.orientation || "vertical"];
}

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const orientations = resolveOrientations(body);

    const downloads: RenderDownload[] = [];
    for (const orientation of orientations) {
      await renderProjectVideo({
        projectId: body.projectId,
        orientation,
        manuscripts: body.manuscripts,
        playerConfig: body.playerConfig,
        voice: body.voice,
        backgroundMusic: body.backgroundMusic,
        disabledLogo: body.disabledLogo,
      });

      downloads.push({
        kind: "combined",
        orientation,
        downloadUrl: buildProjectFileUrl(body.projectId, `output/render-${orientation}.mp4`),
      });

      if (body.splitArticles && body.manuscripts.length > 1) {
        for (const [articleIndex, manuscript] of body.manuscripts.entries()) {
          const paddedArticleIndex = String(articleIndex + 1).padStart(2, "0");
          const outputFileName = `render-${orientation}-article-${paddedArticleIndex}.mp4`;

          await renderProjectVideo({
            projectId: body.projectId,
            orientation,
            manuscripts: [manuscript],
            playerConfig: body.playerConfig,
            voice: body.voice,
            backgroundMusic: body.backgroundMusic,
            disabledLogo: body.disabledLogo,
            outputFileName,
            storyIndicator: {
              length: body.manuscripts.length,
              current: articleIndex,
            },
          });

          downloads.push({
            kind: "article",
            orientation,
            articleIndex: articleIndex + 1,
            articleTitle: manuscript.meta.title,
            downloadUrl: buildProjectFileUrl(body.projectId, `output/${outputFileName}`),
          });
        }
      }
    }

    return NextResponse.json({
      downloads,
      downloadUrl: downloads.find((download) => download.kind === "combined")?.downloadUrl,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

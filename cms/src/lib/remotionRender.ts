import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

export type RenderOrientation = "vertical" | "horizontal";

type RenderInput = {
  projectId: string;
  orientation: RenderOrientation;
  manuscripts: unknown[];
  playerConfig: unknown;
  voice: boolean;
  backgroundMusic: boolean;
  disabledLogo: boolean;
};

let bundlePromise: Promise<string> | undefined;

function resolveEntryPoint(): string {
  // Remotion bundle() must point to the file that calls registerRoot().
  return path.join(process.cwd(), "..", "player", "src", "studio-index.ts");
}

export function getOutputFilePath(projectId: string, orientation: RenderOrientation): string {
  return path.join(process.cwd(), "..", "projects", projectId, "output", `render-${orientation}.mp4`);
}

export async function getServeUrl(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: resolveEntryPoint(),
      webpackOverride: (config) => config,
    });
  }

  return bundlePromise;
}

export function prewarmRemotionBundle(): void {
  void getServeUrl().catch((error) => {
    console.error("Failed to prewarm Remotion bundle:", error);
  });
}

export async function renderProjectVideo(input: RenderInput): Promise<string> {
  const width = input.orientation === "vertical" ? 1080 : 1920;
  const height = input.orientation === "vertical" ? 1920 : 1080;

  const inputProps = {
    manuscripts: input.manuscripts,
    playerConfig: input.playerConfig,
    width,
    height,
    voice: input.voice,
    backgroundMusic: input.backgroundMusic,
    disabledLogo: input.disabledLogo,
  };

  const serveUrl = await getServeUrl();
  const composition = await selectComposition({
    serveUrl,
    id: "ArticlesSeries",
    inputProps,
  });

  const outputFile = getOutputFilePath(input.projectId, input.orientation);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const tempOutputFile = outputFile.replace(/\.mp4$/, `.${Date.now()}.rendering.mp4`);

  try {
    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      outputLocation: tempOutputFile,
      inputProps,
      overwrite: true,
      timeoutInMilliseconds: 1000 * 600,
      imageFormat: "jpeg",
      audioCodec: "aac",
    });
    await rm(outputFile, { force: true });
    await rename(tempOutputFile, outputFile);
  } catch (error) {
    await rm(tempOutputFile, { force: true }).catch(() => undefined);
    throw error;
  }

  return outputFile;
}

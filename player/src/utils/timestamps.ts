import type { z } from "zod";
import { VIDEO_FPS } from "../types/constants";
import { processedManuscriptSchema, playerSchema } from "@videofy/types";
// z is imported on line 1

type PlayerConfig = z.infer<typeof playerSchema>;
import {
  getSelectedReporterIntro,
  getSelectedReporterOutro,
} from "./findSelectedReporterVideo";

type Manuscript = z.infer<typeof processedManuscriptSchema>;

export const roundToNearestFrame = (time: number) => {
  const rounded = Math.round(time * VIDEO_FPS);

  return rounded;
};

export const getSegmentDuration = (manuscript: Manuscript) => {
  const segmentDuration = manuscript.segments.reduce((totalLength, segment) => {
    const asset = segment.images?.[0];
    const hasText = segment.texts?.some((text) => text.text);

    let segmentLength = segment.end - segment.start;

    if (asset?.type === "video" && !hasText && !segment.customAudio?.length) {
      segmentLength =
        (asset.endAt || (asset.videoAsset?.duration || 0) / 1000 || 0) -
        (asset.startFrom || 0);
    }

    if (segment.customAudio?.length) {
      segmentLength = segment.customAudio?.length;
    }

    return totalLength + segmentLength;
  }, 0);

  return roundToNearestFrame(segmentDuration);
};

interface GetFullDurationArgs {
  manuscripts?: Array<Manuscript>;
  playerConfig: PlayerConfig;
}

export const getFullDuration = ({
  manuscripts,
  playerConfig,
}: GetFullDurationArgs) => {
  const introDuration = roundToNearestFrame(playerConfig.intro?.duration ?? 0);
  const introOffset = roundToNearestFrame(playerConfig.intro?.offset ?? 0);

  const selectedReporterIntro = getSelectedReporterIntro(playerConfig);
  const reporterIntroDuration = roundToNearestFrame(
    selectedReporterIntro?.duration ?? 0
  );

  const wipeDuration = roundToNearestFrame(playerConfig.wipe?.duration ?? 0);
  const wipeOffset = roundToNearestFrame(playerConfig.wipe?.offset ?? 0);

  const selectedReporterOutro = getSelectedReporterOutro(playerConfig);
  const reporterOutroDuration = roundToNearestFrame(
    selectedReporterOutro?.duration ?? 0
  );

  const outroDuration = roundToNearestFrame(playerConfig.outro?.duration ?? 0);
  const outroOffset = roundToNearestFrame(playerConfig.outro?.offset ?? 0);
  const outroCardDuration = roundToNearestFrame(playerConfig.outroCard?.duration ?? 0);

  const intro = introDuration + introOffset;

  const outro = outroDuration + outroOffset + outroCardDuration;

  const segments = manuscripts?.map((manuscript) =>
    getSegmentDuration(manuscript)
  );

  const wipe = wipeDuration + wipeOffset * 2;
  const numberOfWipes = manuscripts?.length ? manuscripts.length - 1 : 0;

  if (!segments)
    return intro + reporterIntroDuration + wipe + reporterOutroDuration + outro;

  const durationInFrames =
    intro +
    reporterIntroDuration +
    wipe * numberOfWipes +
    reporterOutroDuration +
    outro +
    segments.reduce((a, b) => a + b, 0);

  return durationInFrames;
};

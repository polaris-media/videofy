import { type FC, type ReactElement } from "react";
import { Audio, Sequence, Series } from "remotion";
import type { z } from "zod";
import { playerSchema, type processedManuscriptSchema } from "@videofy/types";
import ArticleProgress from "../Components/ArticleProgress";
import { ImageAnimation } from "../Components/ImageAnimation";
import { MapComponent } from "../Components/Map/MapComponent";
import PhotoCredits from "../Components/PhotoCredits";
import { Text } from "../Components/Text";
import VideoAsset from "../Components/VideoAsset";
import { getAssetUrl } from "../utils/getAssetUrl";
import { roundToNearestFrame } from "../utils/timestamps";

type PlayerConfig = z.infer<typeof playerSchema>;
type Manuscript = z.infer<typeof processedManuscriptSchema>;
type Segment = Manuscript["segments"][number];

interface Props {
  manuscript: Manuscript;
  indicator: { length: number; current: number };
  voice: boolean;
  config: PlayerConfig;
}

const DEFAULT_CAMERA_MOVEMENTS = [
  "zoom-in",
  "pan-right",
  "zoom-in",
  "pan-left",
  "zoom-in",
  "zoom-out",
] as const;

function resolveCameraMovement(
  segment: Segment,
  segmentIndex: number,
  fallbackCameraMovements: readonly Segment["cameraMovement"][]
): Segment["cameraMovement"] {
  if (segment.cameraMovement !== "none") {
    return segment.cameraMovement;
  }

  return fallbackCameraMovements[
    segmentIndex % fallbackCameraMovements.length
  ] as Segment["cameraMovement"];
}

function hasVisibleText(segment: Segment): boolean {
  return segment.texts?.some((textLine) => textLine.text) || false;
}

function getSegmentDurationSeconds(segment: Segment, hasText: boolean): number {
  const primaryAsset = segment.images?.[0];
  const defaultDuration = segment.end - segment.start;

  if (segment.customAudio?.length) {
    return segment.customAudio.length;
  }

  if (
    primaryAsset?.type === "video" &&
    !hasText
  ) {
    return (
      (primaryAsset.endAt || (primaryAsset.videoAsset?.duration || 0) / 1000 || 0) -
      (primaryAsset.startFrom || 0)
    );
  }

  return defaultDuration;
}

function getMoodMusicUrl(
  config: PlayerConfig,
  mood: string,
  segmentIndex: number
): string | null {
  const moodMusicSource = config.moodMusic?.[mood || "default"];
  if (!moodMusicSource || !config.assetBaseUrl) {
    return null;
  }

  const moodPlaylist = Array.isArray(moodMusicSource) ? moodMusicSource : [moodMusicSource];
  if (moodPlaylist.length === 0) {
    return null;
  }

  return getAssetUrl(
    config.assetBaseUrl,
    moodPlaylist[segmentIndex % moodPlaylist.length]
  );
}

function buildTextSequences(
  segment: Segment,
  segmentKey: string,
  config: PlayerConfig
): ReactElement[] {
  if (segment.customAudio?.length) {
    return [];
  }

  const textSequences: ReactElement[] = [];
  for (const [textIndex, textLine] of segment.texts.entries()) {
    if (!textLine.text) {
      continue;
    }

    const duration = textLine.end - textLine.start;
    if (duration <= 0) {
      continue;
    }

    const textKey = `${segmentKey}-text-${textLine.line_id}-${textLine.start}-${textLine.end}-${textIndex}`;
    textSequences.push(
      <Sequence
        key={textKey}
        from={roundToNearestFrame(textLine.start - segment.start)}
        durationInFrames={roundToNearestFrame(duration)}
      >
        <Text
          placement={segment.style}
          titleText={textLine.text}
          config={config}
        />
      </Sequence>
    );
  }

  return textSequences;
}

export const ExternalDisplayArticle: FC<Props> = ({
  manuscript,
  indicator,
  voice,
  config,
}) => {
  const manuscriptKey = manuscript.meta.uniqueId || String(manuscript.meta.id || "manuscript");
  const defaultCameraMovements: readonly Segment["cameraMovement"][] =
    config.defaultCameraMovements && config.defaultCameraMovements.length > 0
      ? config.defaultCameraMovements
      : DEFAULT_CAMERA_MOVEMENTS;

  return (
    <>
      <Series>
        {manuscript.segments.map((segment, segmentIndex) => {
          const segmentKey = `${manuscriptKey}-segment-${segment.id}-${segmentIndex}`;
          const primaryAsset = segment.images?.[0];
          const hasText = hasVisibleText(segment);
          const segmentDurationSeconds = getSegmentDurationSeconds(segment, hasText);
          const moodMusicUrl = getMoodMusicUrl(config, segment.mood, segmentIndex);
          const textSequences = buildTextSequences(segment, segmentKey, config);

          return (
            <Series.Sequence
              durationInFrames={roundToNearestFrame(segmentDurationSeconds)}
              key={segmentKey}
            >
              {moodMusicUrl && (
                <Audio
                  src={moodMusicUrl}
                  volume={config.backgroundMusicVolume || 0.5}
                  loop
                />
              )}

              {primaryAsset?.type === "map" && (
                <MapComponent asset={primaryAsset} config={config} />
              )}

              {primaryAsset?.type === "video" && (
                <VideoAsset asset={primaryAsset} volume={hasText ? 0 : 100} />
              )}

              {primaryAsset?.type === "image" && (
                <ImageAnimation
                  asset={primaryAsset}
                  cameraMovement={resolveCameraMovement(
                    segment,
                    segmentIndex,
                    defaultCameraMovements
                  )}
                  durationInFrames={roundToNearestFrame(segment.end - segment.start)}
                />
              )}

              {primaryAsset && primaryAsset.type !== "map" && primaryAsset.byline && (
                <PhotoCredits byline={primaryAsset.byline} config={config} />
              )}

              {textSequences}

              {segment.customAudio?.length && (
                <Audio
                  startFrom={0}
                  endAt={roundToNearestFrame(segment.customAudio.length)}
                  src={segment.customAudio.src}
                />
              )}

              {voice && hasText && !segment.customAudio?.length && (
                <Sequence from={0} durationInFrames={roundToNearestFrame(segmentDurationSeconds)}>
                  <Audio
                    startFrom={roundToNearestFrame(segment.start)}
                    endAt={roundToNearestFrame(segment.end)}
                    src={manuscript.meta.audio.src}
                  />
                </Sequence>
              )}
            </Series.Sequence>
          );
        })}
      </Series>
      <ArticleProgress {...indicator} config={config} />
    </>
  );
};

import type { FC } from "react";
import { Sequence, Video, useVideoConfig } from "remotion";
import type { z } from "zod";
import { reporterVideoSchema } from "@videofy/types"; // Explicitly use reporterVideoSchema

interface Props {
  asset: z.infer<typeof reporterVideoSchema>; // Use the correct schema for inference
  duration: number;
}

export const ReporterVideo: FC<Props> = ({ asset, duration }) => {
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;

  return (
    <Sequence durationInFrames={duration}>
      {isPortrait ? (
        <Video src={asset.portrait} />
      ) : (
        <Video src={asset.landscape} />
      )}
    </Sequence>
  );
};

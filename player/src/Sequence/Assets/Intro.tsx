import { OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { z } from "zod";
import { FC } from "react";
import { customCutsSchema } from "@videofy/types";

interface Props {
  asset: z.infer<typeof customCutsSchema>; // Changed type
  introDuration: number;
}

export const Intro: FC<Props> = ({ asset, introDuration }) => {
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;

  return (
    <Sequence durationInFrames={introDuration} premountFor={10}>
      {/* Reverted to use portrait/landscape from asset */}
      {isPortrait ? (
        <OffthreadVideo transparent src={asset.portrait} />
      ) : (
        <OffthreadVideo transparent src={asset.landscape} />
      )}
    </Sequence>
  );
};

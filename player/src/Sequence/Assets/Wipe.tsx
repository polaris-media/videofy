import { FC } from "react";
import { OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { z } from "zod";
import { customCutsSchema } from "@videofy/types";

interface Props {
  duration: number;
  asset: z.infer<typeof customCutsSchema>; // Changed type
}

export const Wipe: FC<Props> = ({ duration, asset }) => {
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;

  return (
    <Sequence durationInFrames={duration}>
      {/* Reverted to use portrait/landscape from asset */}
      {isPortrait ? (
        <OffthreadVideo transparent src={asset.portrait} />
      ) : (
        <OffthreadVideo transparent src={asset.landscape} />
      )}
    </Sequence>
  );
};

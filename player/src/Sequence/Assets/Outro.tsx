import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { z } from "zod";
import { FC } from "react";
import { customCutsSchema } from "@videofy/types";

interface Props {
  asset: z.infer<typeof customCutsSchema>;
  outroDuration: number;
}

export const Outro: FC<Props> = ({ asset, outroDuration }) => {
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;

  return (
    <Sequence
      style={{
        zIndex: 1,
      }}
      durationInFrames={outroDuration}
    >
      <AbsoluteFill>
        {isPortrait ? (
          <OffthreadVideo transparent src={asset.portrait} />
        ) : (
          <OffthreadVideo transparent src={asset.landscape} />
        )}
      </AbsoluteFill>
    </Sequence>
  );
};

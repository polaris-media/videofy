import { Player as RemotionPlayer, type PlayerRef } from "@remotion/player";
import { forwardRef, type CSSProperties } from "react";
import type { z } from "zod";
import { ArticlesSeries } from "./ArticlesSeries";
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  defaultPlayerConfig,
} from "./types/constants";
import type { processedManuscriptSchema } from "@videofy/types";
import { playerSchema } from "@videofy/types";
import { getFullDuration } from "./utils/timestamps";

type PlayerConfig = z.infer<typeof playerSchema>;

interface Props {
  manuscripts: Array<z.infer<typeof processedManuscriptSchema>>;
  width?: number;
  height?: number;
  voice?: boolean;
  style?: CSSProperties;
  playerConfig?: PlayerConfig;
}

export const Player = forwardRef<PlayerRef, Props>(
  (
    {
      manuscripts,
      height = VIDEO_HEIGHT,
      width = VIDEO_WIDTH,
      voice = true,
      playerConfig = defaultPlayerConfig,
      ...rest
    },
    ref
  ) => {
    const totalDuration = getFullDuration({
      manuscripts,
      playerConfig,
    });

    if (totalDuration === 0) return <div {...rest} />;

    return (
      <RemotionPlayer
        ref={ref}
        component={ArticlesSeries}
        inputProps={{
          manuscripts,
          voice,
          playerConfig,
        }}
        durationInFrames={totalDuration}
        fps={VIDEO_FPS}
        compositionHeight={height}
        compositionWidth={width}
        controls
        acknowledgeRemotionLicense
        {...rest}
      />
    );
  }
);

Player.displayName = "Player";

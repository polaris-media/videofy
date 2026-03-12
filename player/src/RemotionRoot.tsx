import type { FC } from "react";
import { Composition } from "remotion";
import { ArticlesSeries, type ArticleSeriesProps } from "./ArticlesSeries";
import placeholderData from "./public/placeholder/placeholderData";
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  defaultPlayerConfig,
} from "./types/constants";
import { getFullDuration } from "./utils/timestamps";

export const RemotionRoot: FC = () => {
  const manuscripts = placeholderData;

  const initialTotalDuration = 0;

  return (
    <Composition
      id="ArticlesSeries"
      component={ArticlesSeries}
      durationInFrames={initialTotalDuration}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={{ manuscripts }}
      calculateMetadata={async ({ props }: { props: ArticleSeriesProps }) => {
        const { manuscripts, playerConfig = defaultPlayerConfig } = props;

        const totalDuration = getFullDuration({
          manuscripts,
          playerConfig,
        });

        return {
          playerConfig,
          durationInFrames: totalDuration,
          width: props.width,
          height: props.height,
          ...props,
        };
      }}
    />
  );
};

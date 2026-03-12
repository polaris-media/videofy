import type { FC } from "react";
import { useVideoConfig } from "remotion";
import { playerSchema } from "@videofy/types";
import type { z } from "zod";
import { cssStringToReactStyle } from "../utils/cssStringToReactStyle";

type PlayerConfig = z.infer<typeof playerSchema>;

interface Props {
  current: number;
  length: number;
  config: PlayerConfig;
}

const ArticleProgress: FC<Props> = ({ current, length, config }) => {
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;
  const layout = config.progress;
  const placement = layout?.placement || "left";
  const offsetX = layout?.offsetX ?? 65;
  const offsetY = isPortrait
    ? (layout?.offsetYPortrait ?? 460)
    : (layout?.offsetYLandscape ?? 276);
  const itemSize = layout?.size ?? 90;
  const gap = layout?.gap ?? 6;
  const shape = layout?.shape || "rounded";
  const borderRadius =
    shape === "circle" ? "999px" : shape === "square" ? "0px" : "8px";
  const fontSize = Math.max(24, Math.round(itemSize * 0.75));

  if (length <= 1) {
    return null;
  }

  const defaultStyle: React.CSSProperties = {
    position: "absolute",
    [placement]: `${offsetX}px`,
    top: `${offsetY}px`,

    display: "flex",
    width: `${itemSize}px`,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: `${gap}px`,
    zIndex: 0,
  };

  return (
    <div style={defaultStyle}>
      {Array.from({ length }, (_, index) => {
        const key = `indicator-${current}-${index}`;
        const defaultStyle: React.CSSProperties = {
          backgroundColor:
            current === index
              ? config.colors?.progress.active.background
              : config.colors?.progress.inactive.background,
          color:
            current === index
              ? config.colors?.progress.active.text
              : config.colors?.progress.inactive.text,
          borderRadius,

          display: "flex",
          height: `${itemSize}px`,
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          alignSelf: "stretch",

          textAlign: "center",
          textShadow: "1px 1px 4px rgba(0, 0, 0, 0.40)",
          fontSize: `${fontSize}px`,
          fontWeight: 600,
        };

        const configValue =
          config.styles?.all?.progress ||
          (isPortrait
            ? config.styles?.portrait?.progress
            : config.styles?.landscape?.progress);
        const progressStyle =
          current === index
            ? cssStringToReactStyle(configValue?.active)
            : cssStringToReactStyle(configValue?.inactive);
        const style: React.CSSProperties = {
          ...defaultStyle,
          ...progressStyle,
        };
        return (
          <span key={key} style={style}>
            {index + 1}
          </span>
        );
      })}
    </div>
  );
};
export default ArticleProgress;

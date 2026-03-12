import type { CSSProperties, FC } from "react";
import { playerSchema } from "@videofy/types";
import type { z } from "zod";
import { cssStringToReactStyle } from "../utils/cssStringToReactStyle";

type PlayerConfig = z.infer<typeof playerSchema>;
import { useVideoConfig } from "remotion";

interface ExtendedCSSProperties extends CSSProperties {
  "--icon-size"?: string; // Add custom CSS property for icon size
  "--icon-color"?: string; // Add custom CSS property for icon color
}

interface Props {
  byline: string;
  config: PlayerConfig;
}

const VideoGlyph: FC<{ color: string }> = ({ color }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <rect x="3" y="6" width="13" height="12" rx="2" stroke={color} strokeWidth="2" />
    <path d="M16 10L21 7V17L16 14V10Z" stroke={color} strokeWidth="2" />
  </svg>
);

const PhotoCredits: FC<Props> = ({ byline, config }) => {
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;

  const configValue =
    config.styles?.all?.photoCredits ||
    (isPortrait
      ? config.styles?.portrait?.photoCredits
      : config.styles?.landscape?.photoCredits);

  const defaultContainerStyle: ExtendedCSSProperties = {
    display: "flex",
    writingMode: "vertical-rl",
    justifyContent: "center",
    alignItems: "center",
    gap: "4px",
    position: "absolute",
    right: "65px",
    top: "380px",
    zIndex: 0,
    color: config.colors?.fotoCredits?.text || "white",
    "--icon-size": "30px",
    "--icon-color": config.colors?.fotoCredits?.icon || "white",
  };

  const defaultTextStyle: ExtendedCSSProperties = {
    textAlign: "center",
    fontSize: "26px",
    fontWeight: 400,
  };

  const containerStyle = {
    ...defaultContainerStyle,
    ...cssStringToReactStyle(configValue?.container),
  };

  const textStyle: ExtendedCSSProperties = {
    ...defaultTextStyle,
    ...cssStringToReactStyle(configValue?.text),
  };
  return (
    <div style={containerStyle}>
      <div style={{ transform: "rotate(90deg)" }}>
        <VideoGlyph color={config.colors?.fotoCredits?.icon || "white"} />
      </div>
      <span style={textStyle}>{byline}</span>
    </div>
  );
};

export default PhotoCredits;

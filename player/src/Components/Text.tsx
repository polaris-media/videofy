import { useRef, type CSSProperties, type FC } from "react";
import { useVideoConfig } from "remotion";
import { playerSchema } from "@videofy/types";
import type { z } from "zod";
import { cssStringToReactStyle } from "../utils/cssStringToReactStyle";

type PlayerConfig = z.infer<typeof playerSchema>;

interface NewlineParserProps {
  text: string;
  style: React.CSSProperties;
}

const NewlineParser: FC<NewlineParserProps> = ({ text, style }) => {
  return (
    <>
      {text.split("\n").map((line, index) => {
        const key = `line-${index}`;

        return (
          <span style={style} key={key}>
            {line}
            <br />
          </span>
        );
      })}
    </>
  );
};

interface Props {
  titleText: string;
  placement?: "top" | "middle" | "bottom";
  config: PlayerConfig;
}

export const Text: FC<Props> = ({
  titleText,
  placement = "bottom",
  config,
}) => {
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;
  let containerStyle: CSSProperties = {};
  let textStyle: CSSProperties = {};

  const configValue =
    config.styles?.all?.captions ||
    (isPortrait
      ? config.styles?.portrait?.captions
      : config.styles?.landscape?.captions);

  let placementStyle: CSSProperties = {};
  const placementConfigValue = configValue?.placements?.[placement || "bottom"];
  if (placementConfigValue) {
    placementStyle = cssStringToReactStyle(placementConfigValue);
  } else {
    switch (placement) {
      case "top":
        placementStyle = { ...placementStyle, top: "15%" };
        break;
      case "middle":
        placementStyle = {
          ...placementStyle,
          top: "50%",
          transform: "translateY(-50%)",
        };
        break;
      case "bottom":
      default:
        placementStyle = { ...placementStyle, bottom: "15%" };
        break;
    }
  }
  let defaultContainerStyle: CSSProperties = {
    position: "absolute",
    color: "white",
    backgroundColor: "black",
    padding: 4,
    textAlign: "center",
  };
  let defaultTextStyle: CSSProperties = { padding: 4 };

  if (!configValue) {
    defaultContainerStyle = {
      position: "absolute",
      left: isPortrait ? "15%" : "10%",
      right: isPortrait ? "15%" : "10%",
      display: "inline",
    };
    defaultTextStyle = {
      fontWeight: "700",
      fontSize: "64px",
      paddingInline: "20px",
      paddingBlock: "2px",
      borderRadius: "8px",
      lineHeight: "94px",
      backgroundColor: config.colors?.text.background,
      color: config.colors?.text?.text,
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    };
  }
  containerStyle = {
    ...defaultContainerStyle,
    ...placementStyle,
    ...cssStringToReactStyle(configValue?.container),
  };
  textStyle = {
    fontSize: isPortrait ? "48px" : "64px",
    ...defaultTextStyle,
    ...cssStringToReactStyle(configValue?.text),
  };

  const boxRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={boxRef} style={containerStyle}>
      <NewlineParser text={titleText} style={textStyle} />
    </div>
  );
};

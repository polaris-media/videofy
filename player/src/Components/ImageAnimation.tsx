import { CSSProperties, FC } from "react";
import { AbsoluteFill } from "remotion";
import {
  makeTransform,
  rotate as remotionRotate,
  scale as remotionScale,
  translate as remotionTranslate,
} from "@remotion/animation-utils";
import { Easing, Img, interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { getHotspot } from "../utils/getHotspot";
import { calculateCameraMovement } from "../utils/calculateCameraMovement";
import { cameraMovementsEnum, imageSchema } from "@videofy/types";

const imageStyles: CSSProperties = {
  objectFit: "cover",
  width: "100%",
  height: "100%",
};

interface Props {
  asset: z.infer<typeof imageSchema>;
  cameraMovement?: z.infer<typeof cameraMovementsEnum>;
  durationInFrames: number;
}

export const ImageAnimation: FC<Props> = ({
  asset,
  cameraMovement,
  durationInFrames,
}) => {
  if (asset.displayMode === "contain-blur") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#0b1220", overflow: "hidden" }}>
        <Img
          style={{
            ...imageStyles,
            filter: "blur(48px)",
            transform: "scale(1.12)",
            opacity: 0.85,
          }}
          src={asset.url}
        />
        <Img
          style={{
            ...imageStyles,
            objectFit: "contain",
            padding: "3%",
            position: "absolute",
            inset: 0,
          }}
          src={asset.url}
        />
      </AbsoluteFill>
    );
  }

  const frame = useCurrentFrame();

  const hotspot = getHotspot(asset);

  const effect = interpolate(frame, [0, durationInFrames], [0, 2], {
    easing: Easing.inOut(Easing.ease),
  });
  const { scale, posX, posY, rotation } = calculateCameraMovement(
    effect,
    cameraMovement
  );

  const transform = makeTransform([
    remotionRotate(rotation),
    remotionScale(scale),
    remotionTranslate(posX, posY),
  ]);

  return (
    <Img
      style={{
        ...imageStyles,
        objectPosition: hotspot,
        transformOrigin: hotspot,
        transform,
      }}
      src={asset.url}
    />
  );
};

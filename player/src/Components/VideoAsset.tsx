import { FC } from "react";
import { videoSchema } from "@videofy/types";
import { z } from "zod";
import { OffthreadVideo } from "remotion";
import { roundToNearestFrame } from "../utils/timestamps";

interface Props {
  asset: z.infer<typeof videoSchema>;
  volume: number;
}

const VideoAsset: FC<Props> = ({ asset, volume = 0 }) => {
  return (
    <OffthreadVideo
      src={asset.url}
      startFrom={asset?.startFrom && roundToNearestFrame(asset.startFrom)}
      endAt={asset?.endAt && roundToNearestFrame(asset.endAt)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: "center",
        transformOrigin: "center",
      }}
      volume={volume}
      pauseWhenBuffering={true}
    />
  );
};

export default VideoAsset;

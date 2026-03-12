import { z } from "zod";
import { imageSchema } from "@videofy/types";

export const getHotspot = (asset?: z.infer<typeof imageSchema>) => {
  const hotspot = asset?.hotspot;

  if (hotspot && asset?.imageAsset?.size?.height) {
    return [
      (hotspot.x + hotspot.width / 2) / asset.imageAsset.size.width,
      (hotspot.y + hotspot.height / 2) / asset.imageAsset.size.height,
    ]
      .map((number) => number * 100 + "%")
      .join(" ");
  }

  return "50% 50%";
};

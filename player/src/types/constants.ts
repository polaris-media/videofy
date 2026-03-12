import { playerSchema } from "@videofy/types";
import type { z } from "zod";

type PlayerConfig = z.infer<typeof playerSchema>;

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 25;

export const defaultPlayerConfig: PlayerConfig = {
  assetBaseUrl: ".",
  logo: "logo.svg",
  logoStyle: "position: absolute; top: 90px; right: 65px;",
  colors: {
    text: {
      background: "#DD0000",
      text: "#fff",
    },
    progress: {
      active: {
        background: "#DD0000",
        text: "#fff",
      },
      inactive: {
        background: "#000",
        text: "#fff",
      },
    },
    map: {
      marker: "#DD0000",
    },
    fotoCredits: {
      text: "#CACACA",
      icon: "#CACACA",
    },
  },
  backgroundMusicVolume: 1,
};

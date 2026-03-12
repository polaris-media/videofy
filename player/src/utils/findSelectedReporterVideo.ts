import { playerSchema } from "@videofy/types";
import type { z } from "zod";

type PlayerConfig = z.infer<typeof playerSchema>;

export const getSelectedReporterIntro = (playerConfig: PlayerConfig) =>
  playerConfig.reporterVideos?.intro
    ? Object.values(playerConfig.reporterVideos.intro).find(
        (video) => video.selected
      )
    : null;

export const getSelectedReporterOutro = (playerConfig: PlayerConfig) =>
  playerConfig.reporterVideos?.outro
    ? Object.values(playerConfig.reporterVideos.outro).find(
        (video) => video.selected
      )
    : null;

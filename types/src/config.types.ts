import { z } from "zod";
import { cameraMovementsEnum } from "./constants.types";

export const generationModelEnum = z.enum(["gpt-4o", "gpt-5.1", "gpt-5.4"]);

const backgroundSchema = z.object({
  max_volume: z.number().positive(),
  min_volume: z.number().positive(),
  music_map: z.string().optional(),
  music: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional(),
});

const graphicsSchema = z.object({
  item_types: z.array(
    z.union([
      z.literal("text"),
      z.literal("image"),
      z.literal("video"),
      z.literal("map"),
    ])
  ),
});

const manuscriptConfigSchema = z.object({
  split_article_into_chapters: z.boolean(),
  intro: z.string().optional(),
  outro: z.string().optional(),
  script_prompt: z.string(),
  placement_prompt: z.string(),
  describe_images_prompt: z.string(),
});

const personSchema = z.object({
  voice: z.string(),
  stability: z.number(),
  similarity_boost: z.number(),
  style: z.number(),
  use_speaker_boost: z.boolean(),
});

const audioSchema = z.object({
  tts: z.union([z.literal("elevenlabs"), z.literal("google")]),
  background: backgroundSchema,
  sync_silence: z.number(),
  segment_pause: z.number(),
  segment_pause_silence: z.number(),
});

const peopleSchema = z.object({
  default: personSchema,
  intro: personSchema.optional(),
  outro: personSchema.optional(),
});

const styleSchema = z.object({
  captions: z
    .object({
      container: z.string().optional(),
      text: z.string().optional(),
      placements: z
        .object({
          top: z.string().optional(),
          middle: z.string().optional(),
          bottom: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  photoCredits: z
    .object({
      variant: z.enum(["vertical", "badge"]).optional(),
      showIcon: z.boolean().optional(),
      container: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  progress: z
    .object({
      active: z.string(),
      inactive: z.string(),
    })
    .optional(),
  map: z
    .object({
      marker: z
        .object({
          color: z.string(),
          scale: z.number(),
        })
        .optional(),
      labelContainer: z.string().optional(),
      labelText: z.string().optional(),
    })
    .optional(),
});

const stylesSchema = z.object({
  all: styleSchema.optional(),
  portrait: styleSchema.optional(),
  landscape: styleSchema.optional(),
});

export const colorsSchema = z.object({
  text: z.object({
    text: z.string(),
    background: z.string(),
  }),
  progress: z.object({
    active: z.object({
      background: z.string(),
      text: z.string(),
    }),
    inactive: z.object({
      background: z.string(),
      text: z.string(),
    }),
  }),
  map: z.object({
    marker: z.string(),
  }),
  fotoCredits: z.object({
    text: z.string(),
    icon: z.string(),
  }),
});

export const customCutsSchema = z.object({
  portrait: z.string(),
  landscape: z.string(),
  duration: z.number(),
  offset: z.number(),
});

export const outroCardSchema = z.object({
  duration: z.number(),
  backgroundColor: z.string().optional(),
  backgroundImage: z.string().optional(),
  logo: z.string().optional(),
  logoScalePercent: z.number().positive().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  logoStyle: z.string().optional(),
  titleStyle: z.string().optional(),
  bodyStyle: z.string().optional(),
});

export const reporterVideoSchema = z.object({
  // Renamed from videoSchema
  // This is for reporter videos
  portrait: z.string(),
  landscape: z.string(),
  duration: z.number(),
  selected: z.boolean().optional(),
});

const reporterVideosSchema = z.object({
  intro: z.record(z.string(), reporterVideoSchema).optional(),
  outro: z.record(z.string(), reporterVideoSchema).optional(),
});

const fontsSchema = z.record(z.string(), z.string());

const progressLayoutSchema = z.object({
  placement: z.enum(["left", "right"]).optional(),
  offsetX: z.number().nonnegative().optional(),
  offsetYPortrait: z.number().optional(),
  offsetYLandscape: z.number().optional(),
  size: z.number().positive().optional(),
  gap: z.number().nonnegative().optional(),
  shape: z.enum(["square", "rounded", "circle"]).optional(),
});

export const playerSchema = z.object({
  assetBaseUrl: z.string().optional(),
  logo: z.string().optional(),
  logoStyle: z.string().optional(),
  logoText: z.string().optional(),
  logoTextStyle: z.string().optional(),
  defaultCameraMovements: z.array(cameraMovementsEnum).optional(),
  fonts: fontsSchema.optional(),
  styles: stylesSchema.optional(),
  colors: colorsSchema.optional(),
  progress: progressLayoutSchema.optional(),
  backgroundMusicVolume: z.number().optional(),
  backgroundMusic: z.string().optional(),
  moodMusic: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional(),
  outroCard: outroCardSchema.optional(),
  intro: customCutsSchema.optional(),
  wipe: customCutsSchema.optional(),
  outro: customCutsSchema.optional(),
  reporterVideos: reporterVideosSchema.optional(),
});

const streamSchema = z.object({
  enabled: z.boolean(),
  provider: z.string(),
  providerTitle: z.string(),
  titlePrefix: z.string(),
  verticalCategory: z.number(),
  horizontalCategory: z.number(),
});

const exportDefaultsSchema = z.object({
  exportType: z.string().optional(),
  logo: z.boolean().optional(),
  audio: z.boolean().optional(),
  voice: z.boolean().optional(),
  music: z.boolean().optional(),
});

const openaiConfigSchema = z.object({
  manuscriptModel: generationModelEnum.optional(),
  mediaModel: generationModelEnum.optional(),
});

const configSchema = z.object({
  name: z.string(),
  description: z.string(),
  id: z.string(),
  openai: openaiConfigSchema.optional(),
  people: peopleSchema,
  manuscript: manuscriptConfigSchema,
  graphics: graphicsSchema,
  audio: audioSchema,
  player: playerSchema.optional(),
  stream: streamSchema.optional(),
  exportDefaults: exportDefaultsSchema.optional(),
  path: z.string().optional(),
  default_assets_base_url: z.string(),
});

export const appConfigSchema = configSchema.extend({
  player: playerSchema.optional(),
  stream: streamSchema.optional(),
  path: z.string().optional(),
});

export type Config = z.infer<typeof appConfigSchema>;

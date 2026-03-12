import type { Config } from "@videofy/types";

export const buildDefaultConfig = (projectId: string): Config => ({
  name: "Minimal Default",
  description: "Local default config for minimal mode",
  id: "minimal-default",
  openai: {
    manuscriptModel: "gpt-4o",
    mediaModel: "gpt-4o",
  },
  people: {
    default: {
      voice: "",
      stability: 0.6,
      similarity_boost: 0.8,
      style: 0,
      use_speaker_boost: true,
    },
  },
  manuscript: {
    split_article_into_chapters: false,
    script_prompt:
      "Summarize the article in short factual lines suitable for voice-over.",
    placement_prompt:
      "Match the best available media for each script line. Prioritize videos.",
    describe_images_prompt:
      "Describe the image content briefly and factually for short-form news video.",
  },
  graphics: {
    item_types: ["text", "image", "video", "map"],
  },
  audio: {
    tts: "elevenlabs",
    background: {
      max_volume: 1,
      min_volume: 0.2,
      music: {},
    },
    sync_silence: 0.5,
    segment_pause: 0.4,
    segment_pause_silence: 0.4,
  },
  player: {
    logo: "/assets/logo.svg",
    assetBaseUrl:
      process.env.NEXT_PUBLIC_CMS_BASE_URL || "http://127.0.0.1:3000",
  },
  default_assets_base_url: `/projects/${projectId}/files/input`,
  exportDefaults: {
    exportType: "Vertical",
    logo: true,
    audio: true,
    voice: true,
    music: true,
  },
});

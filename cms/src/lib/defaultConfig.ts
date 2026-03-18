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
    assetBaseUrl: ".",
    logoStyle: "position: absolute; top: 88px; right: 52px; width: 78px; opacity: 0.6;",
    progress: {
      placement: "left",
      offsetX: 42,
      offsetYPortrait: 1010,
      size: 56,
      gap: 10,
      shape: "circle",
    },
    styles: {
      portrait: {
        captions: {
          container: "left: 88px; right: 88px;",
          text:
            "font-family: 'SF Pro Text','SF Pro Display','Helvetica Neue',Arial,sans-serif; font-weight: 700; font-size: 56px; line-height: 1.15; border-radius: 10px; padding: 8px 18px; background: #1c1e57; color: #ffffff;",
          placements: {
            top: "top: 14%;",
            middle: "top: 50%; transform: translateY(-50%);",
            bottom: "bottom: 13%;",
          },
        },
        progress: {
          active:
            "font-family: 'SF Pro Text','SF Pro Display','Helvetica Neue',Arial,sans-serif; font-weight: 700;",
          inactive:
            "font-family: 'SF Pro Text','SF Pro Display','Helvetica Neue',Arial,sans-serif; font-weight: 700;",
        },
        photoCredits: {
          variant: "badge",
          showIcon: false,
          container: "left: 42px; top: 88px; background: rgba(28, 30, 87, 0.92);",
          text:
            "font-family: 'SF Pro Text','SF Pro Display','Helvetica Neue',Arial,sans-serif; font-size: 22px; font-weight: 600;",
        },
      },
    },
    colors: {
      text: {
        background: "#1c1e57",
        text: "#ffffff",
      },
      progress: {
        active: {
          background: "#1c1e57",
          text: "#ffffff",
        },
        inactive: {
          background: "rgba(0, 0, 0, 0.72)",
          text: "#ffffff",
        },
      },
      map: {
        marker: "#1c1e57",
      },
      fotoCredits: {
        text: "#ffffff",
        icon: "#ffffff",
      },
    },
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

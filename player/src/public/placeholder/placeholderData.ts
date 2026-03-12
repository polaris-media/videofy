import type { z } from "zod";
import type { processedManuscriptSchema } from "@videofy/types";

const placeholderData: z.infer<typeof processedManuscriptSchema>[] = [
  {
    meta: {
      title: "Sample Local Story",
      pubdate: "2026-01-01T12:00:00Z",
      byline: "Videofy Minimal",
      id: 1,
      uniqueId: "sample-local-story-1",
      description: "Sample processed manuscript used in Remotion studio.",
      audio: {
        src: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp3",
      },
    },
    segments: [
      {
        id: 1,
        mood: "neutral",
        type: "segment",
        style: "bottom",
        texts: [
          {
            type: "text",
            text: "This repository ships with neutral demo data for local preview.",
            line_id: 1,
            who: "default",
            start: 0,
            end: 4.2,
          },
        ],
        cameraMovement: "zoom-in",
        images: [
          {
            type: "image",
            byline: "Sample image",
            imageAsset: {
              id: "sample-image-1",
              size: {
                width: 1920,
                height: 1080,
              },
            },
            url: "https://picsum.photos/id/1015/1920/1080",
            hotspot: {
              x: 420,
              y: 220,
              width: 1080,
              height: 620,
              x_norm: 0.2188,
              y_norm: 0.2037,
              width_norm: 0.5625,
              height_norm: 0.5741,
            },
          },
        ],
        start: 0,
        end: 4.2,
      },
      {
        id: 2,
        mood: "neutral",
        type: "segment",
        style: "bottom",
        texts: [
          {
            type: "text",
            text: "You can replace this data with generated output from the API.",
            line_id: 2,
            who: "default",
            start: 4.2,
            end: 9.6,
          },
        ],
        cameraMovement: "pan-right",
        images: [
          {
            type: "video",
            byline: "Sample video",
            videoAsset: {
              id: "sample-video-1",
              title: "Big Buck Bunny sample",
              duration: 10000,
              streamUrls: {
                mp4: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
              },
            },
            startFrom: 2,
            endAt: 8,
            url: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          },
        ],
        start: 4.2,
        end: 9.6,
      },
    ],
  },
];

export default placeholderData;

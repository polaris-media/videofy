import { z } from "zod";

export const normalizedSvpVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  published: z.number().nullable().optional(),
  provider: z.string().nullable().optional(),
  categoryTitle: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  playableUrl: z.string().url().nullable().optional(),
  aspectRatio: z.string().nullable().optional(),
  streamProperties: z.array(z.string()).optional(),
  streamUrls: z.object({
    hls: z.string().url().nullable().optional(),
    hds: z.string().url().nullable().optional(),
    mp4: z.string().url().nullable().optional(),
    pseudostreaming: z.array(z.string().url()).nullable().optional(),
  }),
});

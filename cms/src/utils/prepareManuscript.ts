import {
  ManuscriptType,
  MediaAssetType,
  segmentSchema,
  textSchema,
} from "@videofy/types";
import { z } from "zod";

export const prepareManuscript = (
  manuscript: ManuscriptType
): ManuscriptType => {
  const mediaFromSegments: Array<MediaAssetType> = [];
  manuscript.segments.forEach((s: z.infer<typeof segmentSchema>) => {
    s.text = s.texts
      .map((t: z.infer<typeof textSchema>) => t.text)
      .join("\n\n");
    s.mainMedia = s.images?.[0];
    s.images?.forEach((i: MediaAssetType) => {
      mediaFromSegments.push(i);
    });
  });

  const existingMedia = Array.isArray(manuscript.media) ? manuscript.media : [];
  const mergedMedia = [...existingMedia, ...mediaFromSegments];
  const dedupedMedia = mergedMedia.filter((media, index, allMedia) => {
    const currentKey =
      media.type === "map"
        ? `map:${media.location.lat}:${media.location.lon}`
        : media.type === "image"
          ? `image:${media.imageAsset.id}:${media.url}`
          : `video:${media.videoAsset.id}:${media.startFrom ?? ""}:${media.endAt ?? ""}:${media.url}`;

    return (
      index ===
      allMedia.findIndex((candidate) => {
        const candidateKey =
          candidate.type === "map"
            ? `map:${candidate.location.lat}:${candidate.location.lon}`
            : candidate.type === "image"
              ? `image:${candidate.imageAsset.id}:${candidate.url}`
              : `video:${candidate.videoAsset.id}:${candidate.startFrom ?? ""}:${candidate.endAt ?? ""}:${candidate.url}`;

        return candidateKey === currentKey;
      })
    );
  });

  manuscript.media = dedupedMedia;

  return manuscript;
};

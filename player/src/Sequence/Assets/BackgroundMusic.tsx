import { Audio, Sequence } from "remotion";
import { processedManuscriptSchema } from "@videofy/types";
import { z } from "zod";
import { FC } from "react";

interface Props {
  manuscripts: Array<z.infer<typeof processedManuscriptSchema>>;
  backgroundMusic?: string;
  volume?: number;
}

export const BackgroundMusic: FC<Props> = ({ backgroundMusic, volume }) => {
  if (!backgroundMusic) {
    return null;
  }
  return (
    <Sequence>
      <Audio src={backgroundMusic} volume={volume} loop />
    </Sequence>
  );
};

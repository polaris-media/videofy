import { AbsoluteFill, Sequence } from "remotion";
import { FC } from "react";
import { cssStringToReactStyle } from "../../utils/cssStringToReactStyle";

type Props = {
  durationInFrames: number;
  card: {
    backgroundColor?: string;
    backgroundImage?: string;
    logo?: string;
    logoScalePercent?: number;
    title?: string;
    body?: string;
    logoStyle?: string;
    titleStyle?: string;
    bodyStyle?: string;
  };
};

export const OutroCard: FC<Props> = ({ durationInFrames, card }) => {
  const logoScale = (card.logoScalePercent || 100) / 100;
  const baseBackgroundStyle: React.CSSProperties = {
    background: card.backgroundColor || "#0b1220",
    color: "#ffffff",
  };

  const contentStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    padding: "120px 96px",
    textAlign: "center",
  };

  const defaultLogoStyle: React.CSSProperties = {
    maxWidth: 220 * logoScale,
    maxHeight: 120 * logoScale,
    objectFit: "contain",
  };

  const defaultTitleStyle: React.CSSProperties = {
    fontSize: 64,
    fontWeight: 700,
    lineHeight: 1.1,
    maxWidth: 1200,
    margin: 0,
  };

  const defaultBodyStyle: React.CSSProperties = {
    fontSize: 40,
    lineHeight: 1.35,
    maxWidth: 1200,
    margin: 0,
    opacity: 0.92,
    whiteSpace: "pre-wrap",
  };

  const logoStyle = {
    ...defaultLogoStyle,
    ...cssStringToReactStyle(card.logoStyle),
  };
  const titleStyle = {
    ...defaultTitleStyle,
    ...cssStringToReactStyle(card.titleStyle),
  };
  const bodyStyle = {
    ...defaultBodyStyle,
    ...cssStringToReactStyle(card.bodyStyle),
  };

  return (
    <Sequence durationInFrames={durationInFrames}>
      <AbsoluteFill style={baseBackgroundStyle}>
        {card.backgroundImage ? (
          <AbsoluteFill
            style={{
              backgroundImage: `url(${card.backgroundImage})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
              opacity: 0.2,
            }}
          />
        ) : null}
        <AbsoluteFill style={contentStyle}>
          {card.logo ? <img src={card.logo} style={logoStyle} alt="Outro logo" /> : null}
          {card.title ? <h1 style={titleStyle}>{card.title}</h1> : null}
          {card.body ? <p style={bodyStyle}>{card.body}</p> : null}
        </AbsoluteFill>
      </AbsoluteFill>
    </Sequence>
  );
};

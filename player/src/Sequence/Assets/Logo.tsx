import { Sequence } from "remotion";
import { FC } from "react";
import { cssStringToReactStyle } from "../../utils/cssStringToReactStyle";

interface Props {
  logo?: string;
  logoStyle?: string;
  logoText?: string;
  logoTextStyle?: string;
}

export const Logo: FC<Props> = ({ logo, logoStyle, logoText, logoTextStyle }) => {
  const parsedStyle = cssStringToReactStyle(logoStyle || "top: 90px; right: 65px;");
  const hasSize =
    typeof parsedStyle.width !== "undefined" ||
    typeof parsedStyle.height !== "undefined" ||
    typeof parsedStyle.maxWidth !== "undefined";

  const style: React.CSSProperties = {
    position: "absolute",
    ...parsedStyle,
    ...(hasSize ? {} : { width: "96px" }),
  };

  const parsedTextStyle = cssStringToReactStyle(
    logoTextStyle ||
      "top: 52px; right: 48px; padding: 10px 14px; border-radius: 999px; background: rgba(0, 0, 0, 0.78); color: #fff; font-size: 34px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;"
  );
  const textStyle: React.CSSProperties = {
    position: "absolute",
    whiteSpace: "nowrap",
    lineHeight: 1,
    ...parsedTextStyle,
  };

  if (logoText) {
    return (
      <Sequence>
        <div style={textStyle}>{logoText}</div>
      </Sequence>
    );
  }

  if (!logo) {
    return null;
  }

  return (
    <Sequence>
      <img src={logo} style={style} alt="Logo" />
    </Sequence>
  );
};

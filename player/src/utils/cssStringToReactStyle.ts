import React from "react";

/**
 * Converts CSS string syntax to React style object
 * @param cssString - CSS styles as a string (e.g. "color: red; font-size: 16px;")
 * @returns React.CSSProperties object ready for use in style prop
 */
export function cssStringToReactStyle(
  cssString: string = ""
): React.CSSProperties {
  if (!cssString) {
    return {};
  }

  return cssString
    .split(";")
    .reduce((styleObject: React.CSSProperties, rule) => {
      const [key, value] = rule.split(":").map((s) => s?.trim() || "");

      if (!key || !value) return styleObject;

      // Convert kebab-case to camelCase and handle numeric values
      const reactKey = key.replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      ) as keyof React.CSSProperties;

      // Parse numeric values (including px units) while preserving strings
      const numericValue = parseFloat(value);

      // @ts-expect-error: Type 'string | number' is not assignable to type 'string & {}'
      styleObject[reactKey] = isNaN(value)
        ? value
        : value.endsWith("px")
          ? numericValue
          : numericValue;

      return styleObject;
    }, {});
}

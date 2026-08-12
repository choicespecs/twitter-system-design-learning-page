export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 52;
export const CANVAS_PADDING = 20;

const MAX_LINE_CHARS = 14;

/** Splits a node label into up to 2 lines, breaking at the space closest to the midpoint. */
export function wrapLabel(label: string): string[] {
  if (label.length <= MAX_LINE_CHARS) return [label];

  const words = label.split(" ");
  if (words.length === 1) return [label];

  let bestIndex = 1;
  let bestDiff = Infinity;
  let acc = 0;

  for (let i = 0; i < words.length - 1; i++) {
    acc += words[i].length + 1;
    const diff = Math.abs(acc - label.length / 2);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i + 1;
    }
  }

  return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")];
}

import { type GameSummary, rankStandings, summaryTextLines } from "./summary";

/**
 * The summary card as a PNG, drawn with the platform's own canvas.
 *
 * No image dependency, no server round trip: a group wants a picture in the chat
 * they are already in, and the board is already gone by the time they ask. The
 * text a canvas cannot render (or a browser that has no canvas at all) is the
 * same text the card shows for copy, so nothing is image-only.
 */
export const SUMMARY_IMAGE = { height: 1350, width: 1080 } as const;

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const INK = "#1a1a1a";
const MUTED = "#5b6472";
const CORAL = "#ee6c4d";

/** Canvas support is a capability question, not a feature flag: ask the browser. */
export function canRenderSummaryImage(): boolean {
  if (typeof document === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    return context !== null && typeof canvas.toBlob === "function";
  } catch {
    // jsdom (and any environment without 2d canvas) throws instead of answering.
    return false;
  }
}

type SummaryImageOptions = {
  title: string;
  labels: Record<string, string>;
  summary: GameSummary;
};

/**
 * The drawing itself. Kept separate from `renderSummaryImage` so a test can
 * assert on the text it lays out without a real rasteriser.
 */
export function drawSummary(canvas: HTMLCanvasElement, options: SummaryImageOptions): boolean {
  const context = canvas.getContext("2d");
  if (!context) return false;

  const { width, height } = SUMMARY_IMAGE;
  canvas.width = width;
  canvas.height = height;

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#fff6ee");
  background.addColorStop(1, "#ffe7d6");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const margin = 88;
  let cursor = 150;

  context.fillStyle = CORAL;
  context.font = `700 30px ${FONT_STACK}`;
  context.fillText("ROUNDHOUSE", margin, cursor);

  cursor += 84;
  context.fillStyle = INK;
  fitText(context, options.title, margin, cursor, width - margin * 2, 68, "700");

  cursor += 78;
  const [headline] = summaryTextLines(options).slice(1);
  context.fillStyle = CORAL;
  fitText(context, headline ?? "", margin, cursor, width - margin * 2, 52, "600");

  cursor += 96;
  context.strokeStyle = "rgba(26,26,26,0.12)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(margin, cursor);
  context.lineTo(width - margin, cursor);
  context.stroke();

  cursor += 76;
  rankStandings(options.summary.standings).forEach((standing, index) => {
    context.fillStyle = MUTED;
    context.font = `600 40px ${FONT_STACK}`;
    context.textAlign = "left";
    context.fillText(`${index + 1}.`, margin, cursor);

    context.fillStyle = INK;
    fitText(
      context,
      options.labels[standing.playerId] ?? standing.playerId,
      margin + 72,
      cursor,
      width - margin * 2 - 240,
      44,
      "600",
    );

    context.textAlign = "right";
    context.fillStyle = INK;
    context.font = `700 48px ${FONT_STACK}`;
    context.fillText(String(standing.total), width - margin, cursor);
    context.textAlign = "left";

    cursor += 78;
  });

  if (options.summary.rounds !== undefined) {
    context.fillStyle = MUTED;
    context.font = `500 34px ${FONT_STACK}`;
    cursor += 16;
    context.fillText(`${options.summary.rounds} rounds`, margin, cursor);
    cursor += 60;
  }

  for (const line of options.summary.lines ?? []) {
    context.fillStyle = MUTED;
    context.font = `500 34px ${FONT_STACK}`;
    fitText(context, `${line.label}: ${line.value}`, margin, cursor, width - margin * 2, 34, "500");
    cursor += 56;
  }

  context.fillStyle = MUTED;
  context.font = `500 28px ${FONT_STACK}`;
  context.fillText("Played on Roundhouse", margin, height - 84);

  return true;
}

/** Draws the card and hands back a PNG blob, or null when canvas cannot. */
export async function renderSummaryImage(options: SummaryImageOptions): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  if (!drawSummary(canvas, options)) return null;
  if (typeof canvas.toBlob !== "function") return null;

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/** Saves a rendered card under `filename`; the caller owns naming. */
export function downloadSummaryImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can race the download start in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Shrinks the font until the text fits, so a long table title keeps its whole
 * name instead of being clipped at the card's edge.
 */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  startSize: number,
  weight: string,
): void {
  let size = startSize;
  context.font = `${weight} ${size}px ${FONT_STACK}`;

  while (size > 18 && context.measureText(text).width > maxWidth) {
    size -= 2;
    context.font = `${weight} ${size}px ${FONT_STACK}`;
  }

  context.fillText(text, x, y);
}

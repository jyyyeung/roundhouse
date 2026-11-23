import { afterEach, describe, expect, it, vi } from "vitest";

import type { GameSummary } from "./summary";
import { canRenderSummaryImage, downloadSummaryImage, renderSummaryImage } from "./summary-image";

const summary: GameSummary = {
  lines: [{ label: "Best category", value: "Fives — 20" }],
  rounds: 14,
  standings: [
    { playerId: "user-a", total: 187 },
    { playerId: "user-b", total: 214 },
  ],
  winners: ["user-b"],
};

const card = {
  labels: { "user-a": "You", "user-b": "Player 2" },
  summary,
  title: "Riverside Yatzy",
};

/** The smallest 2d context the card draws through, recording what it is told. */
function fakeContext() {
  const drawn: string[] = [];
  const context = {
    beginPath: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect: vi.fn(),
    fillText: (text: string) => drawn.push(text),
    lineTo: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 10 }),
    moveTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    font: "",
    lineWidth: 0,
    strokeStyle: "",
    textAlign: "left",
  };

  return { context, drawn };
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

function stubCanvas({ context }: { context: ReturnType<typeof fakeContext>["context"] | null }) {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as never;
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
    callback(new Blob(["png"], { type: "image/png" }));
  }) as never;
}

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  vi.restoreAllMocks();
});

describe("summary image", () => {
  it("reports canvas support only when a 2d context and toBlob are both there", () => {
    const { context } = fakeContext();
    stubCanvas({ context });
    expect(canRenderSummaryImage()).toBe(true);

    stubCanvas({ context: null });
    expect(canRenderSummaryImage()).toBe(false);
  });

  it("treats a throwing getContext as no canvas at all", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => {
      throw new Error("not implemented");
    }) as never;
    HTMLCanvasElement.prototype.toBlob = vi.fn() as never;

    expect(canRenderSummaryImage()).toBe(false);
  });

  it("draws the card and hands back a PNG blob", async () => {
    const { context, drawn } = fakeContext();
    stubCanvas({ context });

    const blob = await renderSummaryImage(card);

    expect(blob?.type).toBe("image/png");
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
    );
    // The same text the card shows, laid out for the picture.
    expect(drawn).toEqual(
      expect.arrayContaining([
        "ROUNDHOUSE",
        "Riverside Yatzy",
        "Player 2 wins",
        "1.",
        "Player 2",
        "214",
        "2.",
        "You",
        "187",
        "14 rounds",
        "Best category: Fives — 20",
        "Played on Roundhouse",
      ]),
    );
  });

  it("returns null instead of throwing when there is no 2d context", async () => {
    stubCanvas({ context: null });

    await expect(renderSummaryImage(card)).resolves.toBeNull();
  });

  it("saves the blob under the name the caller chose", () => {
    const createObjectURL = vi.fn(() => "blob:card");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadSummaryImage(new Blob(["png"], { type: "image/png" }), "riverside-yatzy-result.png");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});

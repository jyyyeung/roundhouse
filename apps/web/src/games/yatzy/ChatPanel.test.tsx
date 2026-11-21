import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatPanel } from "./ChatPanel";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  messages: [],
  playerLabels: { "user-a": "You" },
  canSend: true,
  onSend: vi.fn(),
  draft: "",
  onDraftChange: vi.fn(),
  hasMoreChat: false,
  loadingOlderChat: false,
  onLoadOlderChat: vi.fn(),
};

describe("ChatPanel", () => {
  it("overlay renders backdrop and Close when open", () => {
    render(<ChatPanel {...baseProps} mode="overlay" />);
    expect(screen.getByRole("button", { name: /close chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("dock renders without backdrop or Close and stays visible", () => {
    render(<ChatPanel {...baseProps} mode="dock" open={false} />);
    expect(screen.getByText(/^chat$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /message/i })).toBeInTheDocument();
  });

  it("overlay renders nothing when closed", () => {
    const { container } = render(<ChatPanel {...baseProps} mode="overlay" open={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

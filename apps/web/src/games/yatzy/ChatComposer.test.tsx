import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./ChatComposer";

describe("ChatComposer", () => {
  it("sends trimmed text and does not send empty/whitespace", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onDraftChange = vi.fn();

    const { rerender } = render(
      <ChatComposer
        draft="  hello  "
        onDraftChange={onDraftChange}
        canSend
        onSend={onSend}
        variant="panel"
      />,
    );

    await user.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSend).toHaveBeenCalledWith("hello");

    onSend.mockClear();
    rerender(
      <ChatComposer
        draft="   "
        onDraftChange={onDraftChange}
        canSend
        onSend={onSend}
        variant="panel"
      />,
    );
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("uses a single-line textbox for float variant", () => {
    render(
      <ChatComposer draft="" onDraftChange={vi.fn()} canSend onSend={vi.fn()} variant="float" />,
    );
    const box = screen.getByRole("textbox", { name: /message/i });
    expect(box.tagName).toBe("INPUT");
  });
});

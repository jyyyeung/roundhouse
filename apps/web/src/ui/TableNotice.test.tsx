import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { type NoticeKind, noticeFor, noticeKindForCode, TableNotice } from "./TableNotice";

const KINDS: NoticeKind[] = ["full", "closed", "finished", "not-found", "kicked", "needs-verify"];

function renderNotice(kind: NoticeKind) {
  return render(
    <MemoryRouter>
      <TableNotice kind={kind} />
    </MemoryRouter>,
  );
}

describe("TableNotice", () => {
  it("gives every kind its own heading", () => {
    const headings = KINDS.map((kind) => {
      const { container, unmount } = renderNotice(kind);
      const heading = container.querySelector("h2")?.textContent ?? "";
      unmount();
      return heading;
    });

    expect(headings.every((heading) => heading.length > 0)).toBe(true);
    expect(new Set(headings).size).toBe(KINDS.length);
  });

  it("always offers one action", () => {
    for (const kind of KINDS) {
      const { unmount } = renderNotice(kind);
      expect(screen.getByRole("link", { name: noticeFor(kind).action.label })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute("data-notice-kind", kind);
      unmount();
    }
  });

  it("explains a full table in terms of what to do next", () => {
    renderNotice("full");
    expect(screen.getByRole("heading", { name: /this table is full/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to lobby/i })).toHaveAttribute("href", "/lobby");
  });
});

describe("noticeKindForCode", () => {
  it("maps the server codes that need their own copy", () => {
    expect(noticeKindForCode("table_full")).toBe("full");
    expect(noticeKindForCode("unknown_table")).toBe("not-found");
    expect(noticeKindForCode("table_missing")).toBe("not-found");
    expect(noticeKindForCode("table_not_found")).toBe("not-found");
    expect(noticeKindForCode("kicked")).toBe("kicked");
    expect(noticeKindForCode("seat_left")).toBe("closed");
    expect(noticeKindForCode("not_seated")).toBe("closed");
    expect(noticeKindForCode("needs_verify")).toBe("needs-verify");
    expect(noticeKindForCode("table_finished")).toBe("finished");
  });

  it("returns null for codes it cannot translate", () => {
    expect(noticeKindForCode(undefined)).toBeNull();
    expect(noticeKindForCode(null)).toBeNull();
    expect(noticeKindForCode("invalid_request")).toBeNull();
  });
});

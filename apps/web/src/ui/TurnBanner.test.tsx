import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { currentPlayerIdOf, TurnBanner } from "./TurnBanner";

const seats = ["user-a", "user-b"];

describe("TurnBanner", () => {
  it("tells a seated player it is their turn", () => {
    render(
      <TurnBanner
        currentUserId="user-a"
        seatUserIds={seats}
        state={{ currentPlayerId: "user-a" }}
      />,
    );

    expect(screen.getByTestId("turn-banner")).toHaveTextContent("Your turn");
  });

  it("names the player someone is waiting for", () => {
    render(
      <TurnBanner
        currentUserId="user-a"
        seatUserIds={seats}
        state={{ currentPlayerId: "user-b" }}
      />,
    );

    expect(screen.getByTestId("turn-banner")).toHaveTextContent("Waiting on Player 2");
  });

  it("renders nothing when the game has no current player", () => {
    const { container } = render(
      <TurnBanner currentUserId="user-a" seatUserIds={seats} state={{ currentPlayerId: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a state that does not publish a turn at all", () => {
    // Duel is simultaneous: no `currentPlayerId`, and the platform must not care.
    const { container } = render(
      <TurnBanner currentUserId="user-a" seatUserIds={seats} state={{ round: 1 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("currentPlayerIdOf", () => {
  it("reads a string field structurally and ignores everything else", () => {
    expect(currentPlayerIdOf({ currentPlayerId: "user-a" })).toBe("user-a");
    expect(currentPlayerIdOf({ currentPlayerId: "" })).toBeNull();
    expect(currentPlayerIdOf({ currentPlayerId: 7 })).toBeNull();
    expect(currentPlayerIdOf(null)).toBeNull();
    expect(currentPlayerIdOf("user-a")).toBeNull();
  });
});

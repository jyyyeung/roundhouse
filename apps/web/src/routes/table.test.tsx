import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ClientMessage, ServerMessage, TableMeta } from "@roundhouse/game-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TablePage } from "./table";
import { connectTableWs } from "../lib/ws";
import { getRecentTables, joinTable, startTable } from "../lib/tables";

vi.mock("../lib/ws", () => ({
  connectTableWs: vi.fn(),
}));

vi.mock("../lib/tables", async () => {
  const actual = await vi.importActual<typeof import("../lib/tables")>("../lib/tables");
  return {
    ...actual,
    getRecentTables: vi.fn(),
    joinTable: vi.fn(),
    startTable: vi.fn(),
    rematchTable: vi.fn(),
  };
});

const mockedConnectTableWs = vi.mocked(connectTableWs);
const mockedGetRecentTables = vi.mocked(getRecentTables);
const mockedJoinTable = vi.mocked(joinTable);
const mockedStartTable = vi.mocked(startTable);

type SessionLike = {
  user?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
} | null;

function renderTablePage(session: SessionLike, entry = "/t/table-123") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/t/:tableId" element={<TablePage session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function baseMeta(overrides?: Partial<TableMeta>): TableMeta {
  return {
    code: "ABCD23",
    gameId: "yatzy",
    config: { ruleset: "yatzy" },
    status: "lobby",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 4,
    ...overrides,
  };
}

function emptySheet() {
  return {
    ones: null,
    twos: null,
    threes: null,
    fours: null,
    fives: null,
    sixes: null,
    one_pair: null,
    two_pairs: null,
    three_kind: null,
    four_kind: null,
    small_straight: null,
    large_straight: null,
    full_house: null,
    chance: null,
    yatzy: null,
    bonus: null,
  };
}

function activeState(overrides: Record<string, unknown> = {}) {
  return {
    ruleset: "yatzy",
    playerIds: ["user-a", "user-b"],
    currentPlayerId: "user-a",
    rollsLeft: 3,
    dice: [1, 2, 3, 4, 5],
    holds: [false, false, false, false, false],
    sheets: { "user-a": emptySheet(), "user-b": emptySheet() },
    phase: "playing",
    winnerIds: [],
    ...overrides,
  };
}

describe("TablePage", () => {
  let onMessage: ((message: ServerMessage) => void) | undefined;
  const send = vi.fn((_frame: ClientMessage) => true);
  const close = vi.fn();
  const isOpen = vi.fn(() => true);
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessage = undefined;
    send.mockReset();
    send.mockReturnValue(true);
    close.mockReset();
    isOpen.mockReset();
    isOpen.mockReturnValue(true);
    mockedGetRecentTables.mockResolvedValue([]);
    mockedJoinTable.mockResolvedValue({ tableId: "table-123" });
    mockedStartTable.mockResolvedValue({ tableId: "table-123", gameRowId: "game-1" });
    mockedConnectTableWs.mockImplementation((opts) => {
      onMessage = opts.onMessage;
      return { send, close, isOpen };
    });
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: vi.fn(() => "action-123") },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
  });

  it("auto-joins invite links and shows lobby controls for the host", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } }, "/t/table-123?code=abcd23");

    await waitFor(() => {
      expect(mockedJoinTable).toHaveBeenCalledWith({ code: "ABCD23" });
      expect(mockedConnectTableWs).toHaveBeenCalled();
    });

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta(),
        state: null,
      });
    });

    expect(await screen.findByRole("button", { name: /start game/i })).toBeInTheDocument();
    expect(screen.getByText(/2\/4 seated/i)).toBeInTheDocument();
  });

  it("sends roll and start actions from the table controls", async () => {
    const user = userEvent.setup();
    renderTablePage({ user: { id: "user-a", name: "Alice" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state: {
          ruleset: "yatzy",
          playerIds: ["user-a", "user-b"],
          currentPlayerId: "user-a",
          rollsLeft: 3,
          dice: [1, 2, 3, 4, 5],
          holds: [false, false, false, false, false],
          sheets: {
            "user-a": {
              ones: null,
              twos: null,
              threes: null,
              fours: null,
              fives: null,
              sixes: null,
              one_pair: null,
              two_pairs: null,
              three_kind: null,
              four_kind: null,
              small_straight: null,
              large_straight: null,
              full_house: null,
              chance: null,
              yatzy: null,
              bonus: null,
            },
            "user-b": {
              ones: null,
              twos: null,
              threes: null,
              fours: null,
              fives: null,
              sixes: null,
              one_pair: null,
              two_pairs: null,
              three_kind: null,
              four_kind: null,
              small_straight: null,
              large_straight: null,
              full_house: null,
              chance: null,
              yatzy: null,
              bonus: null,
            },
          },
          phase: "playing",
          winnerIds: [],
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /roll dice/i }));

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 2,
        type: "intent",
        tableId: "table-123",
        actionId: "action-123",
        intentType: "roll",
      }),
    );
  });

  it("renders chat snapshots from realtime messages", async () => {
    const user = userEvent.setup();
    renderTablePage({ user: { id: "user-a", name: "Alice" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state: {
          ruleset: "yatzy",
          playerIds: ["user-a", "user-b"],
          currentPlayerId: "user-a",
          rollsLeft: 1,
          dice: [1, 2, 3, 4, 5],
          holds: [true, false, true, false, true],
          sheets: {
            "user-a": { ones: null, twos: null, threes: null, fours: null, fives: null, sixes: null, one_pair: null, two_pairs: null, three_kind: null, four_kind: null, small_straight: null, large_straight: null, full_house: null, chance: null, yatzy: null, bonus: null },
            "user-b": { ones: null, twos: null, threes: null, fours: null, fives: null, sixes: null, one_pair: null, two_pairs: null, three_kind: null, four_kind: null, small_straight: null, large_straight: null, full_house: null, chance: null, yatzy: null, bonus: null },
          },
          phase: "playing",
          winnerIds: [],
        },
      });
      onMessage?.({
        v: 2,
        type: "chat",
        tableId: "table-123",
        message: {
          id: "chat-1",
          userId: "user-b",
          text: "Nice roll",
          createdAt: "2026-08-02T08:00:00.000Z",
          snapshot: {
            tableId: "table-123",
            seq: 3,
            meta: baseMeta({ status: "active" }),
            state: {
              gameId: "yatzy",
              dice: [6, 6, 6, 4, 2],
              holds: [true, true, true, false, false],
              rollsLeft: 1,
              currentPlayerId: "user-b",
            },
          },
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /chat/i }));

    expect(await screen.findByText("Nice roll")).toBeInTheDocument();
    expect(screen.getByLabelText("Dice 6, 6, 6, 4, 2; held 1, 2, 3")).toBeInTheDocument();
    expect(screen.queryByText(/1 roll left/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Snapshot/i)).not.toBeInTheDocument();
  });

  it("reserves bottom space for the mobile floating composer during active games", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state: {
          ruleset: "yatzy",
          playerIds: ["user-a", "user-b"],
          currentPlayerId: "user-a",
          rollsLeft: 3,
          dice: [1, 2, 3, 4, 5],
          holds: [false, false, false, false, false],
          sheets: {
            "user-a": {
              ones: null,
              twos: null,
              threes: null,
              fours: null,
              fives: null,
              sixes: null,
              one_pair: null,
              two_pairs: null,
              three_kind: null,
              four_kind: null,
              small_straight: null,
              large_straight: null,
              full_house: null,
              chance: null,
              yatzy: null,
              bonus: null,
            },
            "user-b": {
              ones: null,
              twos: null,
              threes: null,
              fours: null,
              fives: null,
              sixes: null,
              one_pair: null,
              two_pairs: null,
              three_kind: null,
              four_kind: null,
              small_straight: null,
              large_straight: null,
              full_house: null,
              chance: null,
              yatzy: null,
              bonus: null,
            },
          },
          phase: "playing",
          winnerIds: [],
        },
      });
    });

    expect(await screen.findByTestId("table-active-shell")).toHaveClass("pb-24", "md:pb-0");
  });

  it("does not open websocket when invite join fails", async () => {
    mockedJoinTable.mockRejectedValue(new Error("unknown_table"));

    renderTablePage({ user: { id: "user-a", name: "Alice" } }, "/t/table-123?code=abcd23");

    await waitFor(() => expect(mockedJoinTable).toHaveBeenCalledWith({ code: "ABCD23" }));
    await waitFor(() => expect(mockedConnectTableWs).not.toHaveBeenCalled());
    expect(await screen.findByText("unknown_table")).toBeInTheDocument();
  });

  it("opens websocket after a harmless join failure when the user is already seated", async () => {
    mockedJoinTable.mockRejectedValue(new Error("table_closed"));
    mockedGetRecentTables.mockResolvedValue([
      {
        id: "table-123",
        code: "ABCD23",
        gameId: "yatzy",
        config: { ruleset: "yatzy" },
        status: "active",
        hostUserId: "user-a",
        softSeatCap: 4,
        createdAt: "2026-08-02T08:00:00.000Z",
        seatUserIds: ["user-a", "user-b"],
      },
    ]);

    renderTablePage({ user: { id: "user-a", name: "Alice" } }, "/t/table-123?code=abcd23");

    await waitFor(() => expect(mockedJoinTable).toHaveBeenCalledWith({ code: "ABCD23" }));
    await waitFor(() => expect(mockedGetRecentTables).toHaveBeenCalled());
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
  });

  it("applies an applied frame without ever re-subscribing", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state: activeState(),
      });
    });
    send.mockClear();

    act(() => {
      onMessage?.({
        v: 2,
        type: "applied",
        tableId: "table-123",
        seq: 1,
        meta: baseMeta({ status: "active" }),
        state: activeState({ dice: [6, 6, 1, 2, 3], rollsLeft: 2 }),
        events: [
          {
            id: "event-1",
            tableId: "table-123",
            gameId: "game-1",
            seq: 1,
            type: "dice_rolled",
            actorId: "user-a",
            payload: {},
            createdAt: "2026-08-02T08:00:00.000Z",
          },
        ],
      });
    });

    expect(send.mock.calls.map(([frame]) => frame.type)).toEqual([]);
    expect(await screen.findByText(/2 rolls left/i)).toBeInTheDocument();
  });

  it("asks for the missing range instead of rendering a state it cannot place", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 1,
        meta: baseMeta({ status: "active" }),
        state: activeState(),
      });
    });
    send.mockClear();

    act(() => {
      onMessage?.({
        v: 2,
        type: "applied",
        tableId: "table-123",
        seq: 4,
        meta: baseMeta({ status: "active" }),
        state: activeState({ dice: [6, 6, 6, 6, 6] }),
        events: [],
      });
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ v: 2, type: "sync", tableId: "table-123", sinceSeq: 1 }),
    );
    expect(screen.queryByText(/roll dice/i)).toBeInTheDocument();

    act(() => {
      onMessage?.({
        v: 2,
        type: "events",
        tableId: "table-123",
        fromSeq: 1,
        toSeq: 4,
        meta: baseMeta({ status: "active" }),
        state: activeState({ dice: [6, 5, 4, 3, 2] }),
        events: [],
      });
    });

    expect(await screen.findByText(/2 rolls left|3 rolls left/i)).toBeInTheDocument();
  });

  it("pulls one bounded chat page per snapshot and pages older history on demand", async () => {
    const user = userEvent.setup();
    renderTablePage({ user: { id: "user-a", name: "Alice" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state: activeState(),
      });
    });

    expect(send.mock.calls.map(([frame]) => frame.type)).toEqual(["chatPage"]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ v: 2, type: "chatPage", tableId: "table-123" }),
    );

    act(() => {
      onMessage?.({
        v: 2,
        type: "chatPage",
        tableId: "table-123",
        hasMore: true,
        messages: [
          {
            id: "chat-2",
            userId: "user-b",
            text: "Second message",
            createdAt: "2026-08-02T08:01:00.000Z",
            snapshot: null,
          },
          {
            id: "chat-3",
            userId: "user-a",
            text: "Third message",
            createdAt: "2026-08-02T08:02:00.000Z",
            snapshot: null,
          },
        ],
      });
    });

    await user.click(screen.getByRole("button", { name: /chat/i }));
    await user.click(await screen.findByRole("button", { name: /load earlier messages/i }));

    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ v: 2, type: "chatPage", tableId: "table-123", beforeId: "chat-2" }),
    );

    act(() => {
      onMessage?.({
        v: 2,
        type: "chatPage",
        tableId: "table-123",
        hasMore: false,
        messages: [
          {
            id: "chat-1",
            userId: "user-b",
            text: "First message",
            createdAt: "2026-08-02T08:00:00.000Z",
            snapshot: null,
          },
        ],
      });
    });

    expect(await screen.findByText("First message")).toBeInTheDocument();
    expect(screen.getByText("Third message")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /load earlier messages/i })).not.toBeInTheDocument(),
    );
  });
});

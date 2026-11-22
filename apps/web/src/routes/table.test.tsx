import type { ClientMessage, ServerMessage, TableMeta } from "@roundhouse/game-core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRecentTables, joinTable, kickFromTable, leaveTable, startTable } from "../lib/tables";
import { connectTableWs } from "../lib/ws";
import { TablePage } from "./table";

vi.mock("../lib/ws", () => ({
  connectTableWs: vi.fn(),
}));

vi.mock("../lib/tables", async () => {
  const actual = await vi.importActual<typeof import("../lib/tables")>("../lib/tables");
  return {
    ...actual,
    getRecentTables: vi.fn(),
    joinTable: vi.fn(),
    kickFromTable: vi.fn(),
    leaveTable: vi.fn(),
    startTable: vi.fn(),
    rematchTable: vi.fn(),
  };
});

const mockedConnectTableWs = vi.mocked(connectTableWs);
const mockedGetRecentTables = vi.mocked(getRecentTables);
const mockedJoinTable = vi.mocked(joinTable);
const mockedStartTable = vi.mocked(startTable);
const mockedLeaveTable = vi.mocked(leaveTable);
const mockedKickFromTable = vi.mocked(kickFromTable);

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
    spectatorsAllowed: false,
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
    mockedLeaveTable.mockResolvedValue({
      tableId: "table-123",
      removed: true,
      seatsRemaining: 1,
      tableDeleted: false,
      hostUserId: "user-a",
    });
    mockedKickFromTable.mockResolvedValue({
      tableId: "table-123",
      removed: true,
      seatsRemaining: 1,
      tableDeleted: false,
      hostUserId: "user-a",
    });
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

  it("renders a watcher's board with a watching badge and no way to leave", async () => {
    renderTablePage({ user: { id: "user-watch", name: "Watcher" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 1,
        meta: baseMeta({ status: "active", spectatorsAllowed: true }),
        // The spectator projection: the board, with no seat of its own.
        state: activeState({ you: null }),
      });
    });

    expect(await screen.findByTestId("watching-badge")).toHaveTextContent(/watching/i);
    expect(screen.getByTestId("turn-banner")).toHaveTextContent(/waiting on player 1/i);
    // A watcher holds no seat, so there is nothing to give up.
    expect(screen.queryByRole("button", { name: /leave table/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /start game/i })).toBeNull();
  });

  it("counts the room when more than one person is watching", async () => {
    renderTablePage({ user: { id: "user-watch", name: "Watcher" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());

    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 1,
        meta: baseMeta({ status: "active", spectatorsAllowed: true }),
        state: activeState({ you: null }),
      });
      onMessage?.({
        tableId: "table-123",
        type: "presence",
        onlineUserIds: ["user-a"],
        spectatorUserIds: ["user-watch", "user-other"],
        v: 2,
      });
    });

    expect(await screen.findByTestId("watching-badge")).toHaveTextContent(/2 watching/i);
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
        spectators: false,
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
      expect(
        screen.queryByRole("button", { name: /load earlier messages/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("lets the host kick another seat after an explicit confirmation", async () => {
    const user = userEvent.setup();
    renderTablePage({ user: { id: "user-a", name: "Alice" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
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
    send.mockClear();

    expect(screen.getAllByRole("button", { name: "Kick" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Kick" }));
    expect(mockedKickFromTable).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm kick/i }));

    expect(mockedKickFromTable).toHaveBeenCalledWith({ tableId: "table-123", userId: "user-b" });
    // The seat list comes back from the server, so the page re-reads it.
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "subscribe", tableId: "table-123" }),
    );
  });

  it("offers no kick control to a player who is not the host", async () => {
    renderTablePage({ user: { id: "user-b", name: "Bob" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
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

    expect(screen.getByText(/2\/4 seated/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kick" })).not.toBeInTheDocument();
  });

  it("leaves the table and returns to the lobby", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/t/table-123"]}>
        <Routes>
          <Route path="/t/:tableId" element={<TablePage session={{ user: { id: "user-a" } }} />} />
          <Route path="/lobby" element={<p>the lobby screen</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
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

    await user.click(screen.getByRole("button", { name: /leave table/i }));
    expect(mockedLeaveTable).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /confirm leave/i }));

    expect(mockedLeaveTable).toHaveBeenCalledWith({ tableId: "table-123" });
    expect(await screen.findByText("the lobby screen")).toBeInTheDocument();
  });

  it("does not let a player leave while the game is running", async () => {
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

    expect(screen.getByRole("button", { name: /leave table/i })).toBeDisabled();
  });

  it("stops reconnecting once the host removes this player", async () => {
    renderTablePage({ user: { id: "user-b", name: "Bob" } });

    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalledTimes(1));
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

    act(() => {
      onMessage?.({
        v: 2,
        type: "error",
        code: "kicked",
        message: "kicked",
        tableId: "table-123",
      });
    });

    expect(await screen.findByText(/the host removed you/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to lobby/i })).toBeInTheDocument();
    // A removed seat has nothing to reconnect to; the server would refuse it.
    expect(mockedConnectTableWs).toHaveBeenCalledTimes(1);
  });
});

describe("TablePage failure notices", () => {
  let onMessage: ((message: ServerMessage) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessage = undefined;
    mockedGetRecentTables.mockResolvedValue([]);
    mockedConnectTableWs.mockImplementation((opts) => {
      onMessage = opts.onMessage;
      return { send: vi.fn(() => true), close: vi.fn(), isOpen: vi.fn(() => true) };
    });
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: vi.fn(() => "action-123") },
      configurable: true,
    });
  });

  async function openTable() {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
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
  }

  it("explains a full table instead of showing the server's code", async () => {
    await openTable();

    act(() => {
      onMessage?.({
        v: 2,
        type: "error",
        code: "table_full",
        message: "table_full",
        tableId: "table-123",
      });
    });

    expect(await screen.findByText(/this table is full/i)).toBeInTheDocument();
    expect(screen.queryByText(/^table_full$/)).not.toBeInTheDocument();
  });

  it("asks for an email confirmation when the server requires one", async () => {
    await openTable();

    act(() => {
      onMessage?.({
        v: 2,
        type: "error",
        code: "needs_verify",
        message: "needs_verify",
        tableId: "table-123",
      });
    });

    expect(await screen.findByText(/confirm your email to play/i)).toBeInTheDocument();
  });

  it("keeps the server's own words for a code it cannot translate", async () => {
    await openTable();

    act(() => {
      onMessage?.({
        v: 2,
        type: "error",
        code: "invalid_request",
        message: "Holds must be five booleans",
        tableId: "table-123",
      });
    });

    expect(await screen.findByText(/holds must be five booleans/i)).toBeInTheDocument();
  });

  it("announces a finished game and still offers a rematch", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "finished" }),
        state: activeState({ phase: "finished", winnerIds: ["user-a"] }),
      });
    });

    expect(await screen.findByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rematch/i })).toBeInTheDocument();
  });
});

describe("TablePage seat labels", () => {
  let onMessage: ((message: ServerMessage) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessage = undefined;
    mockedGetRecentTables.mockResolvedValue([]);
    mockedConnectTableWs.mockImplementation((opts) => {
      onMessage = opts.onMessage;
      return { send: vi.fn(() => true), close: vi.fn(), isOpen: vi.fn(() => true) };
    });
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: vi.fn(() => "action-123") },
      configurable: true,
    });
  });

  it("labels the lobby seats with the same rule every game view uses", async () => {
    renderTablePage({ user: { id: "user-b", name: "Bob" } });
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
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

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByText("Player 1")).toBeInTheDocument();
    // Avatars are generated from the id, so both seats carry initials.
    expect(screen.getAllByText("US")).toHaveLength(2);
  });
});

describe("TablePage turn clarity and sound", () => {
  let onMessage: ((message: ServerMessage) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessage = undefined;
    mockedGetRecentTables.mockResolvedValue([]);
    mockedConnectTableWs.mockImplementation((opts) => {
      onMessage = opts.onMessage;
      return { send: vi.fn(() => true), close: vi.fn(), isOpen: vi.fn(() => true) };
    });
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: vi.fn(() => "action-123") },
      configurable: true,
    });
  });

  function snapshotWith(state: ReturnType<typeof activeState> | null) {
    act(() => {
      onMessage?.({
        v: 2,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state,
      });
    });
  }

  it("says whose turn it is from the projected state", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
    snapshotWith(activeState());

    expect(await screen.findByTestId("turn-banner")).toHaveTextContent("Your turn");
  });

  it("names the player everyone is waiting on", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
    snapshotWith(activeState({ currentPlayerId: "user-b" }));

    expect(await screen.findByTestId("turn-banner")).toHaveTextContent("Waiting on Player 2");
  });

  it("shows no turn banner for a game with no current player", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
    snapshotWith(activeState({ currentPlayerId: undefined }));

    expect(await screen.findByTestId("table-active-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("turn-banner")).not.toBeInTheDocument();
  });

  it("puts a labelled sound switch in the table header", async () => {
    renderTablePage({ user: { id: "user-a", name: "Alice" } });
    await waitFor(() => expect(mockedConnectTableWs).toHaveBeenCalled());
    snapshotWith(activeState());

    const toggle = await screen.findByRole("button", { name: /turn sound on/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});

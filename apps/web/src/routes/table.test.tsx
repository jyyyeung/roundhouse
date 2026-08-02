import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ServerMessage, TableMeta } from "@yatzy/game-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TablePage } from "./table";
import { connectTableWs } from "../lib/ws";
import { joinTable, startTable } from "../lib/tables";

vi.mock("../lib/ws", () => ({
  connectTableWs: vi.fn(),
}));

vi.mock("../lib/tables", async () => {
  const actual = await vi.importActual<typeof import("../lib/tables")>("../lib/tables");
  return {
    ...actual,
    joinTable: vi.fn(),
    startTable: vi.fn(),
    rematchTable: vi.fn(),
  };
});

const mockedConnectTableWs = vi.mocked(connectTableWs);
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

describe("TablePage", () => {
  let onMessage: ((message: ServerMessage) => void) | undefined;
  const send = vi.fn();
  const close = vi.fn();
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessage = undefined;
    send.mockReset();
    close.mockReset();
    mockedJoinTable.mockResolvedValue({ tableId: "table-123" });
    mockedStartTable.mockResolvedValue({ tableId: "table-123", gameRowId: "game-1" });
    mockedConnectTableWs.mockImplementation((opts) => {
      onMessage = opts.onMessage;
      return { send, close };
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
        v: 1,
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
        v: 1,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state: {
          ruleset: "yatzy",
          playerIds: ["user-a", "user-b"],
          currentPlayerIndex: 0,
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
        v: 1,
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
        v: 1,
        type: "snapshot",
        tableId: "table-123",
        seq: 0,
        meta: baseMeta({ status: "active" }),
        state: {
          ruleset: "yatzy",
          playerIds: ["user-a", "user-b"],
          currentPlayerIndex: 0,
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
        v: 1,
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
    expect(screen.getByText(/66642/i)).toBeInTheDocument();
    expect(screen.getByText(/1 roll left/i)).toBeInTheDocument();
  });
});

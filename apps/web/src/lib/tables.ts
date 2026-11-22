import type { GameCatalogueEntry, Json, TableReplay } from "@roundhouse/game-core";

export type RecentTable = {
  id: string;
  code: string;
  gameId: string;
  config: Json;
  status: "lobby" | "active" | "finished";
  hostUserId: string;
  softSeatCap: number;
  /** The host opened this table to watchers (M2-1, #56). */
  spectators: boolean;
  createdAt: string;
  seatUserIds: string[];
};

export function normalizeJoinCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function buildShareUrl(input: { webBaseUrl: string; tableId: string; code: string }) {
  const base = input.webBaseUrl.replace(/\/$/, "");
  const url = new URL(`/t/${input.tableId}`, `${base}/`);
  url.searchParams.set("code", input.code);
  return url.toString();
}

/**
 * A failed API call, with the server's own code kept intact.
 *
 * The message is what a person reads; the code is what a page branches on when
 * it wants to show a specific notice instead of a raw sentence.
 */
export class ApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function readApiError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    code?: string;
  } | null;
  return new ApiError(
    body?.message ?? body?.code ?? `Request failed with ${response.status}`,
    body?.code ?? null,
    response.status,
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw await readApiError(response);
  }

  return response.json() as Promise<T>;
}

export function getRecentTables() {
  return fetchJson<RecentTable[]>("/api/tables/mine");
}

/** The games this server hosts, as declared by its module registry. */
export async function getGameCatalogue() {
  const body = await fetchJson<{ games: GameCatalogueEntry[] }>("/api/games");
  return body.games;
}

export function createTable(input: {
  gameId: string;
  config: Json;
  softSeatCap?: number;
  /** Open the table to watchers (M2-1, #56). Off unless the host asks. */
  spectators?: boolean;
}) {
  return fetchJson<{ tableId: string; code: string }>("/api/tables", {
    method: "POST",
    body: JSON.stringify({
      gameId: input.gameId,
      config: input.config,
      softSeatCap: input.softSeatCap,
      spectators: input.spectators,
    }),
  });
}

export function joinTable(input: { code: string }) {
  return fetchJson<{ tableId: string }>("/api/tables/join", {
    method: "POST",
    body: JSON.stringify({ code: normalizeJoinCode(input.code) }),
  });
}

export function startTable(input: { tableId: string }) {
  return fetchJson<{ tableId: string; gameRowId: string }>(`/api/tables/${input.tableId}/start`, {
    method: "POST",
  });
}

export function rematchTable(input: { tableId: string }) {
  return fetchJson<{ tableId: string; gameRowId: string }>(`/api/tables/${input.tableId}/rematch`, {
    method: "POST",
  });
}

export type SeatChange = {
  tableId: string;
  removed: boolean;
  seatsRemaining: number;
  tableDeleted: boolean;
  hostUserId: string | null;
};

export function leaveTable(input: { tableId: string }) {
  return fetchJson<SeatChange>(`/api/tables/${input.tableId}/leave`, { method: "POST" });
}

export function kickFromTable(input: { tableId: string; userId: string }) {
  return fetchJson<SeatChange>(`/api/tables/${input.tableId}/kick`, {
    method: "POST",
    body: JSON.stringify({ userId: input.userId }),
  });
}

/**
 * A finished game's log, already folded and projected by the server (ADR 0009).
 * The client never receives the events: for a hidden-information game the
 * payloads are exactly what projection exists to withhold.
 */
export function getTableReplay(tableId: string) {
  return fetchJson<TableReplay>(`/api/tables/${tableId}/replay`);
}

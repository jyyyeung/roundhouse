import type { GameCatalogueEntry, Json } from "@roundhouse/game-core";

export type RecentTable = {
  id: string;
  code: string;
  gameId: string;
  config: Json;
  status: "lobby" | "active" | "finished";
  hostUserId: string;
  softSeatCap: number;
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

async function readApiError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    code?: string;
  } | null;
  return body?.message ?? body?.code ?? `Request failed with ${response.status}`;
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
    throw new Error(await readApiError(response));
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

export function createTable(input: { gameId: string; config: Json; softSeatCap?: number }) {
  return fetchJson<{ tableId: string; code: string }>("/api/tables", {
    method: "POST",
    body: JSON.stringify({
      gameId: input.gameId,
      config: input.config,
      softSeatCap: input.softSeatCap,
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

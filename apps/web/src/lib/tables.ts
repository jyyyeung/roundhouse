export type Ruleset = "yatzy" | "yahtzee";

export type RecentTable = {
  id: string;
  code: string;
  gameId: string;
  config: { ruleset?: Ruleset } | null;
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
  const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null;
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

export function createTable(input: { ruleset: Ruleset; softSeatCap?: number }) {
  return fetchJson<{ tableId: string; code: string }>("/api/tables", {
    method: "POST",
    body: JSON.stringify({
      gameId: "yatzy",
      config: { ruleset: input.ruleset },
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

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, Json, ServerMessage, TableMeta } from "@yatzy/game-core";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { renderGameView } from "../games/registry";
import type { TableChatMessage } from "../games/yatzy/model";
import { getRecentTables, rematchTable, joinTable, normalizeJoinCode, startTable } from "../lib/tables";
import { connectTableWs, type TableWsConnection } from "../lib/ws";

type SessionLike = {
  user?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
} | null;

function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Something went sideways. Try again.";
}

async function isUserSeated(tableId: string, userId: string) {
  const tables = await getRecentTables();
  return tables.some((table) => table.id === tableId && table.seatUserIds.includes(userId));
}

function normalizeChatMessage(message: ServerMessage) {
  const payload = "message" in message ? message.message : (message as { chat?: unknown }).chat;
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload as Partial<TableChatMessage>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.userId !== "string" ||
    typeof candidate.text !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    userId: candidate.userId,
    text: candidate.text,
    createdAt: candidate.createdAt,
    snapshot: candidate.snapshot ?? null,
  } satisfies TableChatMessage;
}

function readDice(value: unknown) {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "number")) return null;
  return [...value];
}

export function TablePage({ session }: { session: SessionLike }) {
  const { tableId = "unknown-table" } = useParams();
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
  const currentUserId = session?.user?.id ?? null;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const connectionRef = useRef<TableWsConnection | null>(null);
  const hasSnapshotRef = useRef(false);
  const previousDiceRef = useRef<number[] | null>(null);
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [state, setState] = useState<unknown>(null);
  const [messages, setMessages] = useState<TableChatMessage[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"start" | "rematch" | null>(null);
  const [rollVersion, setRollVersion] = useState(0);

  const rulesetLabel = useMemo(() => {
    return meta?.config && typeof meta.config === "object" && "ruleset" in meta.config && meta.config.ruleset === "yahtzee"
      ? "Yahtzee"
      : "Yatzy";
  }, [meta?.config]);

  function sendOrFlag(message: ClientMessage) {
    const ok = connectionRef.current?.send(message) ?? false;
    if (!ok) setError("Connection lost — reconnecting…");
    return ok;
  }

  function refreshSnapshot() {
    sendOrFlag({
      v: 1,
      type: "subscribe",
      tableId,
    });
  }

  function sendIntent(intentType: string, payload: Json) {
    sendOrFlag({
      v: 1,
      type: "intent",
      tableId,
      actionId: crypto.randomUUID(),
      intentType,
      payload,
    });
  }

  function sendChat(text: string) {
    sendOrFlag({
      v: 1,
      type: "chat",
      tableId,
      actionId: crypto.randomUUID(),
      text,
      payload: { text },
    } as ClientMessage);
  }

  useEffect(() => {
    let alive = true;
    let connection: TableWsConnection | null = null;
    let reconnectTimer: number | null = null;
    let snapshotWatchTimer: number | null = null;
    let attempt = 0;
    let joined = false;
    hasSnapshotRef.current = false;

    setLoading(true);
    setError(null);

    async function ensureJoined() {
      if (joined || !code) {
        joined = true;
        return true;
      }
      try {
        await joinTable({ code: normalizeJoinCode(code) });
        joined = true;
        return true;
      } catch (caughtError) {
        const message = getErrorMessage(caughtError);
        const userId = currentUserIdRef.current;
        const seated = userId ? await isUserSeated(tableId, userId) : false;
        if (seated) {
          joined = true;
          return true;
        }
        setLoading(false);
        setError(message);
        return false;
      }
    }

    function scheduleReconnect(reason: string) {
      if (!alive) return;
      if (reason === "not_authenticated") {
        setLoading(false);
        setError("Session expired — sign in again, then reopen the table.");
        return;
      }

      if (!hasSnapshotRef.current) {
        setLoading(true);
      }
      setError(hasSnapshotRef.current ? "Connection lost — reconnecting…" : `Could not connect (${reason}). Retrying…`);

      const delay = Math.min(8_000, 400 * 2 ** attempt);
      attempt += 1;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        if (!alive) return;
        void connect();
      }, delay);
    }

    function clearSnapshotWatch() {
      if (snapshotWatchTimer !== null) {
        window.clearTimeout(snapshotWatchTimer);
        snapshotWatchTimer = null;
      }
    }

    function attachSocket() {
      if (!alive) return;

      connection?.close();
      clearSnapshotWatch();
      let gotSnapshot = false;
      connection = connectTableWs({
        apiUrl,
        tableId,
        onMessage(message) {
          if (!alive) return;

          if (message.type === "snapshot") {
            gotSnapshot = true;
            clearSnapshotWatch();
            const nextDice =
              message.state && typeof message.state === "object" && "dice" in message.state
                ? readDice(message.state.dice)
                : null;

            if (
              nextDice &&
              previousDiceRef.current &&
              nextDice.length === previousDiceRef.current.length &&
              nextDice.some((value, index) => value !== previousDiceRef.current?.[index])
            ) {
              setRollVersion((version) => version + 1);
            }

            previousDiceRef.current = nextDice ? [...nextDice] : null;
            hasSnapshotRef.current = true;
            setMeta(message.meta);
            setState(message.state);
            setLoading(false);
            setError(null);
            attempt = 0;
            return;
          }

          if (message.type === "presence") {
            setOnlineUserIds(message.onlineUserIds);
            return;
          }

          if (message.type === "chat") {
            const chat = normalizeChatMessage(message);
            if (!chat) return;
            setMessages((current) => {
              if (current.some((item) => item.id === chat.id)) return current;
              return [...current, chat];
            });
            return;
          }

          if (message.type === "event") {
            connectionRef.current?.send({
              v: 1,
              type: "subscribe",
              tableId,
            });
            return;
          }

          if (message.type === "error") {
            clearSnapshotWatch();
            setLoading(false);
            setError(message.message);
          }
        },
        onConnectionLost(reason) {
          if (!alive) return;
          clearSnapshotWatch();
          if (connectionRef.current === connection) {
            connectionRef.current = null;
          }
          scheduleReconnect(reason);
        },
      });

      connectionRef.current = connection;

      // Open-but-silent sockets (dropped subscribe) never fire onclose — force retry.
      snapshotWatchTimer = window.setTimeout(() => {
        if (!alive || gotSnapshot || hasSnapshotRef.current) return;
        if (connectionRef.current !== connection) return;
        connection?.close();
        connectionRef.current = null;
        scheduleReconnect("snapshot_timeout");
      }, 4_000);
    }

    async function connect() {
      if (!alive) return;
      try {
        const ok = await ensureJoined();
        if (!alive || !ok) return;
        attachSocket();
      } catch (caughtError) {
        if (!alive) return;
        setLoading(false);
        setError(getErrorMessage(caughtError));
      }
    }

    void connect();

    return () => {
      alive = false;
      clearSnapshotWatch();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      connection?.close();
      if (connectionRef.current === connection) {
        connectionRef.current = null;
      }
    };
  }, [apiUrl, code, tableId]);

  async function handleStart() {
    setBusyAction("start");
    setError(null);
    try {
      await startTable({ tableId });
      refreshSnapshot();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRematch() {
    setBusyAction("rematch");
    setError(null);
    try {
      await rematchTable({ tableId });
      refreshSnapshot();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
        <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 text-center shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">Connecting</p>
          <h1 className="mt-3 font-display text-4xl text-[var(--color-ink)]">Loading table magic...</h1>
        </section>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
        <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">Table unavailable</p>
          <h1 className="mt-3 font-display text-4xl text-[var(--color-ink)]">{tableId}</h1>
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          <Link className="mt-5 inline-flex rounded-2xl bg-[var(--color-teal)] px-4 py-3 font-semibold text-[var(--color-ink)]" to="/lobby">
            Back to lobby
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">Table {meta.code}</p>
          <h1 className="mt-2 font-display text-4xl text-[var(--color-ink)]">{rulesetLabel}</h1>
        </div>
        <Link className="rounded-2xl bg-white/80 px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm" to="/lobby">
          Back to lobby
        </Link>
      </header>

      {meta.status === "lobby" ? (
        <section className="mt-5 rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">Waiting room</p>
          <h2 className="mt-3 font-display text-3xl text-[var(--color-ink)]">{meta.seatUserIds.length}/{meta.softSeatCap} seated</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {meta.seatUserIds.map((playerId, index) => (
              <article key={playerId} className="rounded-3xl bg-[var(--color-cream)] px-4 py-4">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-coral)]">Seat {index + 1}</p>
                <p className="mt-2 font-semibold text-[var(--color-ink)]">
                  {playerId === currentUserId ? session?.user?.name || "You" : `Player ${index + 1}`}
                </p>
                <p className="mt-1 text-sm text-slate-500">{playerId === meta.hostUserId ? "Host" : "Ready"}</p>
              </article>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {currentUserId === meta.hostUserId ? (
              <button
                type="button"
                className="rounded-2xl bg-[var(--color-ink)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleStart}
                disabled={busyAction === "start" || meta.seatUserIds.length < 2}
              >
                {busyAction === "start" ? "Starting..." : "Start game"}
              </button>
            ) : (
              <p className="rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-600">Waiting for the host to start.</p>
            )}
          </div>
          {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
        </section>
      ) : (
        <>
          <div className="mt-5">
            {renderGameView({
              meta,
              state,
              currentUserId,
              onlineUserIds,
              messages,
              onIntent: sendIntent,
              onSendChat: sendChat,
              rollVersion,
            })}
          </div>

          {meta.status === "finished" ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white"
                onClick={handleRematch}
                disabled={busyAction === "rematch"}
              >
                {busyAction === "rematch" ? "Shuffling..." : "Rematch"}
              </button>
            </div>
          ) : null}

          {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
        </>
      )}
    </div>
  );
}

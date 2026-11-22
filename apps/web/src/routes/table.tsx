import type { ClientMessage, Json, TableMeta } from "@roundhouse/game-core";
import { PROTOCOL_VERSION } from "@roundhouse/game-core";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { renderGameView, tableTitleFor } from "../games/registry";
import type { TableChatMessage } from "../lib/chat";
import {
  getRecentTables,
  joinTable,
  kickFromTable,
  leaveTable,
  normalizeJoinCode,
  rematchTable,
  startTable,
} from "../lib/tables";
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
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Something went sideways. Try again.";
}

async function isUserSeated(tableId: string, userId: string) {
  const tables = await getRecentTables();
  return tables.some((table) => table.id === tableId && table.seatUserIds.includes(userId));
}

function normalizeChatMessage(payload: unknown): TableChatMessage | null {
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

function normalizeChatWire(payload: unknown) {
  const chat = normalizeChatMessage(payload);
  return chat ? [chat] : [];
}

/**
 * Chat arrives from three places (broadcast, a page of history, an older page),
 * so every insert goes through one merge: newest state per id, oldest first.
 */
function mergeChat(current: TableChatMessage[], incoming: TableChatMessage[]) {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => {
    if (left.createdAt === right.createdAt) return left.id.localeCompare(right.id);
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function TablePage({ session }: { session: SessionLike }) {
  const { tableId = "unknown-table" } = useParams();
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
  const currentUserId = session?.user?.id ?? null;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const connectionRef = useRef<TableWsConnection | null>(null);
  const hasSnapshotRef = useRef(false);
  // The last seq this view is known to be correct for. Every server frame carries
  // one, so this is the only progress signal the client needs.
  const lastSeqRef = useRef(0);
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [state, setState] = useState<unknown>(null);
  const [messages, setMessages] = useState<TableChatMessage[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"start" | "rematch" | "leave" | "kick" | null>(null);
  const [hasMoreChat, setHasMoreChat] = useState(false);
  const [loadingOlderChat, setLoadingOlderChat] = useState(false);
  // Two-step confirmations: removing a seat cannot be undone by a reload.
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  // Set when the server took this seat away; the page stops trying to reconnect.
  const [evicted, setEvicted] = useState<"kicked" | "left" | null>(null);
  const evictedRef = useRef<"kicked" | "left" | null>(null);

  function sendOrFlag(message: ClientMessage) {
    const ok = connectionRef.current?.send(message) ?? false;
    if (!ok) setError("Connection lost — reconnecting…");
    return ok;
  }

  function refreshSnapshot() {
    sendOrFlag({
      v: PROTOCOL_VERSION,
      type: "subscribe",
      tableId,
    });
  }

  function sendIntent(intentType: string, payload: Json) {
    sendOrFlag({
      v: PROTOCOL_VERSION,
      type: "intent",
      tableId,
      actionId: crypto.randomUUID(),
      intentType,
      payload,
    });
  }

  function sendChat(text: string) {
    sendOrFlag({
      v: PROTOCOL_VERSION,
      type: "chat",
      tableId,
      actionId: crypto.randomUUID(),
      text,
    } satisfies ClientMessage);
  }

  /** One bounded page of history. `beforeId` asks for the page older than it. */
  function requestChatPage(beforeId?: string) {
    return sendOrFlag({
      v: PROTOCOL_VERSION,
      type: "chatPage",
      tableId,
      ...(beforeId === undefined ? {} : { beforeId }),
    } satisfies ClientMessage);
  }

  function loadOlderChat() {
    const oldest = messages[0];
    if (!oldest || loadingOlderChat) return;
    setLoadingOlderChat(true);
    if (!requestChatPage(oldest.id)) setLoadingOlderChat(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: one connection per table; every dependency is a ref or handled inside the effect
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
      // A seat that left or was removed has nothing to reconnect to: the server
      // would refuse the subscribe with `not_seated`.
      if (evictedRef.current) return;
      if (reason === "not_authenticated") {
        setLoading(false);
        setError("Session expired — sign in again, then reopen the table.");
        return;
      }

      if (!hasSnapshotRef.current) {
        setLoading(true);
      }
      setError(
        hasSnapshotRef.current
          ? "Connection lost — reconnecting…"
          : `Could not connect (${reason}). Retrying…`,
      );

      // A restart (1012) is a planned goodbye: reconnect at once, and reset the
      // backoff so a later real failure starts from a short delay.
      const delay = reason === "server_restart" ? 0 : Math.min(8_000, 400 * 2 ** attempt);
      attempt = reason === "server_restart" ? 0 : attempt + 1;
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

    /**
     * The one place a game state from the server becomes view state. Every frame
     * that carries state (snapshot, applied, events) lands here, so the local view
     * is always a function of the last seq the server sent.
     */
    function applyServerState(next: { meta: TableMeta; state: unknown; seq: number }) {
      lastSeqRef.current = next.seq;
      hasSnapshotRef.current = true;
      setMeta(next.meta);
      setState(next.state);
      setLoading(false);
      setError(null);
      attempt = 0;
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
            applyServerState(message);
            // Chat is not part of a snapshot any more: one bounded page is pulled
            // here, and older pages only when the reader asks for them.
            requestChatPage();
            return;
          }

          if (message.type === "applied") {
            const lastSeq = lastSeqRef.current;
            if (message.seq <= lastSeq) return;
            if (message.seq > lastSeq + 1) {
              // A frame went missing between the server and here. Ask for the gap
              // instead of rendering state whose history we never saw.
              connectionRef.current?.send({
                v: PROTOCOL_VERSION,
                type: "sync",
                tableId,
                sinceSeq: lastSeq,
              } satisfies ClientMessage);
              return;
            }
            applyServerState(message);
            return;
          }

          if (message.type === "events") {
            applyServerState({ meta: message.meta, seq: message.toSeq, state: message.state });
            return;
          }

          if (message.type === "chatPage") {
            const page = message.messages.flatMap(normalizeChatWire);
            setMessages((current) => mergeChat(current, page));
            setHasMoreChat(message.hasMore);
            setLoadingOlderChat(false);
            return;
          }

          if (message.type === "presence") {
            setOnlineUserIds(message.onlineUserIds);
            return;
          }

          if (message.type === "chat" || message.type === "spoke") {
            const chat = normalizeChatMessage(message.message);
            if (!chat) return;
            setMessages((current) => mergeChat(current, [chat]));
            return;
          }

          if (message.type === "error") {
            clearSnapshotWatch();
            setLoading(false);
            setLoadingOlderChat(false);
            // Losing the seat is terminal for this page: the server closes the
            // socket, and reconnecting would only be refused with `not_seated`.
            if (message.code === "kicked" || message.code === "seat_left") {
              const reason = message.code === "kicked" ? "kicked" : "left";
              evictedRef.current = reason;
              setEvicted(reason);
              setError(null);
              return;
            }
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
      if (evictedRef.current) return;
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

  async function handleLeave() {
    setBusyAction("leave");
    setError(null);
    try {
      await leaveTable({ tableId });
      setConfirmLeave(false);
      navigate("/lobby");
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleKick(userId: string) {
    setBusyAction("kick");
    setError(null);
    try {
      await kickFromTable({ tableId, userId });
      setConfirmKick(null);
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
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">
            Connecting
          </p>
          <h1 className="mt-3 font-display text-4xl text-[var(--color-ink)]">
            Loading table magic...
          </h1>
        </section>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
        <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">
            Table unavailable
          </p>
          <h1 className="mt-3 font-display text-4xl text-[var(--color-ink)]">{tableId}</h1>
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          <Link
            className="mt-5 inline-flex rounded-2xl bg-[var(--color-teal)] px-4 py-3 font-semibold text-[var(--color-ink)]"
            to="/lobby"
          >
            Back to lobby
          </Link>
        </section>
      </div>
    );
  }

  // The seat is gone: either this player left or the host removed them. Nothing
  // on this page can be refreshed into a valid view, so offer the way out.
  if (evicted) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
        <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">
            Seat closed
          </p>
          <h1 className="mt-3 font-display text-4xl text-[var(--color-ink)]">
            {evicted === "kicked" ? "The host removed you" : "You left the table"}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            {evicted === "kicked"
              ? "You can join again with the invite code while the table still has room."
              : "Your seat is free for someone else now."}
          </p>
          <Link
            className="mt-5 inline-flex rounded-2xl bg-[var(--color-teal)] px-4 py-3 font-semibold text-[var(--color-ink)]"
            to="/lobby"
          >
            Back to lobby
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6 xl:max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
            Table {meta.code}
          </p>
          <h1 className="mt-2 font-display text-4xl text-[var(--color-ink)]">
            {meta ? tableTitleFor(meta.gameId, meta.config) : "Table"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {confirmLeave ? (
            <>
              <button
                type="button"
                className="rounded-2xl bg-rose-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
                onClick={handleLeave}
                disabled={busyAction === "leave"}
              >
                {busyAction === "leave" ? "Leaving..." : "Confirm leave"}
              </button>
              <button
                type="button"
                className="rounded-2xl bg-white/80 px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm"
                onClick={() => setConfirmLeave(false)}
              >
                Stay
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-2xl bg-white/80 px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setConfirmLeave(true)}
              disabled={meta.status === "active"}
              title={
                meta.status === "active" ? "Finish the game before leaving the table" : undefined
              }
            >
              Leave table
            </button>
          )}
          <Link
            className="rounded-2xl bg-white/80 px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm"
            to="/lobby"
          >
            Back to lobby
          </Link>
        </div>
      </header>

      {meta.status === "lobby" ? (
        <section className="mt-5 rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
            Waiting room
          </p>
          <h2 className="mt-3 font-display text-3xl text-[var(--color-ink)]">
            {meta.seatUserIds.length}/{meta.softSeatCap} seated
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {meta.seatUserIds.map((playerId, index) => (
              <article key={playerId} className="rounded-3xl bg-[var(--color-cream)] px-4 py-4">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-coral)]">
                  Seat {index + 1}
                </p>
                <p className="mt-2 font-semibold text-[var(--color-ink)]">
                  {playerId === currentUserId
                    ? session?.user?.name || "You"
                    : `Player ${index + 1}`}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {playerId === meta.hostUserId ? "Host" : "Ready"}
                </p>
                {currentUserId === meta.hostUserId && playerId !== currentUserId ? (
                  confirmKick === playerId ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-2xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        onClick={() => handleKick(playerId)}
                        disabled={busyAction === "kick"}
                      >
                        Confirm kick
                      </button>
                      <button
                        type="button"
                        className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)]"
                        onClick={() => setConfirmKick(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-3 rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-rose-700"
                      onClick={() => setConfirmKick(playerId)}
                    >
                      Kick
                    </button>
                  )
                ) : null}
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
              <p className="rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-600">
                Waiting for the host to start.
              </p>
            )}
          </div>
          {error ? (
            <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </p>
          ) : null}
        </section>
      ) : (
        <div data-testid="table-active-shell" className="mt-5 pb-24 md:pb-0">
          {renderGameView({
            meta,
            state,
            currentUserId,
            onlineUserIds,
            messages,
            onIntent: sendIntent,
            onSendChat: sendChat,
            hasMoreChat,
            loadingOlderChat,
            onLoadOlderChat: loadOlderChat,
          })}
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

          {error ? (
            <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

import type { TableReplay } from "@roundhouse/game-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { renderGameView, tableTitleFor } from "../games/registry";
import { seatLabels } from "../lib/seats";
import { ApiError, getTableReplay } from "../lib/tables";
import { noticeKindForCode, TableNotice } from "../ui/TableNotice";

type SessionLike = {
  user?: {
    id?: string | null;
  };
} | null;

type ReplayFailure = { code: string | null; message: string };

function failureOf(error: unknown): ReplayFailure {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (typeof error === "string") return { code: null, message: error };
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { code: null, message: error.message };
  }
  return { code: null, message: "That replay could not be read." };
}

/**
 * A finished game, read back one step at a time.
 *
 * Every step is a state the server already projected (ADR 0009), so this page
 * holds no game rules: it moves an index, renders the same view the table uses,
 * and labels the step with the game's own phrase. That is also why it can show
 * a hidden-information game — the picks that were never revealed are not in the
 * data this page receives.
 */
export function ReplayPage({ session }: { session: SessionLike }) {
  const { tableId = "" } = useParams();
  const currentUserId = session?.user?.id ?? null;
  const [replay, setReplay] = useState<TableReplay | null>(null);
  const [error, setError] = useState<ReplayFailure | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let live = true;
    setReplay(null);
    setError(null);

    getTableReplay(tableId)
      .then((loaded) => {
        if (!live) return;
        setReplay(loaded);
        // Open on the final board: someone who clicks "replay" after a game
        // wants the result first and the story second.
        setIndex(Math.max(0, loaded.turns.length - 1));
      })
      .catch((loadError: unknown) => {
        if (live) setError(failureOf(loadError));
      });

    return () => {
      live = false;
    };
  }, [tableId]);

  const noticeKind = error ? noticeKindForCode(error.code) : null;
  const errorText =
    error?.code === "table_not_finished"
      ? "This game is still being played. Open the table to watch it live."
      : (error?.message ?? "");

  const turns = replay?.turns ?? [];
  const lastIndex = Math.max(0, turns.length - 1);
  const turn = turns[Math.min(index, lastIndex)];

  const labels = useMemo(
    () => seatLabels(replay?.meta.seatUserIds ?? [], currentUserId),
    [currentUserId, replay?.meta.seatUserIds],
  );

  const move = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(lastIndex, Math.max(0, current + delta)));
    },
    [lastIndex],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  const stepLabel = (() => {
    if (!turn) return "Nothing has happened yet.";
    const who = turn.actorId === null ? null : (labels[turn.actorId] ?? "Someone");
    return who === null ? turn.phrase : `${who} ${turn.phrase}`;
  })();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
            Replay
          </p>
          <h1 className="mt-1 font-display text-3xl text-[var(--color-ink)]">
            {replay
              ? tableTitleFor(replay.gameId, replay.meta.config, replay.meta.gameId)
              : "Loading the replay"}
          </h1>
        </div>
        <Link
          to={`/t/${tableId}`}
          className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[var(--color-ink)]"
        >
          Back to the table
        </Link>
      </header>

      {error ? (
        <div className="mt-6">
          {noticeKind ? <TableNotice kind={noticeKind} /> : null}
          <p role="alert" className="mt-3 text-sm font-medium text-rose-700">
            {errorText}
          </p>
        </div>
      ) : null}

      {!error && !replay ? (
        <p className="mt-6 text-sm font-medium text-slate-600">Reading the log…</p>
      ) : null}

      {replay && turn ? (
        <>
          <section
            data-testid="replay-controls"
            className="mt-6 rounded-[2rem] border border-white/70 bg-white/85 p-4 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur md:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p data-testid="replay-step" className="text-sm font-semibold text-slate-700">
                {index + 1} / {turns.length} — {stepLabel}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-[var(--color-cream)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)] disabled:opacity-40"
                  onClick={() => move(-1)}
                  disabled={index === 0}
                  aria-label="Previous step"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-[var(--color-cream)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)] disabled:opacity-40"
                  onClick={() => move(1)}
                  disabled={index >= lastIndex}
                  aria-label="Next step"
                >
                  ▶
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={lastIndex}
              value={Math.min(index, lastIndex)}
              onChange={(event) => setIndex(Number(event.target.value))}
              aria-label="Replay step"
              className="mt-4 w-full accent-[var(--color-coral)]"
            />
          </section>

          <div className="mt-6 pb-24 md:pb-0">
            {renderGameView({
              meta: replay.meta,
              state: turn.view,
              currentUserId,
              onlineUserIds: [],
              messages: [],
              onIntent: () => {},
              onSendChat: () => {},
              hasMoreChat: false,
              loadingOlderChat: false,
              onLoadOlderChat: () => {},
              readOnly: true,
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

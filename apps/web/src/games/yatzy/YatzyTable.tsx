import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { YatzyState } from "@yatzy/game-yatzy";
import type { Json, TableMeta } from "@yatzy/game-core";

import { ChatPanel } from "./ChatPanel";
import { DiceTray } from "./DiceTray";
import { ScoreSheet } from "./ScoreSheet";
import { totalScore, type TableChatMessage } from "./model";

type YatzyTableProps = {
  meta: TableMeta;
  state: YatzyState;
  currentUserId: string | null;
  onlineUserIds: string[];
  messages: TableChatMessage[];
  onIntent: (type: string, payload: Json) => void;
  onSendChat: (text: string) => void;
  rollVersion: number;
};

export function YatzyTable(props: YatzyTableProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const currentPlayerId = props.state.playerIds[props.state.currentPlayerIndex] ?? null;
  const isCurrentPlayer = Boolean(props.currentUserId && currentPlayerId === props.currentUserId);

  const playerLabels = useMemo(() => {
    return Object.fromEntries(
      props.meta.seatUserIds.map((playerId, index) => [
        playerId,
        playerId === props.currentUserId ? "You" : `Player ${index + 1}`,
      ]),
    ) as Record<string, string>;
  }, [props.currentUserId, props.meta.seatUserIds]);

  return (
    <>
      <section className="rounded-[2rem] bg-[linear-gradient(135deg,var(--color-coral),var(--color-mango))] p-5 text-white shadow-[0_20px_50px_rgba(238,108,77,0.32)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/80">{props.state.ruleset}</p>
            <h1 className="mt-3 font-display text-4xl leading-none">
              {props.state.phase === "finished" ? "Final scores" : `${playerLabels[currentPlayerId ?? ""] ?? "Next up"} to roll`}
            </h1>
            <p className="mt-3 text-sm text-white/85">
              {props.state.phase === "finished"
                ? `Winner: ${props.state.winnerIds.map((playerId) => playerLabels[playerId] ?? playerId).join(", ")}`
                : isCurrentPlayer
                  ? "Your turn. Roll, hold, then lock in a category."
                  : "Watch the dice, then pounce when your turn swings back."}
            </p>
          </div>
          <button
            type="button"
            className="rounded-2xl bg-white/20 px-4 py-3 text-sm font-semibold text-white backdrop-blur"
            onClick={() => setChatOpen(true)}
          >
            Chat
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {props.meta.seatUserIds.map((playerId) => {
            const online = props.onlineUserIds.includes(playerId);
            const active = playerId === currentPlayerId;

            return (
              <div
                key={playerId}
                className={[
                  "rounded-full px-4 py-2 text-sm font-semibold",
                  active ? "bg-white text-[var(--color-ink)]" : "bg-white/15 text-white",
                ].join(" ")}
              >
                <span className={online ? "text-[var(--color-teal)]" : "text-white/40"}>●</span>{" "}
                {playerLabels[playerId] ?? playerId}
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-5">
        <DiceTray
          dice={props.state.dice}
          holds={props.state.holds}
          rollsLeft={props.state.rollsLeft}
          canRoll={isCurrentPlayer && props.state.phase !== "finished" && props.state.rollsLeft > 0}
          canToggleHolds={isCurrentPlayer && props.state.phase !== "finished" && !props.state.dice.every((die) => die === 0)}
          rollVersion={props.rollVersion}
          onRoll={() => props.onIntent("roll", {})}
          onToggleHold={(index) => {
            const nextHolds = props.state.holds.map((held, heldIndex) => (heldIndex === index ? !held : held));
            props.onIntent("set_holds", { holds: nextHolds });
          }}
        />
      </div>

      <div className="mt-5">
        <ScoreSheet
          state={props.state}
          playerLabels={playerLabels}
          currentUserId={props.currentUserId}
          canScore={isCurrentPlayer && props.state.phase !== "finished"}
          onScore={(category) => props.onIntent("score", { category })}
        />
      </div>

      <section className="mt-5 rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">Standings</p>
            <p className="mt-2 text-sm text-slate-600">
              {props.state.phase === "finished" ? "Game wrapped." : "Live totals update as categories lock in."}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          {props.state.playerIds.map((playerId) => (
            <motion.div
              key={playerId}
              layout
              className="flex items-center justify-between rounded-3xl bg-[var(--color-cream)] px-4 py-3"
            >
              <span className="font-semibold text-[var(--color-ink)]">{playerLabels[playerId] ?? playerId}</span>
              <span className="font-display text-2xl text-[var(--color-ink)]">{totalScore(props.state, playerId)}</span>
            </motion.div>
          ))}
        </div>
      </section>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={props.messages}
        playerLabels={playerLabels}
        canSend
        onSend={props.onSendChat}
      />
    </>
  );
}

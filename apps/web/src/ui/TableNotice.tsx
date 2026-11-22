import { Link } from "react-router-dom";

/**
 * One banner, six honest failures.
 *
 * Every failure used to be `text-rose-700` server prose — "table_full",
 * "unknown_table" and a validation message all looked identical, and none of them
 * said what a player could do next. A notice is chosen by *kind*, and each kind
 * owns its heading, its explanation and its one action.
 */

export type NoticeKind = "full" | "closed" | "finished" | "not-found" | "kicked" | "needs-verify";

export type Notice = {
  /** What the player can do; `to` navigates, `action` runs. */
  action: { label: string; to?: string };
  body: string;
  heading: string;
  kind: NoticeKind;
  /** The small uppercase line above the heading. */
  kicker: string;
};

const NOTICES: Record<NoticeKind, Notice> = {
  closed: {
    action: { label: "Back to lobby", to: "/lobby" },
    body: "Your seat was given up, so this table no longer has a place for you. Nothing else changed.",
    heading: "You left the table",
    kicker: "Seat closed",
    kind: "closed",
  },
  finished: {
    action: { label: "Back to lobby", to: "/lobby" },
    body: "The scores are final. The host can start a rematch from this table.",
    heading: "Game over",
    kicker: "Finished",
    kind: "finished",
  },
  full: {
    action: { label: "Back to lobby", to: "/lobby" },
    body: "Every seat is taken. Ask the host for a seat if someone leaves, then join again with the invite code.",
    heading: "This table is full",
    kicker: "No seats",
    kind: "full",
  },
  "not-found": {
    action: { label: "Back to lobby", to: "/lobby" },
    body: "The code may be mistyped, or the table was closed after everyone left.",
    heading: "We could not find that table",
    kicker: "Table unavailable",
    kind: "not-found",
  },
  kicked: {
    action: { label: "Back to lobby", to: "/lobby" },
    body: "Your seat is gone. You can join again with the invite code while the table still has room.",
    heading: "The host removed you",
    kicker: "Seat closed",
    kind: "kicked",
  },
  "needs-verify": {
    action: { label: "Sign in again", to: "/login" },
    body: "Confirm your email address first — we send a link when you sign up.",
    heading: "Confirm your email to play",
    kicker: "Account",
    kind: "needs-verify",
  },
};

export function noticeFor(kind: NoticeKind): Notice {
  return NOTICES[kind];
}

/**
 * The server's error code, in the player's terms. Unknown codes return null so
 * the caller can show the server's own message instead of inventing a diagnosis.
 */
export function noticeKindForCode(code: string | null | undefined): NoticeKind | null {
  switch (code) {
    case "table_full":
      return "full";
    case "not_seated":
    case "seat_left":
      return "closed";
    case "kicked":
      return "kicked";
    case "unknown_table":
    case "table_not_found":
    case "table_missing":
      return "not-found";
    case "needs_verify":
      return "needs-verify";
    case "table_finished":
    case "game_finished":
      return "finished";
    default:
      return null;
  }
}

/**
 * Renders the notice for a kind. The route decides *which* kind fits; the copy
 * and the action live here so two screens cannot describe the same failure
 * differently.
 */
export function TableNotice({ kind }: { kind: NoticeKind }) {
  const notice = noticeFor(kind);
  return (
    <article
      aria-live="polite"
      className="rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur"
      data-notice-kind={notice.kind}
      role="status"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">
        {notice.kicker}
      </p>
      <h2 className="mt-3 font-display text-3xl text-[var(--color-ink)]">{notice.heading}</h2>
      <p className="mt-3 max-w-prose text-sm text-slate-600">{notice.body}</p>
      {notice.action.to ? (
        <Link
          className="mt-5 inline-flex rounded-2xl bg-[var(--color-teal)] px-4 py-3 font-semibold text-[var(--color-ink)]"
          to={notice.action.to}
        >
          {notice.action.label}
        </Link>
      ) : null}
    </article>
  );
}

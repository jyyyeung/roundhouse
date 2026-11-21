import { getRulesetCompareHelp } from "@roundhouse/game-yatzy";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import {
  buildShareUrl,
  createTable,
  getRecentTables,
  joinTable,
  type RecentTable,
  type Ruleset,
} from "../lib/tables";
import { InfoTip } from "../ui/InfoTip";

type SessionLike = {
  user?: {
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

export function LobbyPage({ session }: { session: SessionLike }) {
  const rulesetHelp = getRulesetCompareHelp();
  const navigate = useNavigate();
  const [ruleset, setRuleset] = useState<Ruleset>("yatzy");
  const [joinCode, setJoinCode] = useState("");
  const [tables, setTables] = useState<RecentTable[]>([]);
  const [createdTable, setCreatedTable] = useState<{ tableId: string; code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"create" | "join" | "signout" | null>(null);
  const webBaseUrl = useMemo(() => window.location.origin, []);

  async function refreshTables() {
    setLoading(true);
    try {
      const mine = await getRecentTables();
      setTables(mine);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount; refreshTables is redefined every render
  useEffect(() => {
    void refreshTables();
  }, []);

  async function handleCreate() {
    setBusyAction("create");
    setError(null);
    try {
      const result = await createTable({ ruleset });
      setCreatedTable(result);
      await refreshTables();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("join");
    setError(null);
    try {
      const normalizedCode = joinCode.replace(/\s+/g, "").toUpperCase();
      const result = await joinTable({ code: normalizedCode });
      navigate(`/t/${result.tableId}?code=${normalizedCode}`);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSignOut() {
    setBusyAction("signout");
    try {
      await authClient.signOut();
      navigate("/login", { replace: true });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6 md:max-w-5xl md:px-6">
      <header className="rounded-[2rem] bg-[linear-gradient(135deg,var(--color-coral),var(--color-mango))] p-6 text-white shadow-[0_20px_50px_rgba(238,108,77,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-white/80">
              Roundhouse
            </p>
            <h1 className="mt-3 font-display text-4xl leading-none">Pull up a seat</h1>
            <p className="mt-3 text-sm text-white/85">
              {session?.user?.name || session?.user?.email || "Signed in"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-full bg-white/20 px-4 py-2 text-sm font-semibold backdrop-blur disabled:opacity-60"
            onClick={handleSignOut}
            disabled={busyAction === "signout"}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="lobby-actions mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 md:items-stretch">
        <section className="flex h-full flex-col rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
            Create table
          </p>
          <div className="mt-4 block">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <label htmlFor="create-ruleset">Ruleset</label>
              <InfoTip label="About rulesets">
                <div className="space-y-1">
                  <p className="font-semibold">{rulesetHelp.title}</p>
                  {rulesetHelp.body.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </InfoTip>
            </div>
            <select
              id="create-ruleset"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-[var(--color-ink)]"
              value={ruleset}
              onChange={(event) => setRuleset(event.target.value as Ruleset)}
            >
              <option value="yatzy">Yatzy</option>
              <option value="yahtzee">Yahtzee</option>
            </select>
          </div>
          <button
            type="button"
            className="mt-auto w-full rounded-2xl bg-[var(--color-teal)] px-4 py-3 font-semibold text-[var(--color-ink)] shadow-[0_14px_30px_rgba(42,157,143,0.24)] disabled:cursor-wait disabled:opacity-70"
            onClick={handleCreate}
            disabled={busyAction === "create"}
          >
            {busyAction === "create" ? "Setting the table..." : "Create table"}
          </button>

          {createdTable ? (
            <div className="mt-4 rounded-3xl bg-[var(--color-cream)] p-4">
              <p className="text-sm font-semibold text-[var(--color-ink)]">Invite link</p>
              <p className="mt-2 break-all text-sm text-slate-600">
                {buildShareUrl({
                  webBaseUrl,
                  tableId: createdTable.tableId,
                  code: createdTable.code,
                })}
              </p>
              <p className="mt-2 text-sm text-slate-500">Code: {createdTable.code}</p>
              <button
                type="button"
                className="mt-4 rounded-2xl bg-white px-4 py-3 font-semibold text-[var(--color-ink)]"
                onClick={() => navigate(`/t/${createdTable.tableId}?code=${createdTable.code}`)}
              >
                Open table
              </button>
            </div>
          ) : null}
        </section>

        <section className="flex h-full flex-col rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
            Join by code
          </p>
          <form className="mt-4 flex flex-1 flex-col space-y-4" onSubmit={handleJoin}>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center font-display text-3xl uppercase tracking-[0.3em] text-[var(--color-ink)]"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              inputMode="text"
              autoCapitalize="characters"
              required
            />
            <button
              type="submit"
              className="mt-auto w-full rounded-2xl bg-[var(--color-ink)] px-4 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-70"
              disabled={busyAction === "join"}
            >
              {busyAction === "join" ? "Joining..." : "Join table"}
            </button>
          </form>
        </section>
      </div>

      <section className="mt-5 rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
            Recent tables
          </p>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--color-teal-deep)]"
            onClick={() => void refreshTables()}
          >
            Refresh
          </button>
        </div>

        {loading ? <p className="mt-4 text-sm text-slate-500">Loading your tables...</p> : null}
        {!loading && tables.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No tables yet. Create one and start inviting chaos.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          {tables.map((table) => {
            const shareUrl = buildShareUrl({ webBaseUrl, tableId: table.id, code: table.code });

            return (
              <article
                key={table.id}
                className="lobby-recent-row rounded-3xl bg-[var(--color-cream)] p-4 md:flex md:items-center md:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3 md:items-center">
                    <div className="min-w-0">
                      <p className="font-display text-2xl text-[var(--color-ink)] md:text-xl">
                        {table.config?.ruleset === "yahtzee" ? "Yahtzee" : "Yatzy"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {table.status} · {table.seatUserIds.length}/{table.softSeatCap} seated
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-coral)]">
                      {table.code}
                    </span>
                  </div>

                  <div className="mt-3 flex min-w-0 items-center gap-2 md:mt-2">
                    <p className="min-w-0 flex-1 break-all text-sm text-slate-600 md:truncate md:break-normal">
                      {shareUrl}
                    </p>
                    <button
                      type="button"
                      className="hidden shrink-0 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)] md:inline-flex"
                      onClick={() => void navigator.clipboard?.writeText(shareUrl)}
                    >
                      Copy link
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="mt-4 w-full rounded-2xl bg-white px-4 py-3 font-semibold text-[var(--color-ink)] md:mt-0 md:w-auto md:shrink-0"
                  onClick={() => navigate(`/t/${table.id}?code=${table.code}`)}
                >
                  Open table
                </button>
              </article>
            );
          })}
        </div>

        {error ? (
          <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

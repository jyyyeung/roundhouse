import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { authClient, googleEnabled } from "../lib/auth-client";

type SessionLike = {
  user?: {
    email?: string | null;
  };
} | null;

type SessionState = {
  data: SessionLike;
  isPending: boolean;
};

type Mode = "signin" | "signup" | "forgot";

/** What to tell someone after a mail has (or has not) been sent. */
type CheckEmail = { kind: "reset" | "verify"; email: string };

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

const fieldClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none ring-0 transition focus:border-[var(--color-coral)]";
const labelClass = "mb-2 block text-sm font-semibold text-slate-700";

export function LoginPage({ session }: { session: SessionState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const from = location.state as { notice?: string } | null;
    return from?.notice ?? null;
  });
  const [checkEmail, setCheckEmail] = useState<CheckEmail | null>(null);
  const [google, setGoogle] = useState(false);
  const destination = useMemo(() => {
    const from = location.state as { from?: string } | null;
    return from?.from || "/lobby";
  }, [location.state]);

  // Ask the server which providers it actually configured. A Google button that
  // leads to an unconfigured provider is worse than no button at all.
  useEffect(() => {
    let live = true;
    void googleEnabled().then((enabled) => {
      if (live) setGoogle(enabled);
    });
    return () => {
      live = false;
    };
  }, []);

  if (session.isPending) {
    return (
      <div className="px-6 py-10 text-center text-[var(--color-ink)]">Checking your session...</div>
    );
  }

  if (session.data) {
    return <Navigate to={destination} replace />;
  }

  function reset(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
    setCheckEmail(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email });
        if (result.error) {
          setError(getErrorMessage(result.error));
          return;
        }
        setCheckEmail({ email, kind: "reset" });
        return;
      }

      if (mode === "signup") {
        const result = await authClient.signUp.email({
          email,
          name: name.trim() || email.split("@")[0] || "Player",
          password,
        });
        if (result.error) {
          setError(getErrorMessage(result.error));
          return;
        }
        // With verification required the server creates the account but issues
        // no session (`token: null`), so there is nothing to sign in with yet.
        const created = result.data as { token?: string | null } | null;
        if (created && !created.token) {
          setCheckEmail({ email, kind: "verify" });
          return;
        }
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) {
          setError(getErrorMessage(result.error));
          return;
        }
      }

      navigate(destination, { replace: true });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setPending(false);
    }
  }

  async function handleGoogle() {
    setPending(true);
    setError(null);
    try {
      await authClient.signIn.social({ callbackURL: destination, provider: "google" });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
      <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
        <p className="font-display text-5xl leading-none text-[var(--color-ink)]">Roundhouse</p>
        <h1 className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-[var(--color-coral)]">
          {mode === "signup" ? "Create account" : mode === "forgot" ? "Reset password" : "Sign in"}
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          {mode === "forgot"
            ? "Tell us the address you signed up with and we will send a link to pick a new password."
            : "Pull up a seat — live tables, chat with game context, friends near or far."}
        </p>

        {checkEmail ? (
          <div className="mt-6 space-y-4">
            <p
              className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
              role="status"
            >
              {checkEmail.kind === "reset"
                ? `If ${checkEmail.email} has an account, a reset link is on its way. The link works once and expires in an hour.`
                : `We sent a confirmation link to ${checkEmail.email}. Open it, then sign in.`}
            </p>
            <button
              type="button"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-slate-700"
              onClick={() => reset("signin")}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            {mode === "forgot" ? null : (
              <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-[var(--color-cream)] p-1">
                <button
                  type="button"
                  className={
                    mode === "signin"
                      ? "rounded-xl bg-white px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm"
                      : "rounded-xl px-4 py-3 font-semibold text-slate-500"
                  }
                  onClick={() => reset("signin")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={
                    mode === "signup"
                      ? "rounded-xl bg-white px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm"
                      : "rounded-xl px-4 py-3 font-semibold text-slate-500"
                  }
                  onClick={() => reset("signup")}
                >
                  Create account
                </button>
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {mode === "signup" ? (
                <label className="block">
                  <span className={labelClass}>Display name</span>
                  <input
                    className={fieldClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Dice goblin"
                  />
                </label>
              ) : null}

              <label className="block">
                <span className={labelClass}>Email</span>
                <input
                  className={fieldClass}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="player@example.com"
                  required
                />
              </label>

              {mode === "forgot" ? null : (
                <label className="block">
                  <span className={labelClass}>Password</span>
                  <input
                    className={fieldClass}
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </label>
              )}

              {notice ? (
                <p
                  className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
                  role="status"
                >
                  {notice}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(238,108,77,0.28)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-70"
                disabled={pending}
              >
                {pending
                  ? "Working..."
                  : mode === "signup"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Email me a link"
                      : "Sign in"}
              </button>
            </form>

            {mode === "signin" ? (
              <button
                type="button"
                className="mt-4 w-full text-sm font-semibold text-slate-600 underline-offset-4 hover:underline"
                onClick={() => reset("forgot")}
              >
                Forgot your password?
              </button>
            ) : null}

            {google ? (
              <button
                type="button"
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700"
                onClick={handleGoogle}
                disabled={pending}
              >
                Continue with Google
              </button>
            ) : null}

            {mode === "forgot" ? (
              <>
                <p className="mt-4 text-center text-xs text-slate-500">
                  Prefer to sign in instead?
                </p>
                <button
                  type="button"
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-slate-700"
                  onClick={() => reset("signin")}
                >
                  Back to sign in
                </button>
              </>
            ) : null}

            <p className="mt-6 text-center text-xs text-slate-500">
              Lost your way?{" "}
              <Link className="font-semibold text-[var(--color-coral)]" to="/lobby">
                Go to the lobby
              </Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}

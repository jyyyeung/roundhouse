import { FormEvent, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { authClient } from "../lib/auth-client";

type SessionLike = {
  user?: {
    email?: string | null;
  };
} | null;

type SessionState = {
  data: SessionLike;
  isPending: boolean;
};

type Mode = "signin" | "signup";

function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Something went sideways. Try again.";
}

export function LoginPage({ session }: { session: SessionState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destination = useMemo(() => {
    const from = location.state as { from?: string } | null;
    return from?.from || "/lobby";
  }, [location.state]);

  if (session.isPending) {
    return <div className="px-6 py-10 text-center text-[var(--color-ink)]">Checking your session...</div>;
  }

  if (session.data) {
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
      <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--color-coral)]">Remote MVP</p>
        <h1 className="mt-3 font-display text-4xl leading-none text-[var(--color-ink)]">Sign in</h1>
        <p className="mt-3 text-sm text-slate-600">
          Spin up a bright little lobby, invite friends, and get to the dice faster.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-[var(--color-cream)] p-1">
          <button
            type="button"
            className={mode === "signin" ? "rounded-xl bg-white px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm" : "rounded-xl px-4 py-3 font-semibold text-slate-500"}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "rounded-xl bg-white px-4 py-3 font-semibold text-[var(--color-ink)] shadow-sm" : "rounded-xl px-4 py-3 font-semibold text-slate-500"}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Display name</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none ring-0 transition focus:border-[var(--color-coral)]"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Dice goblin"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Email</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none ring-0 transition focus:border-[var(--color-coral)]"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="player@example.com"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Password</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none ring-0 transition focus:border-[var(--color-coral)]"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

          <button
            type="submit"
            className="w-full rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(238,108,77,0.28)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-70"
            disabled={pending}
          >
            {pending ? "Working..." : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}

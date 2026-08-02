import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { authClient } from "./lib/auth-client";
import { LobbyPage } from "./routes/lobby";
import { LoginPage } from "./routes/login";
import { TablePage } from "./routes/table";

type SessionLike = {
  user?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
} | null;

type SessionState = {
  data: SessionLike;
  isPending: boolean;
};

function RequireAuth({ session }: { session: SessionState }) {
  const location = useLocation();

  // Only block on the initial session load. Background refetches must not
  // unmount the table (that left guests stuck on "Loading table magic...").
  if (session.isPending && !session.data) return <LoadingScreen />;
  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <Outlet />;
}

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm rounded-[2rem] border border-white/60 bg-white/80 p-8 text-center shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">Session</p>
        <p className="mt-3 font-display text-3xl text-[var(--color-ink)]">Checking your login...</p>
      </div>
    </div>
  );
}

export function App() {
  const session = authClient.useSession() as SessionState;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage session={session} />} />
      <Route element={<RequireAuth session={session} />}>
        <Route index element={<Navigate to="/lobby" replace />} />
        <Route path="/lobby" element={<LobbyPage session={session.data} />} />
        <Route path="/t/:tableId" element={<TablePage session={session.data} />} />
      </Route>
      <Route path="*" element={<Navigate to={session.data ? "/lobby" : "/login"} replace />} />
    </Routes>
  );
}

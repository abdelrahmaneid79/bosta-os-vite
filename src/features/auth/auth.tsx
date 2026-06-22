/** Auth context + gate + login. RLS-respecting: reads run under the session. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, onAuthChange, signIn, signOut } from "@/core/db/session";
import { isEngineConfigured } from "@/core/db/engine";
import { Card, Eyebrow, Button, Field, Input } from "@/components/ui";

interface AuthValue { session: Session | null; loading: boolean; email: string | null; }
const Ctx = createContext<AuthValue>({ session: null, loading: true, email: null });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isEngineConfigured) { setLoading(false); return; }
    let on = true;
    getSession().then((s) => { if (on) { setSession(s); setLoading(false); } });
    const off = onAuthChange((s) => { setSession(s); setLoading(false); });
    return () => { on = false; off(); };
  }, []);
  return <Ctx.Provider value={{ session, loading, email: session?.user.email ?? null }}>{children}</Ctx.Provider>;
}

/** Renders children only with a live session; otherwise the connect/login flow. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (!isEngineConfigured) return <SetupScreen />;
  if (loading) return <Splash />;
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="mascot h-10 w-8 animate-shimmer" />
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4"
      style={{ backgroundImage: "radial-gradient(circle at 50% -10%, rgba(248,104,200,0.12), transparent 50%)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink"><div className="mascot h-7 w-5" /></div>
          <div>
            <div className="font-display text-2xl font-semibold">BostaOS</div>
            <div className="text-xs text-dim">Bosta Bites · operating system</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function SetupScreen() {
  return (
    <Centered>
      <Card>
        <Eyebrow>Not connected</Eyebrow>
        <p className="mt-1 text-sm text-muted">
          Add <span className="font-mono text-pink">VITE_SUPABASE_URL</span> and{" "}
          <span className="font-mono text-pink">VITE_SUPABASE_ANON_KEY</span> to <span className="font-mono">.env</span>,
          then restart. You'll sign in with your Supabase account; all actions run under that session.
        </p>
      </Card>
    </Centered>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await signIn(email, password); }
    catch (e) { setErr(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(false); }
  }
  return (
    <Centered>
      <form onSubmit={submit} className="panel space-y-3 p-5">
        <Eyebrow>Sign in to your Supabase account</Eyebrow>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {err && <div className="rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{err}</div>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? "…" : "Sign in"}</Button>
        <p className="text-center text-[11px] text-dim">All reads and writes run under your session. RLS is enforced.</p>
      </form>
    </Centered>
  );
}

export function SignOutButton() {
  return <button onClick={() => signOut()} className="text-xs text-dim hover:text-text">Sign out</button>;
}

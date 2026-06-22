/**
 * Auth/session over the engine client. RLS requires an authenticated session
 * (every policy targets the `authenticated` role), so the app reads under the
 * owner's login — never bypassing RLS, never using a service key.
 */
import type { Session, User } from "@supabase/supabase-js";
import { sb, isEngineConfigured } from "./engine";

export async function getSession(): Promise<Session | null> {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (s: Session | null) => void): () => void {
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!sb) return;
  await sb.auth.signOut();
}

export function currentUser(session: Session | null): User | null {
  return session?.user ?? null;
}

export { isEngineConfigured };

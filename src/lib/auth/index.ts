import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import type { User } from "@/lib/db/schema";
import { validateSession, type SessionWithUser } from "./session";

export async function getCurrentSession(): Promise<SessionWithUser | null> {
  const jar = await cookies();
  const token = jar.get(env.SESSION_COOKIE_NAME)?.value;
  return validateSession(token);
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

/**
 * Server-side guard. Redirects to /login if not authenticated.
 * Use in Server Components and Server Actions.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

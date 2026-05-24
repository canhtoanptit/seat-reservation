import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type SessionWithUser = {
  sessionId: string;
  user: User;
  expiresAt: Date;
  lastUsedAt: Date;
};

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a new session for a user and return the raw token to set in the
 * cookie. The DB only stores sha256(token).
 */
export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = generateToken();
  const id = hashToken(token);
  const expiresAt = new Date(
    Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.insert(sessions).values({
    id,
    userId,
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Validate a raw session token from a cookie.
 *
 * A session is valid iff:
 *   now < expires_at  AND  now - last_used_at < SESSION_TTL_DAYS
 *
 * (Sliding window with absolute cap — see ADR 0004.)
 *
 * Side effect: bumps last_used_at on success.
 */
export async function validateSession(
  token: string | undefined,
): Promise<SessionWithUser | null> {
  if (!token) return null;
  const id = hashToken(token);

  const inactivityThreshold = new Date(
    Date.now() - env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastUsedAt: sessions.lastUsedAt,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, id),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.lastUsedAt, inactivityThreshold),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Bump last_used_at. In a real system at scale we'd debounce this; here we
  // accept the per-request write.
  await db
    .update(sessions)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(sessions.id, id));

  return {
    sessionId: row.sessionId,
    user: row.user,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Invalidate a session by token. Idempotent.
 */
export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const id = hashToken(token);
  await db.delete(sessions).where(eq(sessions.id, id));
}

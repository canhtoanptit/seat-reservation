/**
 * Session sliding-window:
 *   A session is valid iff now < expires_at AND now - last_used_at < TTL.
 * Four scenarios on the boundary.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { sessions } from "@/lib/db/schema";
import { validateSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import {
  closePool,
  createUser,
  db,
  truncateAll,
} from "../setup-db";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closePool();
});

async function insertSession(args: {
  userId: string;
  expiresAt: Date;
  lastUsedAt: Date;
}): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(raw).digest("hex");
  await db.insert(sessions).values({
    id,
    userId: args.userId,
    expiresAt: args.expiresAt,
    lastUsedAt: args.lastUsedAt,
  });
  return raw;
}

describe("session sliding window", () => {
  it.each([
    {
      name: "fresh: created today, used today → valid",
      createdDaysAgo: 1,
      usedDaysAgo: 0,
      expectedValid: true,
    },
    {
      name: "old but recently used: 89d ago / used 1d ago → valid",
      createdDaysAgo: 89,
      usedDaysAgo: 1,
      expectedValid: true,
    },
    {
      name: "inactive: created 5d ago, unused 91d ago → invalid",
      createdDaysAgo: 5,
      usedDaysAgo: 91,
      expectedValid: false,
    },
    {
      name: "absolute cap: created 91d ago → invalid",
      createdDaysAgo: 91,
      usedDaysAgo: 1,
      expectedValid: false,
    },
  ])("$name", async ({ createdDaysAgo, usedDaysAgo, expectedValid }) => {
    const user = await createUser(
      `test-${createdDaysAgo}-${usedDaysAgo}@example.com`,
    );
    // expires_at is created_at + TTL days. We don't store created_at as the
    // sliding-window driver, so we mock the absolute cap directly.
    const expiresAt = new Date(
      Date.now() + (env.SESSION_TTL_DAYS - createdDaysAgo) * DAY,
    );
    const lastUsedAt = new Date(Date.now() - usedDaysAgo * DAY);
    const token = await insertSession({
      userId: user.id,
      expiresAt,
      lastUsedAt,
    });

    const session = await validateSession(token);
    if (expectedValid) {
      expect(session).not.toBeNull();
      expect(session!.user.id).toBe(user.id);
    } else {
      expect(session).toBeNull();
    }
  });

  it("returns null for missing or wrong token", async () => {
    expect(await validateSession(undefined)).toBeNull();
    expect(await validateSession("garbage")).toBeNull();
  });

  it("bumps last_used_at on a valid lookup", async () => {
    const user = await createUser("bumper@example.com");
    const token = await insertSession({
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * DAY),
      lastUsedAt: new Date(Date.now() - 10 * DAY),
    });
    const before = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .limit(1);
    await validateSession(token);
    const after = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .limit(1);
    expect(after[0]!.lastUsedAt.getTime()).toBeGreaterThan(
      before[0]!.lastUsedAt.getTime(),
    );
  });
});

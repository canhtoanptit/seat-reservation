"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { LIMITS, allow, recordFailure, reset } from "@/lib/auth/rate-limit";
import { sessionCookieClearOptions, sessionCookieOptions } from "@/lib/auth/cookie";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const SignupSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8).max(200),
});

const LoginSchema = SignupSchema;

export type AuthState = { error?: string } | undefined;

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function signupAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = SignupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and a password of at least 8 characters." };
  }
  const { email, password } = parsed.data;

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    const [row] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id });
    userId = row!.id;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return { error: "Email already registered." };
    }
    logger.error({ err }, "signup failed");
    return { error: "Could not create account. Please try again." };
  }

  const { token, expiresAt } = await createSession(userId);
  const jar = await cookies();
  jar.set(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));

  redirect("/seats");
}

export async function loginAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }
  const { email, password } = parsed.data;

  const ip = await clientIp();
  const ipKey = `ip:${ip}`;
  const ipEmailKey = `ip-email:${ip}:${email}`;

  if (!allow(ipKey, LIMITS.ip) || !allow(ipEmailKey, LIMITS.ipEmail)) {
    return { error: "Too many attempts. Please try again later." };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let valid = false;
  if (user) {
    valid = await verifyPassword(user.passwordHash, password);
  } else {
    // Mask timing for unknown-email branch.
    await verifyAgainstDummy(password);
  }

  if (!valid || !user) {
    recordFailure(ipKey, LIMITS.ip);
    recordFailure(ipEmailKey, LIMITS.ipEmail);
    return { error: "Invalid email or password." };
  }

  reset(ipKey);
  reset(ipEmailKey);

  const { token, expiresAt } = await createSession(user.id);
  const jar = await cookies();
  jar.set(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));

  redirect("/seats");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(env.SESSION_COOKIE_NAME)?.value;
  await destroySession(token);
  jar.set(env.SESSION_COOKIE_NAME, "", sessionCookieClearOptions);
  redirect("/login");
}

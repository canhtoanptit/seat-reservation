"use client";

import { useActionState } from "react";
import { loginAction, type AuthState } from "@/app/actions/auth";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    loginAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-sm text-zinc-700">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="text-sm text-zinc-700">Password</span>
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="current-password"
          className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
        />
      </label>
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

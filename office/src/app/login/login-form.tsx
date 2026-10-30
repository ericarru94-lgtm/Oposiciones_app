"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "@/app/actions/auth";

export function LoginForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={disabled}
          className="rounded-lg border border-line bg-ink px-3 py-2.5 outline-none focus:border-cobalt"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          disabled={disabled}
          className="rounded-lg border border-line bg-ink px-3 py-2.5 outline-none focus:border-cobalt"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-signal">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={disabled || pending}
        className="mt-2 rounded-lg bg-cobalt px-4 py-2.5 font-medium text-white transition hover:bg-cobalt-soft disabled:opacity-50"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

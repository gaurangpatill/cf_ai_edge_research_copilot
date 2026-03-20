"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { workerClient } from "@/lib/worker-client";

export function LoginForm({ nextPath: _nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="panel flex flex-col justify-between p-8 lg:p-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Secure access</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-slate-950 lg:text-5xl">
              Sign in to your research workspace.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-slate-600">
              Accounts now map to persistent backend users. Your sessions, uploads, and retrieval history stay grouped
              under the same authenticated identity.
            </p>
          </div>

          <div className="space-y-3">
            {[
              "Persistent session history tied to a valid account",
              "Protected API access through signed bearer tokens",
              "Cloudflare-backed storage instead of random local identities"
            ].map((item) => (
              <div key={item} className="rounded-3xl border border-black/5 bg-white/70 px-4 py-4 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-8 lg:p-10">
          <div className="rounded-full border border-black/10 bg-white p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-full px-4 py-2 text-sm ${mode === "login" ? "bg-slate-950 text-white" : "text-slate-600"}`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-full px-4 py-2 text-sm ${mode === "register" ? "bg-slate-950 text-white" : "text-slate-600"}`}
            >
              Register
            </button>
          </div>

          <div className="mt-8">
            <h2 className="text-2xl font-semibold text-slate-950">
              {mode === "register" ? "Create your account" : "Welcome back"}
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              {mode === "register"
                ? "Use a real email and a password with at least 8 characters."
                : "Sign in with the account you already created for this research workspace."}
            </p>
          </div>

          <form
          className="mt-8 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!email.trim() || !password.trim()) {
              setError("Email and password are required.");
              return;
            }
            setError(null);
            setIsSubmitting(true);
            try {
              if (mode === "register") {
                await workerClient.register(name, email, password);
              } else {
                await workerClient.login(email, password);
              }
              router.replace("/new");
            } catch (error) {
              setError(error instanceof Error ? error.message : "Authentication failed.");
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
            {mode === "register" ? (
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Full name"
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
              />
            ) : null}
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email address"
              type="email"
              className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
            />
            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSubmitting ? "Working..." : mode === "register" ? "Create account" : "Log in"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

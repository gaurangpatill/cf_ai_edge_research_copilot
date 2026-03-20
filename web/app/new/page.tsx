"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser } from "@/lib/auth-store";
import { workerClient } from "@/lib/worker-client";

export default function NewSessionPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    if (!getAuthUser()) {
      router.replace("/login?next=/new");
      return;
    }

    workerClient.createSession().then((result) => {
      if (cancelled) return;
      router.replace(`/chat/${result.session.id}`);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="panel px-6 py-5 text-sm text-slate-600">Preparing a new research session...</div>
    </main>
  );
}

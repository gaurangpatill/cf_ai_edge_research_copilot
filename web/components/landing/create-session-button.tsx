"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getAuthUser } from "@/lib/auth-store";
import { workerClient } from "@/lib/worker-client";

export function CreateSessionButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        if (!getAuthUser()) {
          router.push("/login?next=/new");
          return;
        }
        const result = await workerClient.createSession();
        router.push(`/chat/${result.session.id}`);
      }}
      className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
    >
      Start Research Session
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}

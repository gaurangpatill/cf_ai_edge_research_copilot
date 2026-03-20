"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LogIn } from "lucide-react";
import { getAuthUser } from "@/lib/auth-store";

export function EntryActions() {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => {
          router.push(getAuthUser() ? "/new" : "/login?next=/new");
        }}
        className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        Get Started
        <ArrowRight className="h-4 w-4" />
      </button>
      <Link
        href="/login"
        className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        <LogIn className="h-4 w-4" />
        Log In
      </Link>
    </div>
  );
}

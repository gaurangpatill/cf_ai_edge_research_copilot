import { Atom, BookOpenText, ShieldCheck, Waves } from "lucide-react";
import { EntryActions } from "@/components/landing/entry-actions";

const cards = [
  {
    title: "Grounded answers",
    body: "Ask questions against uploaded material and inspect the exact retrieved evidence behind each answer.",
    icon: BookOpenText
  },
  {
    title: "Persistent research threads",
    body: "Keep separate workspaces for different topics, clients, or projects without mixing context.",
    icon: Waves
  },
  {
    title: "Edge-native architecture",
    body: "Workers AI, Vectorize, Durable Objects, and SQLite stay at the center of the product experience.",
    icon: Atom
  }
];

export default function LandingPage() {
  return (
    <main className="min-h-screen px-6 py-8 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">Edge Research Copilot</p>
            <p className="mt-2 text-sm text-slate-600">Cloudflare-native research workspace</p>
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="panel relative overflow-hidden p-8 lg:p-12">
            <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-emerald-100/80 via-amber-50/70 to-transparent" />
            <div className="relative max-w-3xl space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-600">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                Authenticated research sessions
              </div>
              <div className="space-y-5">
                <h1 className="text-5xl font-semibold tracking-[-0.05em] text-slate-950 md:text-7xl">
                  Turn source material into a working research system.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-slate-600">
                  Upload documents, ask grounded questions, inspect retrieval, and keep session memory tied to user accounts.
                </p>
              </div>
              <EntryActions />
              <div className="grid gap-3 pt-2 sm:grid-cols-3">
                {["Upload sources", "Ask focused questions", "Inspect cited retrieval"].map((item, index) => (
                  <div key={item} className="rounded-3xl border border-black/5 bg-white/70 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Step {index + 1}</p>
                    <p className="mt-2 text-sm font-medium text-slate-800">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <section key={card.title} className="panel p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-5 text-xl font-semibold text-slate-950">{card.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{card.body}</p>
                </section>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

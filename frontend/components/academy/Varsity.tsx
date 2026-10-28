// Zerodha Varsity catalogue inside FH Academy: linked, not copied.
// Only module names, chapter titles, order and chapter URLs are stored
// (see lib/varsityCatalogue.ts). Every Varsity view carries the attribution
// line, and Varsity reads award no XP. Progress is stored per staff member
// on the server (POST /api/learn/varsity/progress); if the server cannot be
// reached, taps are kept on this device and a note says so plainly.

import React, { useEffect, useMemo, useState } from "react";
import { useAcademy } from "./AcademyContext";
import { academy } from "./api";
import { Bar, Spinner, btnGhost, btnPrimary, card, chip, muted } from "./ui";
import { DEFERRED_MODULES, VARSITY_MODULES, VARSITY_MODULES_INDEX, type VarsityModule } from "@/lib/varsityCatalogue";
import { VARSITY_NOTES } from "@/lib/varsityNotes";
import { VARSITY_ILLUSTRATIONS } from "./VarsityIllustrations";
import { VarsityConceptMap, VarsityMindmap, type ConceptTopic } from "./VarsityMindmap";

export const VARSITY_ATTRIBUTION =
  "Content by Zerodha Varsity — read on zerodha.com, not hosted by Fund Horizon. Only chapter titles and links are listed here; no Zerodha chapter text is stored on this site.";
const NO_XP = "Reading Varsity chapters tracks progress but does not earn XP.";
const STORAGE_KEY = "fh-varsity-read";

export function varsityChapterId(slug: string, n: number) {
  return `varsity:${slug}:${n}`;
}

function readStoredIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useVarsityProgress() {
  const [read, setRead] = useState<Set<string>>(new Set());
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const syncFromServer = async () => {
    try {
      const res = await academy.varsityProgress();
      const next = new Set(res.read);
      setRead(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* storage is a fallback only */
      }
      setSyncNote(null);
    } catch {
      setRead(readStoredIds());
      setSyncNote("Server progress is unavailable right now, so progress is saved on this device only. Use Retry to sync with the server.");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    syncFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (id: string) => {
    const next = new Set(read);
    const want = !next.has(id);
    if (want) next.add(id);
    else next.delete(id);
    setRead(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* ignore */
    }
    try {
      await academy.varsityToggle(id, want);
      setSyncNote(null);
    } catch {
      setSyncNote("That tap was saved on this device only — the server did not confirm it. Use Retry to sync.");
    }
  };

  return { read, toggle, syncNote, loaded, retry: syncFromServer };
}

function moduleProgress(m: VarsityModule, read: Set<string>) {
  if (!m.chapters) return null;
  const done = m.chapters.filter((c) => read.has(varsityChapterId(m.slug, c.n))).length;
  return { done, total: m.chapters.length };
}

function ChapterLink({ m, chapterUrl }: { m: VarsityModule; chapterUrl: string | null }) {
  if (chapterUrl)
    return (
      <a href={chapterUrl} target="_blank" rel="noreferrer" className={`${btnGhost} shrink-0`}>
        Read on Zerodha ↗
      </a>
    );
  const href = m.moduleUrl ?? VARSITY_MODULES_INDEX;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`${btnGhost} shrink-0`} title="This chapter's direct link was not collected, so this opens the module page on Zerodha instead.">
      Module page ↗
    </a>
  );
}

export function VarsityHub() {
  const { go } = useAcademy();
  const { read, syncNote, loaded, retry } = useVarsityProgress();
  const [view, setView] = useState<"mindmap" | "list">("mindmap");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "read" | "unread">("all");
  const [laterOpen, setLaterOpen] = useState(false);

  const storedTotal = useMemo(() => VARSITY_MODULES.reduce((s, m) => s + (m.chapters?.length ?? 0), 0), []);
  const storedIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of VARSITY_MODULES) for (const c of m.chapters ?? []) s.add(varsityChapterId(m.slug, c.n));
    return s;
  }, []);
  const readStored = Array.from(read).filter((id) => storedIds.has(id)).length;

  const q = query.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (q.length < 2) return null;
    const mods = VARSITY_MODULES.filter((m) => m.title.toLowerCase().includes(q) || VARSITY_NOTES[m.slug]?.blurb.toLowerCase().includes(q));
    const later = DEFERRED_MODULES.filter((m) => m.title.toLowerCase().includes(q));
    const chapters: { m: VarsityModule; n: number; title: string }[] = [];
    for (const m of VARSITY_MODULES)
      for (const c of m.chapters ?? []) if (c.title.toLowerCase().includes(q)) chapters.push({ m, n: c.n, title: c.title });
    return { mods, later, chapters: chapters.slice(0, 50) };
  }, [q]);

  const modules = VARSITY_MODULES.filter((m) => {
    const p = moduleProgress(m, read);
    if (filter === "read") return p !== null && p.done === p.total && p.total > 0;
    if (filter === "unread") return p === null || p.done < p.total;
    return true;
  });

  const openModule = (slug: string) => go({ varsity: "1", vm: slug });

  return (
    <div className="space-y-6">
      <section className={`${card} border-dashed p-6 space-y-3`} aria-label="Varsity external learning">
        <p className="text-xs font-bold uppercase tracking-wider text-[#B45309]">External learning · Not FH training</p>
        <h2 className="text-xl font-semibold">Zerodha Varsity library — focus set</h2>
        <p className={`text-[15px] ${muted}`}>
          Eight focus modules are listed in full below, with their chapters linked to the original pages on Zerodha. Seven more modules are coming later and are
          shown only in the collapsed “Later” section at the bottom of this page. {NO_XP}
        </p>
        <p className={`text-[15px] ${muted}`}>{VARSITY_ATTRIBUTION}</p>
        <p className="text-[15px]">
          Overall: <strong>{readStored} / {storedTotal}</strong> listed chapters marked read.
          <span className={`block text-sm ${muted}`}>
            Progress counts only the {storedTotal} chapters whose titles are listed here. Introduction to Stock Markets (15 chapters) has no chapter list yet —
            collection was stopped by a rate limit — so it is not in this count.
          </span>
        </p>
        {syncNote && (
          <p role="alert" className="text-[15px] text-[#B42332] dark:text-[#FF7D86]">
            {syncNote} <button className={btnGhost} onClick={retry}>Retry sync</button>
          </p>
        )}
        {!loaded && <Spinner label="Loading your Varsity progress" />}
      </section>

      <section className="space-y-3" aria-label="Search all Varsity modules and chapters">
        <label className="block">
          <span className={`text-sm ${muted}`}>Search across all modules and chapters</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try “NAV”, “Delta”, “Banking”…"
            className="mt-1 w-full rounded-md border border-[#E4E9EF] bg-transparent px-3 py-2 text-[15px] dark:border-[#2B3644]"
          />
        </label>
        {searchHits && (
          <div className={`${card} p-4 space-y-3`}>
            {searchHits.mods.length === 0 && searchHits.later.length === 0 && searchHits.chapters.length === 0 && <p className={muted}>No module or listed chapter matches “{query}”.</p>}
            {searchHits.mods.map((m) => (
              <button key={m.slug} className={`${btnGhost} w-full justify-start`} onClick={() => openModule(m.slug)}>
                Module: {m.title} · {m.count} chapters
              </button>
            ))}
            {searchHits.later.map((m) => (
              <a key={m.slug} href={m.moduleUrl ?? VARSITY_MODULES_INDEX} target="_blank" rel="noreferrer" className={`${btnGhost} w-full justify-start`}>
                Later (not integrated yet): {m.title} · {m.count} chapters — open on Zerodha ↗
              </a>
            ))}
            {searchHits.chapters.map((h) => (
              <button key={`${h.m.slug}-${h.n}`} className={`${btnGhost} w-full justify-start text-left`} onClick={() => go({ varsity: "1", vm: h.m.slug, ch: String(h.n) })}>
                Chapter {h.n}: {h.title} <span className={muted}>— {h.m.title}</span>
              </button>
            ))}
            {searchHits.chapters.length >= 50 && <p className={`text-sm ${muted}`}>Showing the first 50 chapter matches.</p>}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-label="Varsity modules">
        <div className="flex flex-wrap items-center gap-2">
          <button className={view === "mindmap" ? btnPrimary : btnGhost} onClick={() => setView("mindmap")}>Mindmap view</button>
          <button className={view === "list" ? btnPrimary : btnGhost} onClick={() => setView("list")}>List view</button>
          <span className={`text-sm ${muted}`}>Mindmap is the headline view; the list is always one tap away.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter modules by progress">
          {(["all", "unread", "read"] as const).map((f) => (
            <button key={f} className={chip(filter === f)} onClick={() => setFilter(f)}>
              {f === "all" ? "All modules" : f === "read" ? "Read (every listed chapter)" : "Unread / in progress"}
            </button>
          ))}
        </div>

        {view === "mindmap" ? (
          <VarsityMindmap
            nodes={VARSITY_MODULES.map((m) => ({
              slug: m.slug,
              title: m.title,
              count: m.count,
              blurb: VARSITY_NOTES[m.slug]?.blurb ?? "",
              onOpen: () => openModule(m.slug),
            }))}
            onOpenList={() => setView("list")}
            branchContent={(slug) => {
              const m = VARSITY_MODULES.find((x) => x.slug === slug);
              if (!m) return null;
              if (!m.chapters)
                return <p className={`text-sm ${muted}`}>No chapter list stored for this module yet — open the module from its card or the list view.</p>;
              return (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.chapters.slice(0, 10).map((c) => (
                    <button key={c.n} className={btnGhost} onClick={() => go({ varsity: "1", vm: m.slug, ch: String(c.n) })}>
                      {c.n}. {c.title}
                    </button>
                  ))}
                  {m.chapters.length > 10 && <span className={`text-sm ${muted}`}>…plus {m.chapters.length - 10} more in the module view.</span>}
                </div>
              );
            }}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((m) => {
              const p = moduleProgress(m, read);
              const note = VARSITY_NOTES[m.slug];
              return (
                <article key={m.slug} className={`${card} p-5 space-y-3`}>
                  {VARSITY_ILLUSTRATIONS[m.slug]}
                  <h3 className="text-lg font-semibold">{m.title}</h3>
                  <p className={`text-sm ${muted}`}>{m.count} chapters{m.chapters ? "" : " · chapter list not stored yet"}</p>
                  {note && <p className={`text-[15px] ${muted}`}>{note.blurb}</p>}
                  {note?.relates && <p className="text-sm"><span className={muted}>FH link: </span>{note.relates}</p>}
                  {p ? (
                    <div className="space-y-1">
                      <Bar value={p.total ? p.done / p.total : 0} label={`${m.title} progress`} />
                      <p className={`text-sm ${muted}`}>{p.done}/{p.total} chapters read</p>
                    </div>
                  ) : (
                    <p className={`text-sm ${muted}`}>Progress is not tracked for this module until its chapter list is stored.</p>
                  )}
                  <button className={btnPrimary} onClick={() => openModule(m.slug)}>Open module →</button>
                </article>
              );
            })}
          </div>
        )}
        {view === "mindmap" && modules.length !== VARSITY_MODULES.length && (
          <p className={`text-sm ${muted}`}>
            The mindmap always shows all {VARSITY_MODULES.length} focus modules. The {filter} filter applies to the list view and to search; switch to List view to see the filtered set.
          </p>
        )}
      </section>

      <section className={`${card} p-5 space-y-3`} aria-label="Modules coming later">
        <button className={btnGhost} aria-expanded={laterOpen} onClick={() => setLaterOpen((o) => !o)}>
          {laterOpen ? "▾ Hide modules coming later" : "▸ Later — modules not integrated yet"}
        </button>
        {laterOpen && (
          <div className="space-y-2">
            <p className={`text-[15px] ${muted}`}>
              These modules are not integrated yet: no chapter list, mindmap or illustration is built for them in this release. A later build can expand them
              without rework. Each row links to Zerodha so staff can still read them there.
            </p>
            {DEFERRED_MODULES.map((m) => (
              <div key={m.slug} className="flex flex-wrap items-center gap-3 rounded-md border border-[#E4E9EF] p-3 dark:border-[#2B3644]">
                <span className="min-w-0 flex-1 text-[15px] font-medium">{m.title}</span>
                <span className={`text-sm ${muted}`}>{m.count} chapters</span>
                <a href={m.moduleUrl ?? VARSITY_MODULES_INDEX} target="_blank" rel="noreferrer" className={btnGhost} title={m.moduleUrl ? "Opens this module on Zerodha" : "Individual module links were not collected yet, so this opens the Varsity modules index on Zerodha"}>
                  Open on Zerodha ↗
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function VarsityDetail({ slug, ch }: { slug: string; ch: string | null }) {
  const { go } = useAcademy();
  const { read, toggle, syncNote, retry } = useVarsityProgress();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "read" | "unread">("all");
  const m = VARSITY_MODULES.find((x) => x.slug === slug);
  const note = m ? VARSITY_NOTES[m.slug] : undefined;

  useEffect(() => {
    if (!ch) return;
    const t = window.setTimeout(() => document.getElementById(`varsity-ch-${ch}`)?.scrollIntoView({ block: "center" }), 150);
    return () => window.clearTimeout(t);
  }, [ch, slug]);

  if (!m)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-[#B42332] dark:text-[#FF7D86]">That Varsity module was not found.</p>
        <button className={btnGhost} onClick={() => go({ varsity: "1" })}>← Back to Varsity library</button>
      </div>
    );

  const p = moduleProgress(m, read);
  const q = query.trim().toLowerCase();
  const chapters = (m.chapters ?? []).filter((c) => {
    if (q && !c.title.toLowerCase().includes(q)) return false;
    const isRead = read.has(varsityChapterId(m.slug, c.n));
    if (filter === "read" && !isRead) return false;
    if (filter === "unread" && isRead) return false;
    return true;
  });

  const topics: ConceptTopic[] = (note?.topics ?? []).map((t) => {
    if (t.chapter !== null) {
      const chapter = m.chapters?.find((c) => c.n === t.chapter);
      if (chapter?.url) return { label: t.label, href: chapter.url, external: true, ariaLabel: `${t.label} — opens chapter ${t.chapter} on Zerodha` };
      return { label: t.label, href: `#varsity-ch-${t.chapter}`, external: false, ariaLabel: `${t.label} — jumps to chapter ${t.chapter} in the list below` };
    }
    if (!m.chapters)
      return { label: t.label, href: m.moduleUrl ?? VARSITY_MODULES_INDEX, external: true, ariaLabel: `${t.label} — opens this module on Zerodha` };
    return { label: t.label, href: "#varsity-chapters", external: false, ariaLabel: `${t.label} — see the chapter list below` };
  });

  const moduleHref = m.moduleUrl ?? VARSITY_MODULES_INDEX;

  return (
    <div className="space-y-6">
      <button className={btnGhost} onClick={() => go({ varsity: "1" })}>← Back to Varsity library</button>

      <section className={`${card} border-dashed p-6 space-y-3`} aria-label={`${m.title} overview`}>
        {VARSITY_ILLUSTRATIONS[m.slug]}
        <p className="text-xs font-bold uppercase tracking-wider text-[#B45309]">External learning · Not FH training</p>
        <h2 className="text-xl font-semibold">{m.title}</h2>
        {note && <p className={`text-[15px] ${muted}`}>{note.blurb}</p>}
        {note?.relates && <p className="text-sm"><span className={muted}>FH link: </span>{note.relates}</p>}
        <p className={`text-[15px] ${muted}`}>{VARSITY_ATTRIBUTION}</p>
        <p className={`text-[15px] ${muted}`}>{NO_XP}</p>
        {p ? (
          <div className="space-y-1">
            <Bar value={p.total ? p.done / p.total : 0} label={`${m.title} progress`} />
            <p className={`text-sm ${muted}`}>{p.done}/{p.total} chapters read</p>
          </div>
        ) : (
          <p className={`text-sm ${muted}`}>{m.count} chapters on Zerodha. Progress is not tracked for this module until its chapter list is stored.</p>
        )}
        {syncNote && (
          <p role="alert" className="text-[15px] text-[#B42332] dark:text-[#FF7D86]">
            {syncNote} <button className={btnGhost} onClick={retry}>Retry sync</button>
          </p>
        )}
      </section>

      <section className="space-y-3" aria-label={`${m.title} concept map`}>
        <h3 className="text-lg font-semibold">Key topics in this module</h3>
        <p className={`text-[15px] ${muted}`}>
          Tap a topic to open its chapter on Zerodha where a direct chapter link is known; otherwise it jumps to the chapter list below. Topics are Fund Horizon summaries, not Zerodha text.
        </p>
        <VarsityConceptMap moduleTitle={m.title} topics={topics} />
      </section>

      <section id="varsity-chapters" className="space-y-3" aria-label={`${m.title} chapters`}>
        <h3 className="text-lg font-semibold">Chapters · {m.count} on Zerodha</h3>
        {!m.chapters && (
          <div className={`${card} p-5 space-y-3`}>
            <p className={`text-[15px] ${muted}`}>Chapter list unavailable — open the module on Zerodha</p>
            <p className={`text-[15px] ${muted}`}>This module&apos;s chapter titles have not been collected yet, so no list is shown rather than an incomplete one.</p>
            <a href={moduleHref} target="_blank" rel="noreferrer" className={btnPrimary}>Open this module on Zerodha ↗</a>
          </div>
        )}
        {m.chapters && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chapters in this module…"
                className="min-w-56 flex-1 rounded-md border border-[#E4E9EF] bg-transparent px-3 py-2 text-[15px] dark:border-[#2B3644]"
                aria-label={`Search chapters in ${m.title}`}
              />
              {(["all", "unread", "read"] as const).map((f) => (
                <button key={f} className={chip(filter === f)} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "read" ? "Read" : "Unread"}
                </button>
              ))}
            </div>
            <p className={`text-sm ${muted}`}>
              Showing {chapters.length} of {m.chapters.length} listed chapters
              {m.chapters.some((c) => !c.url) ? " · chapters without a direct link open the module page on Zerodha instead" : ""}.
            </p>
            <ol className="space-y-2">
              {chapters.map((c) => {
                const id = varsityChapterId(m.slug, c.n);
                const isRead = read.has(id);
                return (
                  <li key={c.n} id={`varsity-ch-${c.n}`} className={`${card} flex flex-wrap items-center gap-3 p-4`}>
                    <span className={`w-8 shrink-0 text-sm ${muted}`}>{c.n}.</span>
                    <span className="min-w-0 flex-1 text-[15px] font-medium">{c.title}</span>
                    <ChapterLink m={m} chapterUrl={c.url} />
                    <button className={isRead ? btnPrimary : btnGhost} onClick={() => toggle(id)} aria-pressed={isRead}>
                      {isRead ? "✓ Read — Mark unread" : "Mark read"}
                    </button>
                  </li>
                );
              })}
            </ol>
            {chapters.length === 0 && <p className={muted}>No chapters match the current search and filter.</p>}
          </>
        )}
      </section>
    </div>
  );
}

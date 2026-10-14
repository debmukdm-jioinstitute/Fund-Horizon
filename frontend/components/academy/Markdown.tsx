"use client";

import React, { useMemo, useState } from "react";
import { useAcademy } from "./AcademyContext";
import { accent, muted } from "./ui";

/* Small markdown subset for lesson bodies: ## / ### headings, paragraphs, - lists, > quotes, | tables |, **bold**.
   HTML comments (TODO-VERIFY / TODO-COMPLIANCE notes) are stripped. Glossary terms in `terms` are underlined. */

type Def = { term: string; definition: string };

function Term({ label, def }: { label: string; def: Def }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  return (
    <span className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" aria-expanded={open} onClick={() => setPinned((p) => !p)} onKeyDown={(e) => e.key === "Escape" && setPinned(false)}
        className="underline decoration-dotted underline-offset-4 decoration-[#006F64] dark:decoration-[#75E1CE] cursor-help">
        {label}
      </button>
      {open && (
        <span role="tooltip" className="absolute z-20 left-0 top-full mt-1 w-64 max-w-[80vw] rounded-md border border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#171E27] p-3 text-sm leading-snug shadow-lg font-normal">
          <strong className={accent}>{def.term}</strong> <span className={muted}>{def.definition}</span>
        </span>
      )}
    </span>
  );
}

export function Markdown({ text, terms }: { text: string; terms: string[] }) {
  const { glossary } = useAcademy();
  const { re, defs } = useMemo(() => {
    const defs = new Map<string, Def>();
    for (const g of glossary) {
      if (!terms.includes(g.term)) continue;
      for (const a of [g.term, ...g.aliases]) defs.set(a.toLowerCase(), g);
    }
    const alts = Array.from(defs.keys()).sort((a, b) => b.length - a.length).map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return { defs, re: alts.length ? new RegExp(`(?<![\\w-])(${alts.join("|")})(?![\\w-])`, "gi") : null };
  }, [glossary, terms]);

  const withTerms = (s: string, k: string): React.ReactNode[] => {
    if (!re) return [s];
    const out: React.ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of Array.from(s.matchAll(re))) {
      const d = defs.get(m[0].toLowerCase());
      if (!d) continue;
      out.push(s.slice(last, m.index), <Term key={`${k}-${i++}`} label={m[0]} def={d} />);
      last = (m.index ?? 0) + m[0].length;
    }
    out.push(s.slice(last));
    return out;
  };
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
      part.startsWith("**") ? <strong key={`${k}b${i}`}>{withTerms(part.slice(2, -2), `${k}b${i}`)}</strong> : <React.Fragment key={`${k}p${i}`}>{withTerms(part, `${k}p${i}`)}</React.Fragment>
    );

  const lines = text.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const ln = lines[i];
    const key = `b${i}`;
    if (!ln.trim()) { i++; continue; }
    if (ln.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      out.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full text-[15px] border-collapse">
            <thead><tr>{rows[0].map((h, j) => <th key={j} scope="col" className={`text-left font-semibold p-2 border-b border-[#E4E9EF] dark:border-[#2B3644] ${muted}`}>{inline(h, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((r, j) => <tr key={j} className="align-top">{r.map((c, k) => <td key={k} className="p-2 border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">{inline(c, `${key}r${j}c${k}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    } else if (ln.startsWith("## ") || ln.startsWith("### ")) {
      out.push(<h3 key={key} className={`text-base font-semibold pt-2 ${accent}`}>{inline(ln.replace(/^#+\s/, ""), key)}</h3>);
      i++;
    } else if (ln.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      out.push(<ul key={key} className="list-disc pl-6 space-y-1">{items.map((x, j) => <li key={j}>{inline(x, `${key}l${j}`)}</li>)}</ul>);
    } else if (ln.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(<blockquote key={key} className="border-l-4 border-[#006F64] dark:border-[#75E1CE] pl-4 py-1">{inline(q.join(" "), key)}</blockquote>);
    } else {
      const p: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(\||#|- |>)/.test(lines[i])) p.push(lines[i++]);
      out.push(<p key={key}>{inline(p.join(" "), key)}</p>);
    }
  }
  return <div className="space-y-4 text-base leading-relaxed">{out}</div>;
}

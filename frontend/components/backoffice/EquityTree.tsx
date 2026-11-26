"use client";

import React, { useMemo, useState } from "react";
import { EquityBasket } from "@/lib/backoffice";

export const HOME_ID = "home";

interface Props {
  items: EquityBasket[];
  activeId: string;
  locked: boolean; // unsaved edit in progress: block navigation and structure changes
  onSelect: (id: string) => void;
  onCreate: (kind: "basket" | "folder", parentId: string | null, name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, parentId: string | null) => void;
  onDelete: (id: string) => void;
}

const Icon = ({ folder, open }: { folder: boolean; open?: boolean }) => folder ? (
  <svg aria-hidden className="h-4 w-4 shrink-0 text-[#4A8BE8]" viewBox="0 0 24 24" fill="currentColor" opacity={open ? 1 : 0.8}><path d="M3 6.5A2.5 2.5 0 015.5 4h4l2 2h7A2.5 2.5 0 0121 8.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z" /></svg>
) : (
  <svg aria-hidden className="h-4 w-4 shrink-0 text-[#81878C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h7" /></svg>
);

/** Parent-child file view of baskets: folders nest folders and baskets; baskets hold the stocks. */
export default function EquityTree({ items, activeId, locked, onSelect, onCreate, onRename, onMove, onDelete }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ parent: string | null; kind: "basket" | "folder" } | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const kids = useMemo(() => {
    const m = new Map<string | null, EquityBasket[]>();
    for (const b of items) {
      const k = b.parent_id && items.some((x) => x.id === b.parent_id) ? b.parent_id : null; // orphan => top level
      m.set(k, [...(m.get(k) ?? []), b]);
    }
    m.forEach((list) => list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1)));
    return m;
  }, [items]);

  const descendants = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    for (const c of kids.get(id) ?? []) descendants(c.id).forEach((x) => out.add(x));
    return out;
  };
  const folderPath = (id: string): string => {
    const b = items.find((x) => x.id === id);
    return b?.parent_id ? `${folderPath(b.parent_id)} / ${b.name}` : (b?.name ?? "");
  };

  const toggle = (id: string) => setExpanded((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; });
  const startAdd = (parent: string | null, kind: "basket" | "folder") => {
    setAdding({ parent, kind }); setName(""); setMenu(null);
    if (parent) setExpanded((p) => new Set(p).add(parent));
  };
  const submitAdd = async () => {
    if (!adding || !name.trim()) return;
    if (await onCreate(adding.kind, adding.parent, name.trim())) setAdding(null);
  };

  const btn = "rounded-md px-2 py-1 text-xs font-medium text-[#1F7AE0] hover:bg-[#EAF2FF] disabled:opacity-40";
  const addRow = (parent: string | null, depth: number) => adding && adding.parent === parent ? (
    <li key={`add-${parent}`}>
    <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: 8 + depth * 14 }}>
      <Icon folder={adding.kind === "folder"} />
      <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={adding.kind === "folder" ? "Folder name" : "Basket name"}
        onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); if (e.key === "Escape") setAdding(null); }}
        className="min-w-0 flex-1 rounded-md border border-[#D5E3F7] bg-white px-2 py-1 text-sm outline-none focus:border-[#1F7AE0]" />
      <button className={btn} onClick={submitAdd} disabled={!name.trim()}>Add</button>
    </div>
    </li>
  ) : null;

  const renderNode = (b: EquityBasket, depth: number): React.ReactNode => {
    const folder = b.kind === "folder";
    const open = expanded.has(b.id);
    const active = !folder && b.id === activeId;
    const children = kids.get(b.id) ?? [];
    const blocked = new Set(folder ? descendants(b.id) : [b.id]);
    const targets = items.filter((x) => x.kind === "folder" && !blocked.has(x.id));
    return (
      <li key={b.id}>
        <div className={`group flex items-center gap-1.5 rounded-lg py-1.5 pr-1 ${active ? "bg-[#DCEBFF] font-medium text-[#17408B]" : "hover:bg-[#EEF4FD]"}`} style={{ paddingLeft: 8 + depth * 14 }}>
          {renaming === b.id ? (
            <input autoFocus defaultValue={b.name} maxLength={60}
              onKeyDown={(e) => { if (e.key === "Enter") { onRename(b.id, e.currentTarget.value.trim()); setRenaming(null); } if (e.key === "Escape") setRenaming(null); }}
              onBlur={() => setRenaming(null)} className="min-w-0 flex-1 rounded-md border border-[#1F7AE0] bg-white px-2 py-0.5 text-sm outline-none" />
          ) : (
            <button type="button" disabled={locked && !folder} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => (folder ? toggle(b.id) : onSelect(b.id))} aria-expanded={folder ? open : undefined}>
              {folder && <span aria-hidden className={`inline-block w-3 text-[10px] text-[#81878C] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>}
              <Icon folder={folder} open={open} />
              <span className="truncate">{b.name}</span>
              <span className="ml-auto shrink-0 text-xs text-[#81878C]">{folder ? children.length : b.symbols.length}</span>
            </button>
          )}
          <button type="button" aria-label={`Actions for ${b.name}`} aria-expanded={menu === b.id} onClick={() => setMenu(menu === b.id ? null : b.id)}
            className="shrink-0 rounded-md px-1.5 text-[#81878C] hover:bg-white hover:text-[#17408B] lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100">⋯</button>
        </div>
        {menu === b.id && (
          <div className="flex flex-wrap gap-0.5 pb-1" style={{ paddingLeft: 22 + depth * 14 }}>
            {folder && <button className={btn} disabled={locked} onClick={() => startAdd(b.id, "folder")}>+ Folder</button>}
            {folder && <button className={btn} disabled={locked} onClick={() => startAdd(b.id, "basket")}>+ Basket</button>}
            <button className={btn} disabled={locked} onClick={() => { setRenaming(b.id); setMenu(null); }}>Rename</button>
            <button className={btn} disabled={locked} onClick={() => { setMoving(b.id); setMenu(null); }}>Move</button>
            <button className={`${btn} !text-[#E5484D] hover:!bg-[#FDECEC]`} disabled={locked} onClick={() => { setMenu(null); onDelete(b.id); }}>Delete</button>
          </div>
        )}
        {moving === b.id && (
          <div className="flex items-center gap-1.5 pb-1.5" style={{ paddingLeft: 22 + depth * 14 }}>
            <select autoFocus defaultValue={b.parent_id ?? ""} className="min-w-0 flex-1 rounded-md border border-[#D5E3F7] bg-white px-2 py-1 text-xs"
              onChange={(e) => { onMove(b.id, e.target.value || null); setMoving(null); }} onBlur={() => setMoving(null)}>
              <option value="">Top level</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{folderPath(t.id)}</option>)}
            </select>
          </div>
        )}
        {folder && open && (
          <ul>
            {children.map((c) => renderNode(c, depth + 1))}
            {addRow(b.id, depth + 1)}
            {children.length === 0 && adding?.parent !== b.id && <li className="py-1 text-xs text-[#81878C]" style={{ paddingLeft: 30 + depth * 14 }}>Empty folder</li>}
          </ul>
        )}
      </li>
    );
  };

  const top = kids.get(null) ?? [];
  return (
    <nav aria-label="Baskets and folders" className="rounded-2xl border border-white/80 bg-white/60 p-2.5 shadow-[0_18px_50px_-24px_rgba(26,115,232,0.35)] backdrop-blur lg:sticky lg:top-3 lg:self-start">
      <button type="button" onClick={() => onSelect(HOME_ID)} disabled={locked}
        className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm disabled:opacity-60 ${activeId === HOME_ID ? "bg-[#DCEBFF] font-medium text-[#17408B]" : "hover:bg-[#EEF4FD]"}`}>
        <span aria-hidden>⌂</span> Home
      </button>
      <ul>
        {top.map((b) => renderNode(b, 0))}
        {addRow(null, 0)}
      </ul>
      {top.length === 0 && !adding && <p className="px-2 py-3 text-xs text-[#81878C]">No baskets yet. Add a folder or basket below.</p>}
      <div className="mt-2 flex gap-1 border-t border-[#E3ECF8] pt-2">
        <button className={btn} disabled={locked} onClick={() => startAdd(null, "folder")}>+ Folder</button>
        <button className={btn} disabled={locked} onClick={() => startAdd(null, "basket")}>+ Basket</button>
      </div>
      <p className="px-2 pt-1 text-[11px] text-[#81878C]">{items.filter((b) => b.kind !== "folder").length} baskets · {items.reduce((n, b) => n + (b.kind === "folder" ? 0 : b.symbols.length), 0)} stocks</p>
    </nav>
  );
}

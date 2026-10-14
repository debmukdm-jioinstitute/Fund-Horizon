// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useAuth } from "@/components/AuthContext";
import {
  bulkReassign,
  createView,
  deleteView,
  downloadCsv,
  fetchPage,
  fetchViews,
  patchView,
  type ListEntity,
  type SavedView,
} from "../../lib/crmListApi";
import OwnerAvatar, { useOwners } from "./OwnerAvatar";

export interface ListColumn<T> {
  id: string;
  header: string;
  /** Server sort key; omit to make the column unsortable. */
  sortKey?: string;
  hiddenByDefault?: boolean;
  cell: (row: T) => React.ReactNode;
}

export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "owner" | "toggle";
  options?: { value: string; label: string }[];
}

interface Props<T extends { id: string }> {
  entity: ListEntity;
  columns: ListColumn<T>[];
  filters?: FilterDef[];
  /** Where a row's primary link goes. */
  rowHref?: (row: T) => string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Bumped by the parent after it creates a record, to reload. */
  reloadKey?: number;
}

const BULK_FIELD: Partial<Record<ListEntity, string>> = {
  households: "households",
  leads: "leads",
  opportunities: "opportunities",
  activities: "activities",
};

const PAGE_SIZES = [10, 25, 50, 100];
const surface = "bg-white dark:bg-[#10151C] border-[#E4E9EF] dark:border-[#2B3644]";
const muted = "text-[#536176] dark:text-[#A8B4C4]";
const ctl =
  "px-2.5 py-1.5 text-xs rounded border bg-white dark:bg-[#171E27] border-[#E4E9EF] dark:border-[#2B3644] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]";

export default function ListView<T extends { id: string }>({
  entity, columns, filters = [], rowHref, searchPlaceholder = "Search…", emptyText = "Nothing matches these filters.", reloadKey = 0,
}: Props<T>) {
  const { customer } = useAuth();
  const isAdmin = customer?.role === "admin";
  const owners = useOwners();

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<string | undefined>();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(columns.filter((c) => c.hiddenByDefault).map((c) => [c.id, false])),
  );
  const [selection, setSelection] = useState<RowSelectionState>({});

  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState("");
  const [savingName, setSavingName] = useState<string | null>(null);
  const [saveDefault, setSaveDefault] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [colMenu, setColMenu] = useState(false);

  const appliedDefault = useRef(false);
  const requestId = useRef(0);
  const bulkEntity = BULK_FIELD[entity];

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const visibleColumnIds = useMemo(() => columns.filter((c) => visibility[c.id] !== false).map((c) => c.id), [columns, visibility]);

  const applyView = useCallback(
    (v: SavedView | null) => {
      setActiveViewId(v?.id ?? "");
      setFilterValues(v?.filters ?? {});
      setPageIndex(0);
      setSelection({});
      setVisibility(
        v && v.columns.length
          ? Object.fromEntries(columns.map((c) => [c.id, v.columns.includes(c.id)]))
          : Object.fromEntries(columns.filter((c) => c.hiddenByDefault).map((c) => [c.id, false])),
      );
    },
    [columns],
  );

  const loadViews = useCallback(async () => {
    try {
      const vs = await fetchViews(entity);
      setViews(vs);
      if (!appliedDefault.current) {
        appliedDefault.current = true;
        const def = vs.find((v) => v.is_default);
        if (def) applyView(def);
      }
    } catch {
      /* views are optional: the list still works */
    }
  }, [entity, applyView]);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage<T>(entity, {
        limit: pageSize, offset: pageIndex * pageSize, sort, q: debouncedQ || undefined, filters: filterValues,
      });
      if (id !== requestId.current) return; // a newer request superseded this one
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : "Could not load this list");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [entity, pageSize, pageIndex, sort, debouncedQ, filterValues]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  useEffect(() => setPageIndex(0), [debouncedQ, sort, pageSize]);

  const tableColumns = useMemo<ColumnDef<T>[]>(() => {
    const defs: ColumnDef<T>[] = columns.map((c) => ({
      id: c.id,
      header: c.header,
      cell: ({ row }) => c.cell(row.original),
      meta: { sortKey: c.sortKey },
    }));
    if (isAdmin && bulkEntity) {
      defs.unshift({
        id: "_select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all rows on this page"
            checked={rows.length > 0 && rows.every((r) => selection[r.id])}
            onChange={(e) => setSelection(e.target.checked ? Object.fromEntries(rows.map((r) => [r.id, true])) : {})}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Select row"
            checked={!!selection[row.original.id]}
            onChange={(e) => setSelection((s) => ({ ...s, [row.original.id]: e.target.checked }))}
          />
        ),
      });
    }
    return defs;
  }, [columns, isAdmin, bulkEntity, rows, selection]);

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { columnVisibility: visibility, rowSelection: selection },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    manualPagination: true,
    manualSorting: true,
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const activeView = views.find((v) => v.id === activeViewId);

  const toggleSort = (key: string) =>
    setSort((s) => (s === key ? `-${key}` : s === `-${key}` ? undefined : key));

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const saveView = async () => {
    const name = (savingName ?? "").trim();
    if (!name) return;
    try {
      const v = await createView({ entity, name, filters: filterValues, columns: visibleColumnIds, is_default: saveDefault });
      await loadViews();
      setActiveViewId(v.id);
      setSavingName(null);
      setSaveDefault(false);
      flash(`Saved view “${v.name}”.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the view");
    }
  };

  const updateView = async () => {
    if (!activeView || activeView.builtin) return;
    try {
      await patchView(activeView.id, { filters: filterValues, columns: visibleColumnIds });
      await loadViews();
      flash(`Updated “${activeView.name}”.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the view");
    }
  };

  const removeView = async () => {
    if (!activeView || activeView.builtin) return;
    try {
      await deleteView(activeView.id);
      applyView(null);
      await loadViews();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the view");
    }
  };

  const toggleDefault = async () => {
    if (!activeView || activeView.builtin) return;
    await patchView(activeView.id, { is_default: !activeView.is_default }).catch(() => undefined);
    loadViews();
  };

  const doReassign = async () => {
    if (!bulkEntity || !selectedIds.length) return;
    try {
      const r = await bulkReassign(bulkEntity, selectedIds, reassignTo || null);
      flash(`Reassigned ${r.updated} record${r.updated === 1 ? "" : "s"}.`);
      setSelection({});
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reassign");
    }
  };

  const exportCsv = () =>
    downloadCsv(entity, { sort, q: debouncedQ || undefined, filters: filterValues }).catch((e) =>
      setError(e instanceof Error ? e.message : "Export failed"),
    );

  return (
    <section className={`rounded-lg border ${surface} p-4 space-y-3`} aria-label={`${entity} list`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${entity}-view`}>List view</label>
        <select
          id={`${entity}-view`}
          value={activeViewId}
          onChange={(e) => applyView(views.find((v) => v.id === e.target.value) ?? null)}
          className={ctl}
        >
          <option value="">All records</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}{v.is_default ? " (default)" : ""}
            </option>
          ))}
        </select>
        {activeView && !activeView.builtin && (
          <>
            <button type="button" onClick={updateView} className={`${ctl} hover:bg-[#F7F9FB] dark:hover:bg-[#1D2733]`}>Update view</button>
            <button type="button" onClick={toggleDefault} className={`${ctl} hover:bg-[#F7F9FB] dark:hover:bg-[#1D2733]`}>
              {activeView.is_default ? "Unset default" : "Make default"}
            </button>
            <button type="button" onClick={removeView} className={`${ctl} text-rose-700 dark:text-rose-300`}>Delete view</button>
          </>
        )}
        {savingName === null ? (
          <button type="button" onClick={() => setSavingName("")} className={`${ctl} hover:bg-[#F7F9FB] dark:hover:bg-[#1D2733]`}>
            Save as view…
          </button>
        ) : (
          <span className="inline-flex items-center gap-2">
            <input
              autoFocus
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveView()}
              placeholder="View name"
              aria-label="View name"
              className={ctl}
            />
            <label className={`text-xs inline-flex items-center gap-1 ${muted}`}>
              <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} /> Default
            </label>
            <button type="button" onClick={saveView} disabled={!savingName.trim()} className={`${ctl} bg-[#006F64] text-white border-[#006F64] disabled:opacity-50`}>Save</button>
            <button type="button" onClick={() => setSavingName(null)} className={ctl}>Cancel</button>
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setColMenu((o) => !o)} aria-expanded={colMenu} className={ctl}>Columns</button>
            {colMenu && (
              <div className={`absolute right-0 z-20 mt-1 w-48 rounded border p-2 shadow-lg ${surface}`}>
                {columns.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 py-0.5 text-xs">
                    <input
                      type="checkbox"
                      checked={visibility[c.id] !== false}
                      onChange={(e) => setVisibility((v) => ({ ...v, [c.id]: e.target.checked }))}
                    />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={exportCsv} className={`${ctl} hover:bg-[#F7F9FB] dark:hover:bg-[#1D2733]`}>Export CSV</button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search this list"
          className={`${ctl} w-56`}
        />
        {filters.map((f) => {
          const value = filterValues[f.key] ?? "";
          const set = (v: string) => {
            setFilterValues((fv) => {
              const next = { ...fv };
              if (v) next[f.key] = v;
              else delete next[f.key];
              return next;
            });
            setPageIndex(0);
          };
          if (f.type === "toggle") {
            return (
              <label key={f.key} className={`inline-flex items-center gap-1.5 text-xs ${muted}`}>
                <input type="checkbox" checked={value === "true"} onChange={(e) => set(e.target.checked ? "true" : "")} />
                {f.label}
              </label>
            );
          }
          const options =
            f.type === "owner"
              ? [{ value: "me", label: "Me" }, ...owners.filter((o) => o.id !== customer?.id).map((o) => ({ value: o.id, label: o.name }))]
              : (f.options ?? []);
          return (
            <select key={f.key} value={value} onChange={(e) => set(e.target.value)} aria-label={f.label} className={ctl}>
              <option value="">{f.label}: all</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          );
        })}
        {(Object.keys(filterValues).length > 0 || q) && (
          <button type="button" onClick={() => { setFilterValues({}); setQ(""); setActiveViewId(""); }} className={`text-xs underline ${muted}`}>
            Clear filters
          </button>
        )}
      </div>

      {isAdmin && bulkEntity && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-[#006F64]/40 bg-[#E6F4F2] dark:bg-[#0F2A27] px-3 py-2 text-xs">
          <strong>{selectedIds.length} selected</strong>
          <label className="sr-only" htmlFor={`${entity}-reassign`}>New owner</label>
          <select id={`${entity}-reassign`} value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className={ctl}>
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button type="button" onClick={doReassign} className={`${ctl} bg-[#006F64] text-white border-[#006F64]`}>Reassign owner</button>
          <button type="button" onClick={() => setSelection({})} className={ctl}>Clear</button>
        </div>
      )}

      {notice && <p role="status" className="text-xs font-medium text-[#006F64] dark:text-[#75E1CE]">{notice}</p>}
      {error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">{error}</p>}

      <div className="overflow-x-auto" aria-busy={loading}>
        <table className="w-full text-left text-xs">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-[#E4E9EF] dark:border-[#2B3644]">
                {hg.headers.map((h) => {
                  const sortKey = (h.column.columnDef.meta as { sortKey?: string } | undefined)?.sortKey;
                  const dir = sort === sortKey ? "ascending" : sort === `-${sortKey}` ? "descending" : "none";
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={sortKey ? dir : undefined}
                      className={`px-2 py-2 font-semibold whitespace-nowrap ${muted}`}
                    >
                      {sortKey ? (
                        <button type="button" onClick={() => toggleSort(sortKey)} className="inline-flex items-center gap-1 hover:text-[#172033] dark:hover:text-[#EDF2F7]">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <span aria-hidden="true">{dir === "ascending" ? "▲" : dir === "descending" ? "▼" : ""}</span>
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td colSpan={table.getVisibleLeafColumns().length} className="px-2 py-2">
                    <div className="h-5 rounded bg-[#E4E9EF]/70 dark:bg-[#2B3644]/70 animate-pulse" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className={`px-2 py-10 text-center ${muted}`}>{emptyText}</td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-[#E4E9EF]/70 dark:border-[#2B3644]/70 hover:bg-[#F7F9FB] dark:hover:bg-[#171E27]">
                  {row.getVisibleCells().map((cell, i) => (
                    <td key={cell.id} className="px-2 py-2 align-middle text-[#172033] dark:text-[#EDF2F7]">
                      {rowHref && i === (isAdmin && bulkEntity ? 1 : 0) ? (
                        <Link href={rowHref(row.original)} className="font-semibold hover:underline text-[#006F64] dark:text-[#75E1CE]">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </Link>
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={`flex flex-wrap items-center justify-between gap-2 text-xs ${muted}`}>
        <span>
          {total === 0 ? "0 records" : `${pageIndex * pageSize + 1}–${Math.min(total, (pageIndex + 1) * pageSize)} of ${total}`}
        </span>
        <span className="inline-flex items-center gap-2">
          <label className="inline-flex items-center gap-1">
            Rows
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={ctl}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)} className={`${ctl} disabled:opacity-40`}>Previous</button>
          <span>Page {pageIndex + 1} of {pageCount}</span>
          <button type="button" disabled={pageIndex + 1 >= pageCount} onClick={() => setPageIndex((p) => p + 1)} className={`${ctl} disabled:opacity-40`}>Next</button>
        </span>
      </div>
    </section>
  );
}

export { OwnerAvatar };

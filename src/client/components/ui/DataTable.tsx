// Data table: header, rows, optional selection, row click, loading skeleton and empty state
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { Skeleton } from "./Spinner";
import type { Pagination as PaginationInfo } from "@shared/types";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  selection,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
  caption?: string;
}) {
  const data = rows ?? [];
  const allSelected = selection && data.length > 0 && data.every((r) => selection.selected.has(rowKey(r)));
  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) data.forEach((r) => next.delete(rowKey(r)));
    else data.forEach((r) => next.add(rowKey(r)));
    selection.onChange(next);
  };
  const toggle = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-surface-muted">
            {selection && (
              <th className="w-10 py-2.5 pl-5 pr-1">
                <input type="checkbox" aria-label="Select all on this page" checked={Boolean(allSelected)} onChange={toggleAll} className="h-4 w-4 accent-[rgb(var(--brand))]" />
              </th>
            )}
            {columns.map((c, i) => (
              <th key={c.key} scope="col" className={cn("whitespace-nowrap py-2.5 pr-4 text-xs font-medium text-ink-subtle", i === 0 && !selection && "pl-5", c.headerClassName)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {selection && <td className="py-3.5 pl-5" />}
                  {columns.map((c, j) => (
                    <td key={c.key} className={cn("py-3.5 pr-4", j === 0 && !selection && "pl-5")}>
                      <Skeleton className="h-3.5 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : data.map((row) => {
                const id = rowKey(row);
                const selected = selection?.selected.has(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn("border-b border-line last:border-0 transition-colors", onRowClick && "cursor-pointer hover:bg-surface-muted", selected && "bg-brand-soft/50")}
                  >
                    {selection && (
                      <td className="py-3 pl-5 pr-1" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Select row" checked={Boolean(selected)} onChange={() => toggle(id)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                      </td>
                    )}
                    {columns.map((c, j) => (
                      <td key={c.key} className={cn("py-3 pr-4 align-middle text-ink", j === 0 && !selection && "pl-5", c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && empty}
    </div>
  );
}

export function Pagination({ pagination, onPage }: { pagination: PaginationInfo | undefined; onPage: (page: number) => void }) {
  if (!pagination || pagination.total <= pagination.pageSize) return null;
  const { page, pageSize, total, totalPages } = pagination;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-ink-subtle" aria-label="Pagination">
      <span className="tabular">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 hover:bg-surface-sunken disabled:opacity-40" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <span className="tabular px-2">
          Page {page} of {totalPages}
        </span>
        <button className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 hover:bg-surface-sunken disabled:opacity-40" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

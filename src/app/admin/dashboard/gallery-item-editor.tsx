"use client";

import { ArrowDown, ArrowUp, Check, Save } from "lucide-react";

import type { AdminGalleryItem } from "@/lib/gallery";

import { AdminVideoPreview } from "./admin-video-preview";

export type EditableField = "title" | "client" | "type" | "year";

type Feedback = { kind: "saving" | "success" | "error"; message: string } | undefined;

const fields: Array<{ key: EditableField; label: string }> = [
  { key: "title", label: "Title" },
  { key: "client", label: "Client" },
  { key: "type", label: "Type" },
  { key: "year", label: "Year" },
];

const statusStyles = {
  processing: "border-amber-700 text-amber-800",
  published: "border-emerald-700 text-emerald-800",
  failed: "border-red-700 text-red-800",
  archived: "border-zinc-500 text-zinc-700",
};

export function GalleryItemEditor({
  item,
  position,
  total,
  dirty,
  feedback,
  moving,
  reorderDisabled,
  onChange,
  onSave,
  onMove,
}: {
  item: AdminGalleryItem;
  position: number;
  total: number;
  dirty: boolean;
  feedback: Feedback;
  moving: boolean;
  reorderDisabled: boolean;
  onChange: (field: EditableField | "status", value: string) => void;
  onSave: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const valid = fields.every(({ key }) => item[key].trim());
  const saving = feedback?.kind === "saving";
  const visibilityEditable = item.status === "published" || item.status === "archived";

  return (
    <article className="grid gap-5 py-6 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
      <div className="self-start">
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-black/60">{String(position + 1).padStart(2, "0")}</span>
          <h3 className="break-all font-bold">{item.slug}</h3>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`border px-2 py-1 text-[11px] uppercase tracking-[0.12em] ${statusStyles[item.status]}`}>
            {item.status}
          </span>
          {dirty ? <span className="text-xs font-bold">Unsaved</span> : null}
        </div>
        {item.processing_error ? <p className="mt-3 text-xs leading-5 text-red-700">{item.processing_error}</p> : null}
        <AdminVideoPreview item={item} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {fields.map(({ key, label }) => (
          <label key={key} className="flex min-w-0 flex-col gap-1 text-xs uppercase tracking-[0.08em]">
            {label}
            <input
              required
              disabled={saving}
              value={item[key]}
              onChange={(event) => onChange(key, event.target.value)}
              className="min-h-11 min-w-0 border border-black bg-transparent px-3 py-2 text-sm normal-case outline-none transition-colors focus:bg-white focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1"
            />
          </label>
        ))}
        <label className="flex min-w-0 flex-col gap-1 text-xs uppercase tracking-[0.08em]">
          Visibility
          {visibilityEditable ? (
            <select
              disabled={saving}
              value={item.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="min-h-11 border border-black bg-transparent px-3 py-2 text-sm normal-case outline-none focus:bg-white focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1"
            >
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          ) : (
            <div className="flex min-h-11 items-center border border-black/30 px-3 text-sm normal-case text-black/60">
              Worker controlled
            </div>
          )}
        </label>
      </div>

      <div className="flex items-end justify-between gap-3 lg:flex-col lg:items-stretch">
        <div className="flex border border-black">
          <button
            type="button"
            title={reorderDisabled ? "Save changes before reordering" : "Move clip up"}
            aria-label={`Move ${item.slug} up`}
            disabled={position === 0 || reorderDisabled}
            onClick={() => onMove("up")}
            className="grid size-11 place-items-center hover:bg-black hover:text-white focus-visible:z-10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp aria-hidden="true" size={17} />
          </button>
          <button
            type="button"
            title={reorderDisabled ? "Save changes before reordering" : "Move clip down"}
            aria-label={`Move ${item.slug} down`}
            disabled={position === total - 1 || reorderDisabled}
            onClick={() => onMove("down")}
            className="grid size-11 place-items-center border-l border-black hover:bg-black hover:text-white focus-visible:z-10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDown aria-hidden="true" size={17} />
          </button>
        </div>
        <button
          type="button"
          disabled={!dirty || !valid || saving || moving}
          onClick={onSave}
          className="flex min-h-11 min-w-28 items-center justify-center gap-2 border border-black bg-black px-4 text-sm text-white hover:bg-transparent hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-black disabled:opacity-35"
        >
          {feedback?.kind === "success" ? <Check aria-hidden="true" size={17} /> : <Save aria-hidden="true" size={17} />}
          {saving ? "Saving..." : "Save"}
        </button>
        <p aria-live="polite" className={`min-h-4 max-w-40 text-right text-xs ${feedback?.kind === "error" ? "text-red-700" : ""}`}>
          {feedback?.message ?? ""}
        </p>
      </div>
    </article>
  );
}
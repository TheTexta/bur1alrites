"use client";

import { Images, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AdminGalleryItem } from "@/lib/gallery";

import { AdminSessionExpiredError, requestAdminJson } from "./admin-api";
import { AdminHeader } from "./admin-header";
import { GalleryItemEditor, type EditableField } from "./gallery-item-editor";
import { UploadForm } from "./upload-form";

type Feedback = { kind: "saving" | "success" | "error"; message: string };
type View = "gallery" | "upload";

const editableFields = ["title", "client", "type", "year"] as const;

function isDirty(item: AdminGalleryItem, saved: AdminGalleryItem | undefined) {
  return Boolean(saved && (editableFields.some((field) => item[field] !== saved[field]) || item.status !== saved.status));
}

export function GalleryEditor() {
  const router = useRouter();
  const [items, setItems] = useState<AdminGalleryItem[]>([]);
  const [savedItems, setSavedItems] = useState<AdminGalleryItem[]>([]);
  const [view, setView] = useState<View>("gallery");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [movingSlug, setMovingSlug] = useState("");
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});

  const hasUnsavedChanges = items.some((item) => isDirty(item, savedItems.find((saved) => saved.slug === item.slug)));

  useEffect(() => {
    let active = true;
    requestAdminJson<{ items: AdminGalleryItem[] }>("/api/admin/gallery")
      .then(({ items: nextItems }) => {
        if (!active) return;
        setItems(nextItems);
        setSavedItems(nextItems);
      })
      .catch((error: Error) => {
        if (!active) return;
        if (error instanceof AdminSessionExpiredError) {
          router.replace("/admin?expired=1&next=/admin/dashboard");
          return;
        }
        setLoadError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  function changeView(nextView: View) {
    if (nextView === view) return;
    if (hasUnsavedChanges && !window.confirm("Discard unsaved gallery changes?")) return;
    if (hasUnsavedChanges) setItems(savedItems);
    setView(nextView);
    if (nextView === "gallery") {
      setLoading(true);
      setLoadError("");
      requestAdminJson<{ items: AdminGalleryItem[] }>("/api/admin/gallery")
        .then(({ items: nextItems }) => {
          setItems(nextItems);
          setSavedItems(nextItems);
        })
        .catch((error: Error) => {
          if (error instanceof AdminSessionExpiredError) {
            router.replace("/admin?expired=1&next=/admin/dashboard");
            return;
          }
          setLoadError(error.message);
        })
        .finally(() => setLoading(false));
    }
  }

  function updateItem(slug: string, field: EditableField | "status", value: string) {
    setItems((current) => current.map((item) => {
      if (item.slug !== slug) return item;
      if (field === "status" && (value === "published" || value === "archived")) {
        return { ...item, status: value };
      }
      if (field !== "status") return { ...item, [field]: value };
      return item;
    }));
    setFeedback((current) => {
      const next = { ...current };
      delete next[slug];
      return next;
    });
  }

  async function saveItem(item: AdminGalleryItem) {
    setFeedback((current) => ({ ...current, [item.slug]: { kind: "saving", message: "Saving..." } }));
    try {
      const body = {
        title: item.title,
        client: item.client,
        type: item.type,
        year: item.year,
        ...(item.status === "published" || item.status === "archived" ? { status: item.status } : {}),
      };
      const { item: saved } = await requestAdminJson<{ item: AdminGalleryItem }>(
        `/api/admin/gallery/${encodeURIComponent(item.slug)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      setItems((current) => current.map((currentItem) => currentItem.slug === saved.slug ? saved : currentItem));
      setSavedItems((current) => current.map((currentItem) => currentItem.slug === saved.slug ? saved : currentItem));
      setFeedback((current) => ({ ...current, [item.slug]: { kind: "success", message: "Saved" } }));
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        router.replace("/admin?expired=1&next=/admin/dashboard");
        return;
      }
      setFeedback((current) => ({
        ...current,
        [item.slug]: { kind: "error", message: error instanceof Error ? error.message : "Could not save." },
      }));
    }
  }

  async function moveItem(slug: string, direction: "up" | "down") {
    if (hasUnsavedChanges) return;
    setMovingSlug(slug);
    setFeedback((current) => ({ ...current, [slug]: { kind: "saving", message: "Moving..." } }));
    try {
      const { items: reordered } = await requestAdminJson<{ items: AdminGalleryItem[] }>("/api/admin/gallery/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, direction }),
      });
      setItems(reordered);
      setSavedItems(reordered);
      setFeedback((current) => ({ ...current, [slug]: { kind: "success", message: "Order updated" } }));
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        router.replace("/admin?expired=1&next=/admin/dashboard");
        return;
      }
      setFeedback((current) => ({
        ...current,
        [slug]: { kind: "error", message: error instanceof Error ? error.message : "Could not move item." },
      }));
    } finally {
      setMovingSlug("");
    }
  }

  async function refreshAfterUpload() {
    const { items: nextItems } = await requestAdminJson<{ items: AdminGalleryItem[] }>("/api/admin/gallery");
    setItems(nextItems);
    setSavedItems(nextItems);
    setView("gallery");
  }

  return (
    <>
      <AdminHeader hasUnsavedChanges={hasUnsavedChanges} />
      <nav aria-label="Admin views" className="mt-6 inline-grid grid-cols-2 border border-black">
        <button
          type="button"
          aria-current={view === "gallery" ? "page" : undefined}
          onClick={() => changeView("gallery")}
          className={`flex min-h-11 items-center gap-2 px-4 text-sm focus-visible:z-10 focus-visible:outline-2 ${view === "gallery" ? "bg-black text-white" : "hover:bg-white"}`}
        >
          <Images aria-hidden="true" size={17} /> Gallery
        </button>
        <button
          type="button"
          aria-current={view === "upload" ? "page" : undefined}
          onClick={() => changeView("upload")}
          className={`flex min-h-11 items-center gap-2 border-l border-black px-4 text-sm focus-visible:z-10 focus-visible:outline-2 ${view === "upload" ? "bg-black text-white" : "hover:bg-white"}`}
        >
          <Plus aria-hidden="true" size={17} /> Add clip
        </button>
      </nav>

      {view === "gallery" ? (
        <section className="mt-10" aria-labelledby="gallery-heading">
          <div className="flex items-end justify-between gap-4 border-b border-black pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em]">Library</p>
              <h2 id="gallery-heading" className="mt-2 text-3xl">Gallery</h2>
            </div>
            <p className="text-sm tabular-nums">{items.length} clips</p>
          </div>
          {loading ? <p className="py-10 text-sm" aria-live="polite">Loading gallery...</p> : null}
          {loadError ? <p className="py-10 text-sm text-red-700" role="alert">{loadError}</p> : null}
          {!loading && !loadError && items.length === 0 ? <p className="py-10 text-sm">No gallery clips yet.</p> : null}
          <div className="divide-y divide-black border-b border-black">
            {items.map((item, index) => (
              <GalleryItemEditor
                key={item.slug}
                item={item}
                position={index}
                total={items.length}
                dirty={isDirty(item, savedItems.find((savedItem) => savedItem.slug === item.slug))}
                feedback={feedback[item.slug]}
                moving={movingSlug === item.slug}
                reorderDisabled={hasUnsavedChanges || Boolean(movingSlug)}
                onChange={(field, value) => updateItem(item.slug, field, value)}
                onSave={() => saveItem(item)}
                onMove={(direction) => moveItem(item.slug, direction)}
              />
            ))}
          </div>
        </section>
      ) : (
        <UploadForm onUploaded={refreshAfterUpload} />
      )}
    </>
  );
}
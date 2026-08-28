"use client";

import { useEffect, useState } from "react";

type Item = {
  slug: string;
  title: string;
  client: string;
  type: string;
  year: string;
  status?: string;
};

const fields = ["title", "client", "type", "year"] as const;

export function GalleryEditor() {
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("Loading gallery...");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/gallery")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load gallery.");
        return response.json();
      })
      .then(({ items: nextItems }) => {
        setItems(nextItems);
        setMessage(nextItems.length ? "" : "Apply the gallery migration to load items.");
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  function updateItem(slug: string, field: (typeof fields)[number], value: string) {
    setItems((current) => current.map((item) => item.slug === slug ? { ...item, [field]: value } : item));
  }

  async function saveItem(item: Item) {
    setMessage(`Saving ${item.slug}...`);
    const response = await fetch(`/api/admin/gallery/${encodeURIComponent(item.slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item),
    });

    setMessage(response.ok ? `${item.slug} saved.` : "Could not save changes.");
  }

  return (
    <section className="mt-10">
      <form
        className="mb-10 grid gap-3 border-b border-black pb-10 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setUploading(true);
          setMessage("Uploading source clip...");
          const response = await fetch("/api/admin/upload", { method: "POST", body: new FormData(event.currentTarget) });
          const body = await response.json().catch(() => null);
          setMessage(response.ok ? `${body.slug} queued for processing.` : body?.error ?? "Upload failed.");
          setUploading(false);
          if (response.ok) event.currentTarget.reset();
        }}
      >
        <label className="flex flex-col gap-1 text-xs uppercase sm:col-span-2">Video<input required name="file" type="file" accept="video/*" className="py-2 text-sm normal-case" /></label>
        {[["slug", "Slug"], ["title", "Title"], ["client", "Client"], ["type", "Type"], ["year", "Year"], ["width", "Width"], ["height", "Height"]].map(([name, label]) => (
          <label key={name} className="flex flex-col gap-1 text-xs uppercase">{label}<input required name={name} defaultValue={name === "type" ? "clip" : undefined} className="border border-black bg-transparent px-2 py-2 text-sm normal-case outline-none focus:bg-white" /></label>
        ))}
        <button disabled={uploading} className="border border-black px-3 py-2 text-left text-sm disabled:opacity-50">{uploading ? "Uploading..." : "Upload clip"}</button>
      </form>
      {message ? <p className="mb-5 text-sm">{message}</p> : null}
      <div className="divide-y divide-black border-y border-black">
        {items.map((item) => (
          <article key={item.slug} className="grid gap-4 py-5 lg:grid-cols-[1fr_3fr_auto] lg:items-end">
            <div>
              <p className="font-bold">{item.slug}</p>
              <p className="text-xs uppercase">{item.status ?? "published"}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((field) => (
                <label key={field} className="flex flex-col gap-1 text-xs uppercase">
                  {field}
                  <input
                    value={item[field]}
                    onChange={(event) => updateItem(item.slug, field, event.target.value)}
                    className="border border-black bg-transparent px-2 py-2 text-sm normal-case outline-none focus:bg-white"
                  />
                </label>
              ))}
            </div>
            <button type="button" onClick={() => saveItem(item)} className="border border-black px-3 py-2 text-left text-sm">
              Save
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
"use client";

import { CheckCircle2, Film, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";

import { AdminSessionExpiredError, requestAdminJson } from "./admin-api";

type VideoMetadata = { width: number; height: number; name: string };
type UploadState = "idle" | "reading" | "uploading" | "success" | "error";

function slugify(value: string) {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function UploadForm({ onUploaded }: { onUploaded: () => Promise<void> }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const selectionId = useRef(0);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState("");

  async function readVideoMetadata(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const currentSelection = ++selectionId.current;
    setMetadata(null);
    setMessage("");
    if (!file) {
      setState("idle");
      return;
    }

    setState("reading");
    const slugInput = formRef.current?.elements.namedItem("slug");
    if (slugInput instanceof HTMLInputElement && !slugInput.value) slugInput.value = slugify(file.name);

    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => reject(new Error("Video metadata is unavailable."));
        video.src = objectUrl;
      });
      if (currentSelection !== selectionId.current) return;
      if (!dimensions.width || !dimensions.height) throw new Error("Video dimensions are unavailable.");
      setMetadata({ ...dimensions, name: file.name });
      setState("idle");
    } catch (error) {
      if (currentSelection !== selectionId.current) return;
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not read this video.");
    } finally {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!metadata) {
      setState("error");
      setMessage("Choose a video whose dimensions can be read.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("width", String(metadata.width));
    formData.set("height", String(metadata.height));
    setState("uploading");
    setMessage("Uploading source clip...");

    try {
      await requestAdminJson<{ item: unknown }>("/api/admin/upload", { method: "POST", body: formData });
      form.reset();
      setMetadata(null);
      setState("success");
      setMessage("Clip queued for processing.");
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        router.replace("/admin?expired=1&next=/admin/dashboard");
        return;
      }
      setState("error");
      setMessage(error instanceof Error ? error.message : "Upload failed.");
      return;
    }

    try {
      await onUploaded();
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        router.replace("/admin?expired=1&next=/admin/dashboard");
        return;
      }
      setState("success");
      setMessage("Clip queued. Open Gallery to retry loading it.");
    }
  }

  const busy = state === "reading" || state === "uploading";
  const fieldClass = "min-h-11 border border-black bg-transparent px-3 py-2 text-sm normal-case outline-none transition-colors focus:bg-white focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1";

  return (
    <section className="mt-10" aria-labelledby="upload-heading">
      <div className="border-b border-black pb-4">
        <p className="text-xs uppercase tracking-[0.18em]">New media</p>
        <h2 id="upload-heading" className="mt-2 text-3xl">Add clip</h2>
      </div>
      <form ref={formRef} onSubmit={submit} className="grid gap-10 py-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <fieldset className="min-w-0">
          <legend className="mb-5 text-xs uppercase tracking-[0.16em]">Source</legend>
          <label htmlFor="clip-file" className="flex min-h-52 cursor-pointer flex-col items-center justify-center border border-dashed border-black px-5 text-center hover:bg-white focus-within:bg-white">
            <Film aria-hidden="true" size={30} strokeWidth={1.4} />
            <span className="mt-4 text-sm font-bold">Choose video</span>
            <span className="mt-2 max-w-xs break-all text-xs text-black/60">{metadata?.name ?? "MOV video"}</span>
            <input id="clip-file" required name="file" type="file" accept="video/quicktime,.mov" onChange={readVideoMetadata} className="sr-only" />
          </label>
          <div className="mt-4 flex min-h-11 items-center justify-between border-y border-black py-3 text-sm">
            <span>Resolution</span>
            <span className="flex items-center gap-2 tabular-nums">
              {metadata ? <CheckCircle2 aria-hidden="true" size={16} /> : null}
              {state === "reading" ? "Reading..." : metadata ? `${metadata.width} x ${metadata.height}` : "Not detected"}
            </span>
          </div>
        </fieldset>

        <fieldset className="grid content-start gap-4 sm:grid-cols-2">
          <legend className="col-span-full mb-1 text-xs uppercase tracking-[0.16em]">Details</legend>
          {[
            ["slug", "Slug", "clip-name"],
            ["title", "Title", "Untitled"],
            ["client", "Client", "bur1alrites"],
            ["type", "Type", "clip"],
            ["year", "Year", String(new Date().getFullYear())],
          ].map(([name, label, placeholder]) => (
            <label key={name} htmlFor={`clip-${name}`} className="flex min-w-0 flex-col gap-1 text-xs uppercase tracking-[0.08em]">
              {label}
              <input
                id={`clip-${name}`}
                required
                name={name}
                placeholder={placeholder}
                defaultValue={name === "type" || name === "year" ? placeholder : undefined}
                className={fieldClass}
              />
            </label>
          ))}
          <button
            disabled={busy || !metadata}
            className="mt-2 flex min-h-12 items-center justify-center gap-2 border border-black bg-black px-4 text-sm text-white hover:bg-transparent hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-black disabled:opacity-35 sm:col-span-2"
          >
            <Upload aria-hidden="true" size={17} />
            {state === "uploading" ? "Uploading..." : "Upload clip"}
          </button>
          <p aria-live="polite" className={`min-h-5 text-sm sm:col-span-2 ${state === "error" ? "text-red-700" : ""}`}>
            {message}
          </p>
        </fieldset>
      </form>
    </section>
  );
}
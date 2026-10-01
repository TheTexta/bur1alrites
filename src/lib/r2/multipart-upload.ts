type PreparedUpload = { session: string; partSize: number; partCount: number };
type JsonRequest = <T>(input: RequestInfo | URL, init?: RequestInit) => Promise<T>;

export async function uploadMultipart(file: File, prepared: PreparedUpload, request: JsonRequest, progress: (percent: number) => void) {
  let nextPart = 1;
  let failed = false;
  const transferred = new Map<number, number>();
  const active = new Set<XMLHttpRequest>();
  const report = () => progress(Math.round([...transferred.values()].reduce((sum, bytes) => sum + bytes, 0) / file.size * 100));
  async function transfer(partNumber: number) {
    const start = (partNumber - 1) * prepared.partSize;
    const blob = file.slice(start, Math.min(start + prepared.partSize, file.size));
    for (let attempt = 0; attempt < 5; attempt++) {
      if (failed) throw new Error("Upload stopped.");
      try {
        const result = await request<{ parts: { partNumber: number; url: string }[] }>("/api/admin/upload", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: prepared.session, partNumbers: [partNumber] }),
        });
        if (failed) throw new Error("Upload stopped.");
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          active.add(xhr);
          xhr.open("PUT", result.parts[0].url);
          xhr.timeout = 15 * 60 * 1000;
          xhr.upload.onprogress = event => { transferred.set(partNumber, event.loaded); report(); };
          xhr.onload = () => {
            active.delete(xhr);
            if (xhr.status >= 200 && xhr.status < 300 && xhr.getResponseHeader("ETag")) resolve();
            else reject(new Error(xhr.status === 403 ? "R2 denied an upload part. Check upload access and CORS." : "An upload part failed. Check your connection and R2 CORS configuration."));
          };
          const disconnected = () => { active.delete(xhr); reject(new Error("The upload connection was interrupted.")); };
          xhr.onerror = disconnected;
          xhr.ontimeout = disconnected;
          xhr.onabort = disconnected;
          xhr.send(blob);
        });
        transferred.set(partNumber, blob.size);
        report();
        return;
      } catch (error) {
        transferred.set(partNumber, 0);
        report();
        if (attempt === 4 || failed || error instanceof Error && error.name === "AdminSessionExpiredError") throw error;
        await new Promise(resolve => setTimeout(resolve, [1000, 3000, 5000, 10000][attempt]));
      }
    }
  }
  const workers = Array.from({ length: Math.min(3, prepared.partCount) }, async () => {
    while (!failed && nextPart <= prepared.partCount) {
      const part = nextPart++;
      try { await transfer(part); }
      catch (error) { failed = true; for (const xhr of active) xhr.abort(); throw error; }
    }
  });
  const results = await Promise.allSettled(workers);
  const error = results.find(result => result.status === "rejected");
  if (error?.status === "rejected") throw error.reason;
}

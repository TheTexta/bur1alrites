import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_SOURCE_BYTES = 5 * 1024 ** 3;
export const UPLOAD_PART_BYTES = 32 * 1024 ** 2;
export const SOURCE_CONTENT_TYPES = { mov: "video/quicktime", mp4: "video/mp4" } as const;
export type UploadMetadata = { slug: string; title: string; client: string; type: string; year: string; width: number; height: number; extension: keyof typeof SOURCE_CONTENT_TYPES };
export type UploadSession = { id: string; uploadId: string; key: string; bucket: string; size: number; metadata: UploadMetadata; expires: number };

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(`bur1alrites-upload-v1:${value}`).digest();
}

export function signUploadSession(session: UploadSession, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function readUploadSession(token: unknown, secret: string, now = Date.now()): UploadSession {
  if (typeof token !== "string" || token.length > 16000) throw new Error("Invalid upload session.");
  const [payload, signed, extra] = token.split(".");
  if (!payload || !signed || extra) throw new Error("Invalid upload session.");
  const actual = Buffer.from(signed, "base64url");
  const expected = signature(payload, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid upload session.");
  const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as UploadSession;
  if (!session.id || !session.uploadId || !session.key || !session.bucket || !session.metadata || !Number.isSafeInteger(session.size) || session.size <= 0 || session.size > MAX_SOURCE_BYTES || !Number.isSafeInteger(session.expires) || session.expires <= now) throw new Error("The upload session expired or is invalid.");
  return session;
}

export function validateUploadParts(parts: { PartNumber?: number; Size?: number; ETag?: string }[], size: number) {
  const expectedCount = Math.ceil(size / UPLOAD_PART_BYTES);
  const sorted = [...parts].sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
  if (sorted.length !== expectedCount || sorted.some((part, index) => !part.ETag || part.PartNumber !== index + 1 || part.Size !== Math.min(UPLOAD_PART_BYTES, size - index * UPLOAD_PART_BYTES))) throw new Error("Uploaded parts do not match the expected video size.");
  return sorted.map(({ PartNumber, ETag }) => ({ PartNumber, ETag }));
}

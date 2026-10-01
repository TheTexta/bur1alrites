import { describe, expect, it } from "vitest";
import { MAX_SOURCE_BYTES, UPLOAD_PART_BYTES, signUploadSession, readUploadSession, validateUploadParts, type UploadSession } from "./upload-session";

const session: UploadSession = { id: "id", uploadId: "r2-id", key: "portfolio-images/incoming/id.mov", bucket: "bur1alrites", size: 42, expires: 2000, metadata: { slug: "clip", title: "Clip", client: "Client", type: "clip", year: "2026", width: 1920, height: 1080, extension: "mov" } };
describe("upload authorization and part validation", () => {
  it("binds upload identity, size and metadata to a server signature", () => {
    const token = signUploadSession(session, "secret");
    expect(readUploadSession(token, "secret", 1000)).toEqual(session);
    const altered = `${Buffer.from(JSON.stringify({ ...session, size: 1 })).toString("base64url")}.${token.split(".")[1]}`;
    expect(() => readUploadSession(altered, "secret", 1000)).toThrow();
    expect(() => readUploadSession(token, "another-secret", 1000)).toThrow();
  });
  it("rejects expired, oversized and malformed sessions", () => {
    expect(() => readUploadSession(signUploadSession(session, "secret"), "secret", 2000)).toThrow();
    expect(() => readUploadSession(signUploadSession({ ...session, size: MAX_SOURCE_BYTES + 1 }, "secret"), "secret", 1000)).toThrow();
    expect(() => readUploadSession("invalid", "secret", 1000)).toThrow();
  });
  it("requires contiguous parts and exact total size, including the final part", () => {
    const parts = [{ PartNumber: 2, Size: 42, ETag: "b" }, { PartNumber: 1, Size: UPLOAD_PART_BYTES, ETag: "a" }];
    expect(validateUploadParts(parts, UPLOAD_PART_BYTES + 42)).toEqual([{ PartNumber: 1, ETag: "a" }, { PartNumber: 2, ETag: "b" }]);
    expect(() => validateUploadParts(parts.slice(1), UPLOAD_PART_BYTES + 42)).toThrow();
    expect(() => validateUploadParts([{ ...parts[0], Size: 43 }, parts[1]], UPLOAD_PART_BYTES + 42)).toThrow();
    expect(() => validateUploadParts([parts[1], parts[1]], UPLOAD_PART_BYTES * 2)).toThrow();
  });
});

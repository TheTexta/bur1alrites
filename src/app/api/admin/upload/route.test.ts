import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SOURCE_BYTES, readUploadSession, signUploadSession, type UploadSession } from "@/lib/r2/upload-session";

const mock = vi.hoisted(() => ({ authorized: true, send: vi.fn(), head: vi.fn(), copy: vi.fn(), remove: vi.fn(), gallery: vi.fn(), reserve: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ requirePortfolioAdmin: async () => mock.authorized ? null : Response.json({ error: "Sign in." }, { status: 401 }) }));
vi.mock("@/lib/gallery", () => ({ galleryUploadIsConfigured: mock.configured, getGalleryItem: mock.gallery, reserveGalleryUpload: mock.reserve, GalleryRequestError: class extends Error { status = 409; } }));
vi.mock("../../../../../media-worker/r2.mjs", () => ({ r2Configuration: () => ({ secretAccessKey: "test-secret" }), r2Bucket: () => "bur1alrites", r2Client: () => ({ send: mock.send }), objectCommand: (Command: new (input: unknown) => unknown, key: string, input: object = {}) => new Command({ Bucket: "bur1alrites", Key: key, ...input }), headObject: mock.head, copyObject: mock.copy, deleteObject: mock.remove }));
import { POST, PATCH, PUT, DELETE } from "./route";

const metadata = { slug: "test-clip", title: "Clip", client: "Client", type: "clip", year: "2026", width: 1920, height: 1080, extension: "mov" as const };
const session: UploadSession = { id: "532ac2d1-854d-42f8-a557-95541b410e33", key: "portfolio-images/incoming/532ac2d1-854d-42f8-a557-95541b410e33.mov", uploadId: "multipart-id", bucket: "bur1alrites", size: 13, expires: Date.now() + 3600000, metadata };
function request(method: string, body: object, origin = "https://site.example") { return new Request("https://site.example/api/admin/upload", { method, headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }); }
const details = { ...metadata, fileName: "clip.mov", fileSize: 13 };
const token = () => ({ session: signUploadSession(session, "test-secret") });

beforeEach(() => {
  vi.clearAllMocks(); mock.authorized = true;
  mock.configured.mockResolvedValue(true); mock.gallery.mockResolvedValue(null); mock.head.mockResolvedValue(null);
  mock.send.mockResolvedValue({ UploadId: "multipart-id" }); mock.copy.mockResolvedValue({}); mock.remove.mockResolvedValue({});
  mock.reserve.mockResolvedValue({ ...metadata, upload_session_id: session.id, status: "processing" });
});

describe("admin multipart lifecycle", () => {
  it("requires authorization and the correct origin on every operation", async () => {
    for (const [method, handler] of [["POST", POST], ["PATCH", PATCH], ["PUT", PUT], ["DELETE", DELETE]] as const) {
      mock.authorized = false;
      expect((await handler(request(method, token()))).status).toBe(401);
      mock.authorized = true;
      expect((await handler(request(method, token(), "https://other.example"))).status).toBe(403);
    }
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("rejects oversized files, unsupported formats and incomplete metadata", async () => {
    for (const body of [{ ...details, fileSize: MAX_SOURCE_BYTES + 1 }, { ...details, fileName: "clip.webm" }, { ...details, width: 0 }]) expect((await POST(request("POST", body))).status).toBe(400);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("binds validated metadata to an upload session and a staging-only object", async () => {
    const response = await POST(request("POST", details));
    expect(response.status).toBe(200);
    const body = await response.json();
    const signed = readUploadSession(body.session, "test-secret");
    expect(signed.metadata).toEqual(metadata);
    expect(signed.key).toMatch(/^portfolio-images\/incoming\/[0-9a-f-]+\.mov$/);
    expect(mock.send.mock.calls[0][0].input.Metadata["destination-key"]).toBe("portfolio-images/test-clip.mov");
  });
  it("accepts exactly 5 GiB as 160 parts", async () => {
    const response = await POST(request("POST", { ...details, fileSize: MAX_SOURCE_BYTES }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.partCount).toBe(160);
    expect(readUploadSession(body.session, "test-secret").size).toBe(MAX_SOURCE_BYTES);
  });
  it("rejects duplicate slugs and missing database setup before allocating storage", async () => {
    mock.gallery.mockResolvedValue({ slug: metadata.slug });
    expect((await POST(request("POST", details))).status).toBe(409);
    mock.configured.mockResolvedValue(false);
    expect((await POST(request("POST", details))).status).toBe(503);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("rejects tampered sessions and out-of-range part signing", async () => {
    expect((await PATCH(request("PATCH", { session: "tampered", partNumbers: [1] }))).status).toBe(400);
    expect((await PATCH(request("PATCH", { ...token(), partNumbers: [2] }))).status).toBe(400);
    expect((await PATCH(request("PATCH", { ...token(), partNumbers: [1, 1] }))).status).toBe(400);
  });
  it("rejects incomplete multipart data before reserving a gallery item", async () => {
    mock.send.mockResolvedValue({ Parts: [{ PartNumber: 1, Size: 12, ETag: "part" }] });
    expect((await PUT(request("PUT", token()))).status).toBe(400);
    expect(mock.reserve).not.toHaveBeenCalled();
  });
  it("promotes an owned completed source only after reserving the slug", async () => {
    mock.head.mockImplementation(async key => key === session.key ? { ContentLength: 13, ContentType: "video/quicktime", ETag: '"source"', Metadata: { "upload-session-id": session.id } } : null);
    expect((await PUT(request("PUT", token()))).status).toBe(201);
    expect(mock.reserve).toHaveBeenCalledWith(session.id, metadata);
    expect(mock.copy).toHaveBeenCalledWith(session.key, "portfolio-images/test-clip.mov", { CopySourceIfMatch: '"source"', IfNoneMatch: "*" });
    expect(mock.reserve.mock.invocationCallOrder[0]).toBeLessThan(mock.copy.mock.invocationCallOrder[0]);
    expect(mock.remove).toHaveBeenCalledWith(session.key);
  });
  it("returns the same item after a lost completion response without copying again", async () => {
    const item = { ...metadata, upload_session_id: session.id };
    mock.head.mockResolvedValue({ ContentLength: 13, Metadata: { "upload-session-id": session.id } }); mock.gallery.mockResolvedValue(item);
    const response = await PUT(request("PUT", token()));
    expect(response.status).toBe(200); expect((await response.json()).item).toEqual(item);
    expect(mock.copy).not.toHaveBeenCalled();
  });
  it("recovers when R2 completed the multipart object but its response was lost", async () => {
    let completed = false;
    mock.head.mockImplementation(async key => key === session.key && completed ? { ContentLength: 13, ContentType: "video/quicktime", ETag: '"source"', Metadata: { "upload-session-id": session.id } } : null);
    mock.send.mockImplementation(async command => {
      if (command.constructor.name === "ListPartsCommand") return { Parts: [{ PartNumber: 1, Size: 13, ETag: '"part"' }] };
      completed = true;
      throw new Error("Connection lost after completion.");
    });
    expect((await PUT(request("PUT", token()))).status).toBe(201);
    expect(mock.reserve).toHaveBeenCalledTimes(1);
    expect(mock.copy).toHaveBeenCalledTimes(1);
  });
  it("can abort an already absent multipart upload repeatedly", async () => {
    mock.send.mockRejectedValue(Object.assign(new Error("Absent"), { name: "NoSuchUpload" }));
    expect((await DELETE(request("DELETE", token()))).status).toBe(200);
    expect((await DELETE(request("DELETE", token()))).status).toBe(200);
    expect(mock.remove).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite another session's destination or delete it on abort", async () => {
    mock.head.mockResolvedValue({ ContentLength: 13, Metadata: { "upload-session-id": "someone-else" } });
    expect((await PUT(request("PUT", token()))).status).toBe(409);
    expect(mock.copy).not.toHaveBeenCalled();
    expect((await DELETE(request("DELETE", token()))).status).toBe(200);
    expect(mock.remove).toHaveBeenCalledWith(session.key);
  });
});

import { createHash } from "node:crypto";
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export function r2Configuration(env = process.env) {
  function required(name) { const value = env[name]?.trim(); if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
  const endpoint = new URL(required("CLOUDFLARE_S3_API_ENDPOINT"));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !["", "/"].includes(endpoint.pathname)) throw new Error("CLOUDFLARE_S3_API_ENDPOINT must be an HTTPS origin.");
  return { endpoint: endpoint.origin, bucket: env.CLOUDFLARE_R2_BUCKET?.trim() || "bur1alrites", accessKeyId: required("CLOUDFLARE_ACCESS_ID"), secretAccessKey: required("CLOUDFLARE_SECRET_KEY") };
}

export function createR2Client(env = process.env) {
  const config = r2Configuration(env);
  return new S3Client({ region: "auto", endpoint: config.endpoint, requestChecksumCalculation: "WHEN_REQUIRED", credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
}

let client;
export function r2Client() { return client ??= createR2Client(); }
export function r2Bucket() { return r2Configuration().bucket; }
export function objectCommand(Command, key, values = {}) { return new Command({ Bucket: r2Bucket(), Key: key, ...values }); }
export function copySource(key) { return `${encodeURIComponent(r2Bucket())}/${key.split("/").map(encodeURIComponent).join("/")}`; }
export async function headObject(key) {
  try { return await r2Client().send(objectCommand(HeadObjectCommand, key)); }
  catch (error) { if (error?.$metadata?.httpStatusCode === 404) return null; throw error; }
}
export async function getObject(key) { return r2Client().send(objectCommand(GetObjectCommand, key)); }
export async function putObject(key, body, contentType, cacheControl, metadata = {}) {
  return r2Client().send(objectCommand(PutObjectCommand, key, { Body: body, ContentType: contentType, CacheControl: cacheControl, Metadata: metadata }));
}
export async function uploadStream(key, body, values = {}) {
  return new Upload({ client: r2Client(), params: { Bucket: r2Bucket(), Key: key, Body: body, ...values }, partSize: 32 * 1024 * 1024, queueSize: 2, leavePartsOnError: false }).done();
}
export async function copyObject(from, to, values = {}) {
  const { IfNoneMatch, ...options } = values;
  const command = objectCommand(CopyObjectCommand, to, { CopySource: copySource(from), ...options });
  // R2 destination conditions use its extension header, not S3's source condition.
  if (IfNoneMatch) command.middlewareStack.add(next => async args => {
    args.request.headers["cf-copy-destination-if-none-match"] = IfNoneMatch;
    return next(args);
  }, { step: "build", name: "r2DestinationCondition" });
  return r2Client().send(command);
}
export async function deleteObject(key) { return r2Client().send(objectCommand(DeleteObjectCommand, key)); }
export async function listObjects(prefix, storageClient = r2Client(), bucket = r2Bucket()) {
  const objects = [];
  let token;
  do {
    const page = await storageClient.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    objects.push(...(page.Contents ?? []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) throw new Error("R2 listing did not return a continuation token.");
  } while (token);
  return objects;
}
export function sourceVersion(source) {
  return source.Metadata?.["hls-source-version"] ?? createHash("sha256").update([source.Key, source.ETag, source.LastModified?.toISOString()].join(":")).digest("hex").slice(0, 12);
}

import { createHash } from 'node:crypto';
import { inventory, hashBody, fingerprint, hlsSourceVersion, orderMigrationObjects, decodedObjectHeaders } from './lib/storage-migration.mjs';
import { Readable, Transform } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { getObject, headObject, uploadStream, copyObject, r2Configuration } from '../media-worker/r2.mjs';
loadEnvConfig(process.cwd());
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_PORTFOLIO_BUCKET ?? 'bur1alrites';
const copy = process.argv.includes('--copy');
const verify = process.argv.includes('--verify');
let currentKey;
if (!supabaseUrl || !serviceKey) throw new Error('Supabase URL and service-role key are required for migration.');
r2Configuration();
async function sourceRequest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/storage/v1/${path}`, { ...init, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Accept-Encoding': 'identity', ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Supabase migration request failed: HTTP ${response.status}`);
  return response;
}
async function migrate(source) {
  const key = source.name; const identity = fingerprint(source);
  const existing = await headObject(key);
  if (existing?.Metadata?.['supabase-fingerprint'] === identity && existing.Metadata.sourcesha256) {
    const result = await hashBody((await getObject(key)).Body);
    if (result.sha256 !== existing.Metadata.sourcesha256 || result.bytes !== existing.ContentLength || result.bytes !== Number(source.metadata?.size)) throw new Error(`Verification failed for ${key}.`);
    if (existing.ContentEncoding) {
      if (!copy) throw new Error(`Transport encoding metadata requires repair for ${key}. Run with --copy.`);
      // Fetch decoded the original HTTP response; its transport encoding is not
      // the encoding of the verified stored bytes. Replace only that metadata.
      await copyObject(key, key, {
        CopySourceIfMatch: existing.ETag, MetadataDirective: 'REPLACE',
        Metadata: existing.Metadata, ContentType: existing.ContentType,
        CacheControl: existing.CacheControl, ContentDisposition: existing.ContentDisposition,
        ContentLanguage: existing.ContentLanguage, Expires: existing.Expires,
      });
      const repaired = await headObject(key);
      if (repaired.ContentEncoding || repaired.ETag !== existing.ETag || repaired.ContentLength !== existing.ContentLength) throw new Error(`Metadata repair failed for ${key}.`);
      return 'metadata-updated';
    }
    return 'verified';
  }
  if (!copy) throw new Error(`Missing or unverified R2 object: ${key}. Run with --copy.`);
  if (existing && !existing.Metadata?.['supabase-fingerprint']) throw new Error(`Unmanaged R2 object already exists at ${key}; inspect it before copying.`);
  const response = await sourceRequest(`object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`);
  if (!response.body) throw new Error(`Empty Supabase response for ${key}.`);
  const metadata = { 'supabase-fingerprint': identity };
  if (/^[^/]+\/[^/]+\.(mov|mp4)$/i.test(key)) metadata['hls-source-version'] = hlsSourceVersion(source);
  const hash = createHash('sha256'); let bytes = 0;
  const transform = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); bytes += chunk.length; callback(null, chunk); } });
  const directory = await mkdtemp(join(tmpdir(), 'bur1alrites-r2-migration-'));
  const file = join(directory, 'source');
  try {
    await pipeline(Readable.fromWeb(response.body), transform, createWriteStream(file));
    const sha256 = hash.digest('hex');
    if (bytes !== Number(source.metadata?.size)) throw new Error(`Source size changed for ${key}. Reconcile the inventory before retrying.`);
    // Node fetch exposes decoded bytes even when a proxy supplies a compressed
    // HTTP response. Never attach its transport Content-Encoding to those bytes.
    await uploadStream(key, createReadStream(file), { ...decodedObjectHeaders(response.headers, source.metadata), ContentLength: bytes, Metadata: { ...metadata, sourcesha256: sha256 } });
    const actual = await hashBody((await getObject(key)).Body);
    if (actual.sha256 !== sha256 || actual.bytes !== bytes) throw new Error(`Verification failed for ${key}.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
  return 'copied';
}
async function main() {
  const objects = orderMigrationObjects(await inventory(sourceRequest, bucket));
  const bytes = objects.reduce((sum, object) => sum + Number(object.metadata?.size ?? 0), 0);
  console.log(`Supabase inventory: ${objects.length} objects, ${(bytes / 1024 ** 3).toFixed(2)} GiB. Target: ${r2Configuration().bucket}.`);
  if (!copy && !verify) { console.log('Dry run. Use --copy to copy and verify, or --verify to check the existing R2 copy.'); return; }
  let copied = 0; let metadataUpdated = 0;
  for (let index = 0; index < objects.length; index++) {
    currentKey = objects[index].name;
    const result = await migrate(objects[index]); if (result === 'copied') copied++;
    if (result === 'metadata-updated') metadataUpdated++;
    if ((index + 1) % 100 === 0 || /\.(mov|mp4)$/i.test(objects[index].name) && !objects[index].name.includes('/streams/') || index === objects.length - 1) console.log(`Verified ${index + 1}/${objects.length}; copied ${copied}. Latest: ${objects[index].name}`);
  }
  console.log(`Migration verified: ${objects.length} objects; ${copied} copied; ${metadataUpdated} metadata repairs. Supabase originals retained.`);
}
main().catch(error => { console.error(error instanceof Error && !error.$metadata ? error.message : `Storage migration failed for ${currentKey ?? 'inventory'}: ${error.name}, HTTP ${error.$metadata?.httpStatusCode ?? 'unknown'}. Retry the resumable copy.`); process.exitCode = 1; });

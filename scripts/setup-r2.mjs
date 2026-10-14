import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { r2Client, r2Bucket } from '../media-worker/r2.mjs';
loadEnvConfig(process.cwd());
const account = process.env.CLOUDFLARE_ACCOUNT_ID; const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Cloudflare account ID and API token are required for setup.');
const apply = process.argv.includes('--apply');
// The shared Worker is published from the dedicated infrastructure repository.
// --bucket-only remains accepted for compatibility with earlier setup commands.
if (process.argv.includes('--replace-unused-vercel')) throw new Error('Shared Worker DNS and routes are owned by dextery-infrastructure.');
async function api(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare setup failed: HTTP ${response.status}, codes ${(body.errors ?? []).map(error => error.code).join(', ')}.`);
  return body.result;
}
async function main() {
  const base = `accounts/${encodeURIComponent(account)}/r2/buckets`;
  const buckets = await api(base); const exists = buckets.buckets.some(bucket => bucket.name === r2Bucket());
  console.log(`Target bucket ${r2Bucket()}: ${exists ? 'exists' : 'will be created'}. Existing buckets retained.`);
  if (!apply) { console.log('Dry run. Use --apply to provision the bucket and upload CORS only.'); return; }
  if (!exists) await api(base, { method: 'POST', body: JSON.stringify({ name: r2Bucket() }) });
  const origins = ['http://localhost:3000', 'http://localhost:3001', new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bur1alrites.vercel.app').origin];
  await r2Client().send(new PutBucketCorsCommand({ Bucket: r2Bucket(), CORSConfiguration: { CORSRules: [{ AllowedOrigins: [...new Set(origins)], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['Content-Type'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }] } }));
  console.log('Bucket and upload CORS configured. Worker routes and publishing are owned by dextery-infrastructure.');
}
main().catch(error => { console.error(error instanceof Error && !error.$metadata ? error.message : 'R2 setup failed; check bucket configuration permissions.'); process.exitCode = 1; });

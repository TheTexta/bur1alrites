import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { spawn } from 'node:child_process';
import { resolveCname } from 'node:dns/promises';
import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { r2Client, r2Bucket } from '../media-worker/r2.mjs';
loadEnvConfig(process.cwd());
const account = process.env.CLOUDFLARE_ACCOUNT_ID; const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Cloudflare account ID and API token are required for setup.');
const apply = process.argv.includes('--apply');
const bucketOnly = process.argv.includes('--bucket-only');
const replaceUnusedVercel = process.argv.includes('--replace-unused-vercel');
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
  if (!apply) { console.log('Dry run. Use --apply to provision; --bucket-only skips domain deployment.'); return; }
  if (!exists) await api(base, { method: 'POST', body: JSON.stringify({ name: r2Bucket() }) });
  const origins = ['http://localhost:3000', 'http://localhost:3001', new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bur1alrites.vercel.app').origin];
  await r2Client().send(new PutBucketCorsCommand({ Bucket: r2Bucket(), CORSConfiguration: { CORSRules: [{ AllowedOrigins: [...new Set(origins)], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['Content-Type'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }] } }));
  if (bucketOnly) { console.log('Bucket and upload CORS configured.'); return; }
  const zones = await api(`zones?name=dextery.dev&account.id=${encodeURIComponent(account)}`);
  const zone = zones.find(zone => zone.name === 'dextery.dev');
  if (!zone) throw new Error('dextery.dev is unavailable to this token.');
  const domains = await api(`accounts/${encodeURIComponent(account)}/workers/domains`);
  const owned = domains.some(domain => domain.hostname === 'media.dextery.dev' && domain.service === 'dextery-assets');
  if (domains.some(domain => domain.hostname === 'media.dextery.dev' && domain.service !== 'dextery-assets')) throw new Error('media.dextery.dev belongs to another Worker.');
  let records;
  try { records = await api(`zones/${zone.id}/dns_records?name=media.dextery.dev`); }
  catch (error) {
    if (!owned && (!replaceUnusedVercel || !error.message.includes('HTTP 403'))) throw error;
  }
  if (!owned && (records?.length || !records)) {
    if (!replaceUnusedVercel) throw new Error('media.dextery.dev has DNS records or cannot be inspected. Check ownership before provisioning.');
    const names = await resolveCname('media.dextery.dev');
    const response = await fetch('https://media.dextery.dev/', { redirect: 'manual' });
    await response.body?.cancel();
    if (names.length !== 1 || names[0] !== 'cname.vercel-dns.com' || response.status !== 404 || response.headers.get('x-vercel-error') !== 'DEPLOYMENT_NOT_FOUND') throw new Error('The existing media hostname is not an unused Vercel placeholder.');
    console.log('Verified media.dextery.dev is an unused Vercel placeholder; only this hostname will be replaced.');
  }
  const routes = await api(`zones/${zone.id}/workers/routes`);
  if (routes.some(route => route.pattern.includes("images.dextery.dev") && route.script !== 'dextery-assets')) throw new Error('An image route belongs to another Worker; inspect it before provisioning.');
  await new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'deploy', '--config', 'cloudflare-assets/wrangler.jsonc'], { stdio: 'inherit', env: process.env });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Worker deployment failed.')));
  });
}
main().catch(error => { console.error(error instanceof Error && !error.$metadata ? error.message : 'R2 setup failed; check bucket configuration permissions.'); process.exitCode = 1; });

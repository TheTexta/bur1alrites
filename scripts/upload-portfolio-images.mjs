import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { uploadStream, r2Bucket } from '../media-worker/r2.mjs';
loadEnvConfig(process.cwd());
const contentTypes = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const base = (process.env.NEXT_PUBLIC_PORTFOLIO_IMAGE_BASE_PATH ?? 'portfolio-images').replace(/^\/+|\/+$/g, '');
async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node scripts/upload-portfolio-images.mjs <source-dir>');
  let count = 0;
  for (const name of (await readdir(directory)).sort()) {
    const rawExtension = extname(name); const extension = rawExtension.toLowerCase();
    const contentType = contentTypes[extension];
    if (!contentType || !(await stat(join(directory, name))).isFile()) continue;
    const slug = basename(name, rawExtension).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const key = `${base}/${slug}${extension}`;
    await uploadStream(key, createReadStream(join(directory, name)), { ContentType: contentType, CacheControl: 'public, max-age=31536000' });
    console.log(`Uploaded ${key}`); count++;
  }
  console.log(`Uploaded ${count} objects to ${r2Bucket()}.`);
}
main().catch(() => { console.error('Portfolio upload failed. Check the source directory and R2 configuration.'); process.exitCode = 1; });

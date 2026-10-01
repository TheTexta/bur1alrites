import nextEnv from '@next/env';
import { spawn } from 'node:child_process';

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  throw new Error('Cloudflare account ID and API token are required.');
}

function wrangler(args) {
  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn('npx', ['wrangler', ...args, '--config', 'cloudflare-assets/wrangler.jsonc'], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', chunk => { output += chunk.toString(); process.stdout.write(chunk); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error('Worker publication failed.')));
  });
}

try {
  // Version deployment leaves dashboard-managed routes and custom domains intact.
  const output = await wrangler(['versions', 'upload']);
  const version = /Worker Version ID: ([a-f0-9-]{36})/.exec(output)?.[1];
  if (!version) throw new Error('Wrangler did not return a Worker version ID.');
  await wrangler(['versions', 'deploy', `${version}@100%`, '--yes']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

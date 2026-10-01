import { createHash } from 'node:crypto';

export function decodedObjectHeaders(headers, sourceMetadata = {}) {
  return {
    ContentType: headers.get('content-type') ?? sourceMetadata.mimetype ?? 'application/octet-stream',
    CacheControl: headers.get('cache-control') ?? 'no-cache',
    ...(headers.get('content-disposition') ? { ContentDisposition: headers.get('content-disposition') } : {}),
    ...(headers.get('content-language') ? { ContentLanguage: headers.get('content-language') } : {}),
  };
}

export async function inventory(sourceRequest, bucket, prefix = '') {
  const objects = [];
  for (let offset = 0; ; offset += 500) {
    const response = await sourceRequest(`object/list/${encodeURIComponent(bucket)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix, limit: 500, offset, sortBy: { column: 'name', order: 'asc' } }) });
    const page = await response.json();
    for (const object of page) {
      const key = prefix ? `${prefix}/${object.name}` : object.name;
      if (/(^|\/)incoming(\/|$)/.test(key)) continue;
      if (!object.id && !object.metadata) objects.push(...await inventory(sourceRequest, bucket, key));
      else objects.push({ ...object, name: key });
    }
    if (page.length < 500) break;
  }
  return objects;
}
export async function hashBody(body) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of body) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
export function fingerprint(source) {
  return createHash('sha256').update([source.name, source.metadata?.eTag, source.updated_at, source.metadata?.size].join(':')).digest('hex');
}
export function hlsSourceVersion(source) {
  return createHash('sha256').update([source.name, source.metadata?.eTag, source.updated_at].join(':')).digest('hex').slice(0, 12);
}
export function orderMigrationObjects(objects) {
  return [...objects].sort((a, b) => Number(a.name.endsWith('/master.m3u8')) - Number(b.name.endsWith('/master.m3u8')) || a.name.localeCompare(b.name));
}

/**
 * Files and screenshots the user attaches to a chat message.
 *
 * The browser uploads each file with a plain HTTP POST to /api/uploads (the
 * ingress WebSocket proxy caps message size at a few MB, far below a
 * screenshot's worth of base64) and then references the returned ids in its
 * `send` message. Each attachment becomes a content block of the user
 * message: images as image blocks, PDFs as document blocks and text-like files
 * (YAML, logs, JSON, ...) as text. Other binary formats are rejected, since
 * Claude could not read them anyway.
 *
 * Files live under /data/uploads/<id> with a <id>.json sidecar holding the
 * metadata. The agent itself never reads that directory (the add-on data dir
 * is off limits to its tools, see hooks.ts); the UI uses it for thumbnails.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment } from './protocol.js';

export const MAX_ATTACHMENTS = 10;
/** The Messages API rejects larger images. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Upper bound for any request body, checked while streaming. */
export const MAX_UPLOAD_BYTES = MAX_PDF_BYTES;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_TYPES)[number];

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.md', '.yaml', '.yml', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.html', '.htm', '.css',
  '.js', '.mjs', '.ts', '.py', '.sh', '.conf', '.cfg', '.ini', '.toml', '.env', '.jinja', '.j2', '.sql', '.diff', '.patch',
]);

/** Unsent uploads older than this are removed at startup. */
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string };

export interface PreparedAttachment {
  meta: Attachment;
  block: ContentBlock;
}

/** Strip directories and control characters; keep something readable. */
export function sanitizeName(name: string): string {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/'));
  const clean = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim().slice(0, 120);
  return clean || 'file';
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`;
}

/** Decide how a file is handed to Claude, from its declared type, extension and content. */
export function classify(name: string, mediaType: string, bytes: Buffer): { kind: Attachment['kind']; mediaType: string } | undefined {
  const ext = path.extname(name).toLowerCase();
  const type = (mediaType || '').toLowerCase().split(';')[0].trim();
  const image = (IMAGE_TYPES as readonly string[]).includes(type) ? (type as ImageMediaType) : IMAGE_EXTENSIONS[ext];
  if (image) return { kind: 'image', mediaType: image };
  if (type === 'application/pdf' || ext === '.pdf') return { kind: 'pdf', mediaType: 'application/pdf' };
  const generic = !type || type === 'application/octet-stream';
  const texty = type.startsWith('text/') || /(json|yaml|xml|javascript|x-sh|toml)/.test(type) || TEXT_EXTENSIONS.has(ext);
  if (texty || (generic && !ext)) {
    // Binary content with a text-ish name still is not text.
    if (bytes.includes(0)) return undefined;
    return { kind: 'text', mediaType: generic ? 'text/plain' : type };
  }
  return undefined;
}

/** Validate one uploaded file. Throws with a user-facing message. */
export function validateUpload(rawName: string, mediaType: string, bytes: Buffer): Attachment {
  const name = sanitizeName(rawName);
  if (!bytes.length) throw new Error(`${name} is empty.`);
  const c = classify(name, mediaType, bytes);
  if (!c) throw new Error(`${name}: unsupported file type. Attach images (PNG, JPEG, GIF, WebP), PDFs or text files.`);
  const limit = c.kind === 'image' ? MAX_IMAGE_BYTES : c.kind === 'pdf' ? MAX_PDF_BYTES : MAX_TEXT_BYTES;
  if (bytes.length > limit) {
    throw new Error(`${name} is ${formatBytes(bytes.length)}; the limit for this file type is ${formatBytes(limit)}.`);
  }
  return { id: randomUUID(), name, mediaType: c.mediaType, size: bytes.length, kind: c.kind };
}

export function toContentBlock(meta: Attachment, bytes: Buffer): ContentBlock {
  if (meta.kind === 'image') {
    return { type: 'image', source: { type: 'base64', media_type: meta.mediaType as ImageMediaType, data: bytes.toString('base64') } };
  }
  if (meta.kind === 'pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') }, title: meta.name };
  }
  return { type: 'text', text: `<attached_file name="${meta.name.replace(/"/g, "'")}">\n${bytes.toString('utf8')}\n</attached_file>` };
}

const ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Uploaded files under /data/uploads. */
export class AttachmentStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'uploads');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Absolute path of a stored file, or undefined for malformed ids. */
  file(id: string): string | undefined {
    return ID_RE.test(id) ? path.join(this.dir, id) : undefined;
  }

  async save(rawName: string, mediaType: string, bytes: Buffer): Promise<Attachment> {
    const meta = validateUpload(rawName, mediaType, bytes);
    const file = this.file(meta.id)!;
    await fsp.writeFile(file, bytes);
    await fsp.writeFile(`${file}.json`, JSON.stringify(meta));
    return meta;
  }

  /** Store an image a tool produced (synchronously: called from the SDK message loop). */
  saveGenerated(name: string, mediaType: string, bytes: Buffer): Attachment {
    const meta = validateUpload(name, mediaType, bytes);
    const file = this.file(meta.id)!;
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(`${file}.json`, JSON.stringify(meta));
    return meta;
  }

  async get(id: string): Promise<Attachment | undefined> {
    const file = this.file(id);
    if (!file) return undefined;
    try {
      return JSON.parse(await fsp.readFile(`${file}.json`, 'utf8')) as Attachment;
    } catch {
      return undefined;
    }
  }

  /** Load uploads referenced by a `send` message and build their content blocks. */
  async prepare(ids: string[] | undefined): Promise<PreparedAttachment[]> {
    if (!ids?.length) return [];
    if (!Array.isArray(ids)) throw new Error('Invalid attachments');
    if (ids.length > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} files per message.`);
    return Promise.all(
      ids.map(async (id) => {
        const meta = await this.get(String(id));
        if (!meta) throw new Error('An attachment is no longer available. Attach it again.');
        const bytes = await fsp.readFile(this.file(meta.id)!);
        return { meta, block: toContentBlock(meta, bytes) };
      }),
    );
  }

  async delete(ids: string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const file = this.file(id);
        if (!file) return;
        await fsp.rm(file, { force: true });
        await fsp.rm(`${file}.json`, { force: true });
      }),
    );
  }

  /** Remove old uploads that no transcript refers to (attached, then never sent). */
  async pruneOrphans(referenced: Set<string>, now = Date.now()): Promise<number> {
    let removed = 0;
    for (const name of await fsp.readdir(this.dir).catch(() => [] as string[])) {
      const id = name.replace(/\.json$/, '');
      if (!ID_RE.test(id) || referenced.has(id)) continue;
      const stat = await fsp.stat(path.join(this.dir, name)).catch(() => undefined);
      if (!stat || now - stat.mtimeMs < ORPHAN_MAX_AGE_MS) continue;
      await fsp.rm(path.join(this.dir, name), { force: true });
      if (!name.endsWith('.json')) removed++;
    }
    return removed;
  }
}

/** Attachment and tool-image ids referenced by a session's transcript. */
export function attachmentIds(items: Array<{ kind: string; attachments?: Attachment[]; images?: Attachment[] }>): string[] {
  return items.flatMap((i) =>
    i.kind === 'user' ? (i.attachments ?? []).map((a) => a.id) : i.kind === 'tool_use' ? (i.images ?? []).map((a) => a.id) : [],
  );
}

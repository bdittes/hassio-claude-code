import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AttachmentStore, classify, sanitizeName, validateUpload, MAX_IMAGE_BYTES } from '../src/attachments.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('attachments', () => {
  test('classifies images, PDFs and text files', () => {
    assert.equal(classify('shot.png', 'image/png', PNG)?.kind, 'image');
    assert.equal(classify('Screenshot 2026.jpg', '', PNG)?.mediaType, 'image/jpeg');
    assert.equal(classify('manual.pdf', 'application/octet-stream', Buffer.from('%PDF'))?.kind, 'pdf');
    assert.equal(classify('automations.yaml', '', Buffer.from('- alias: x'))?.kind, 'text');
    assert.equal(classify('home-assistant.log', 'application/octet-stream', Buffer.from('ERROR'))?.mediaType, 'text/plain');
    assert.equal(classify('notes.txt', 'text/plain', Buffer.from([0x41, 0x00, 0x42])), undefined);
    assert.equal(classify('backup.tar', 'application/x-tar', Buffer.from('x')), undefined);
    assert.equal(classify('photo.heic', 'image/heic', Buffer.from('x')), undefined);
  });

  test('sanitizes names', () => {
    assert.equal(sanitizeName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeName('C:\\Users\\me\\a<b>.png'), 'a_b_.png');
    assert.equal(sanitizeName(''), 'file');
  });

  test('enforces size limits', () => {
    assert.throws(() => validateUpload('big.png', 'image/png', Buffer.alloc(MAX_IMAGE_BYTES + 1)), /limit/);
    assert.throws(() => validateUpload('empty.txt', 'text/plain', Buffer.alloc(0)), /empty/);
  });

  test('stores uploads and builds content blocks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ha-att-'));
    try {
      const store = new AttachmentStore(dir);
      const img = await store.save('shot.png', 'image/png', PNG);
      const txt = await store.save('config.yaml', 'text/yaml', Buffer.from('a: 1'));
      const prepared = await store.prepare([img.id, txt.id]);
      assert.equal(prepared[0].block.type, 'image');
      assert.deepEqual(prepared[1].block, { type: 'text', text: '<attached_file name="config.yaml">\na: 1\n</attached_file>' });
      await assert.rejects(store.prepare(['00000000-0000-0000-0000-000000000000']), /no longer available/);
      assert.equal(store.file('../sessions/x'), undefined);

      // Unreferenced and old: pruned. Referenced: kept.
      const old = Date.now() + 2 * 24 * 60 * 60 * 1000;
      assert.equal(await store.pruneOrphans(new Set([img.id]), old), 1);
      assert.ok(await store.get(img.id));
      assert.equal(await store.get(txt.id), undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

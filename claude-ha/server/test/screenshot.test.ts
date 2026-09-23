import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrontendPath } from '../src/screenshot.ts';
import { attachmentIds } from '../src/attachments.ts';

const BASE = 'http://homeassistant:8123';

describe('dashboard screenshots', () => {
  test('resolves frontend paths on the Home Assistant origin', () => {
    assert.equal(resolveFrontendPath(BASE, '/lovelace/0').toString(), 'http://homeassistant:8123/lovelace/0');
    assert.equal(resolveFrontendPath(BASE, '/dashboard-energy?tab=1').pathname, '/dashboard-energy');
    assert.equal(resolveFrontendPath(BASE, '').pathname, '/');
  });

  test('refuses other hosts, the auth flow and the raw API', () => {
    for (const bad of ['https://evil.example/', '//evil.example/x', 'lovelace/0', '/\\evil.example', '/auth/authorize', '/api/states', '/api']) {
      assert.throws(() => resolveFrontendPath(BASE, bad), undefined, bad);
    }
  });

  test('tool screenshots count as referenced uploads', () => {
    const img = { id: 'a', name: 'screenshot-1.png', mediaType: 'image/png', size: 1, kind: 'image' as const };
    assert.deepEqual(
      attachmentIds([
        { kind: 'user', attachments: [{ ...img, id: 'u1' }] },
        { kind: 'tool_use', images: [{ ...img, id: 't1' }] },
        { kind: 'assistant_text' },
      ]),
      ['u1', 't1'],
    );
  });
});

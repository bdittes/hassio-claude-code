import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { settleQueued } from '../src/agent.ts';
import { loadConfig } from '../src/config.ts';

describe('send_while_working option', () => {
  test('is on unless the run script exports false', () => {
    const saved = process.env.CLAUDE_HA_SEND_WHILE_WORKING;
    try {
      delete process.env.CLAUDE_HA_SEND_WHILE_WORKING;
      assert.equal(loadConfig().sendWhileWorking, true);
      process.env.CLAUDE_HA_SEND_WHILE_WORKING = 'false';
      assert.equal(loadConfig().sendWhileWorking, false);
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_HA_SEND_WHILE_WORKING;
      else process.env.CLAUDE_HA_SEND_WHILE_WORKING = saved;
    }
  });
});

describe('messages sent while Claude is working', () => {
  test('a result drops exactly the messages its turn consumed', () => {
    const queued = new Set(['a', 'b', 'c']);
    settleQueued(queued, { user_message_uuid: 'b', user_message_uuids: ['a', 'b'] });
    assert.deepEqual([...queued], ['c']);
  });

  test('falls back to the single uuid when the list is absent', () => {
    const queued = new Set(['a', 'b']);
    settleQueued(queued, { user_message_uuid: 'a' });
    assert.deepEqual([...queued], ['b']);
  });

  test('a result reporting no uuids at all clears the queue rather than staying busy forever', () => {
    const queued = new Set(['a', 'b']);
    settleQueued(queued, {});
    assert.equal(queued.size, 0);
  });

  test('unknown uuids from internally enqueued turns are ignored', () => {
    const queued = new Set(['a']);
    settleQueued(queued, { user_message_uuids: ['cron-1'] });
    assert.deepEqual([...queued], ['a']);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyYamlCheck } from '../src/ha-tools.ts';

const CONFIG = '/config';

describe('read-only YAML check auto-approval', () => {
  test('allows plain validator runs inside the config dir', () => {
    assert.ok(isReadOnlyYamlCheck('ha-yaml-check', CONFIG));
    assert.ok(isReadOnlyYamlCheck('ha-yaml-check automations.yaml packages/', CONFIG));
    assert.ok(isReadOnlyYamlCheck('ha-yaml-check --lint /config/configuration.yaml', CONFIG));
    assert.ok(isReadOnlyYamlCheck('yamllint -s /config', CONFIG));
  });

  test('rejects shell syntax, other commands, flags and paths outside /config', () => {
    assert.equal(isReadOnlyYamlCheck('ha-yaml-check; rm -rf /config', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('ha-yaml-check && curl x', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('ha-yaml-check $(cat /data/options.json)', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('ha-yaml-check > out.txt', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('ha-yaml-check /data/options.json', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('ha-yaml-check ../data', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('ha-yaml-check /configx/a.yaml', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('yamllint -c /data/options.json .', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck('python3 -c "print(1)"', CONFIG), false);
    assert.equal(isReadOnlyYamlCheck(undefined, CONFIG), false);
  });
});

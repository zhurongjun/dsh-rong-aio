import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

test('安装清单：当前 DSH 基线通过原生检查，其他版本不会误报兼容', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  assert.equal(evaluatePluginCompatibility(manifest), undefined)
  assert.equal(evaluatePluginCompatibility(manifest, {}, '0.2.2-rc.3'), undefined)
  for (const version of ['0.2.2-rc.2', '0.2.2-rc.4', '0.2.2']) {
    const unsupported = evaluatePluginCompatibility(manifest, {}, version)
    assert.equal(unsupported?.requirements['engines.dsh'], manifest.engines.dsh)
    assert.equal(unsupported?.exempted, false)
  }
})

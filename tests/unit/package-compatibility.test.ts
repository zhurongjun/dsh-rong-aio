import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import type { RootManifest } from '../../tools/manifest.ts'

test('安装清单：当前 DSH 基线通过原生检查，其他版本不会误报兼容', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as RootManifest & { name: string; version: string; engines?: { dsh?: string } }

  assert.equal(evaluatePluginCompatibility(manifest as never), undefined)
  assert.equal(evaluatePluginCompatibility(manifest as never, {}, '0.2.2-rc.3'), undefined)

  for (const version of ['0.2.2-rc.2', '0.2.2-rc.4', '0.2.2']) {
    const unsupported = evaluatePluginCompatibility(manifest as never, {}, version)
    assert.equal(unsupported?.requirements['engines.dsh'], manifest.engines?.dsh)
    assert.equal(unsupported?.exempted, false)
  }
})

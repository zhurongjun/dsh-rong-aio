import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { runBombadil } from './driver.ts'
import { serve } from './fixture.ts'

const expectedNames = ['models', 'speedAndTeam', 'settings', 'sideChat', 'workspaces', 'operations']

test('Bombadil verifies the DSH client slots in Chromium', { timeout: 100000 }, async (t) => {
  const reports: Array<{ name: string; error?: string }> = []
  const stopController = new AbortController()

  const { origin, f } = await serve(t, (report) => {
    reports.push(report)
    console.log(report.name, report.error ?? 'OK')
    if (report.error || reports.length >= expectedNames.length) {
      setTimeout(() => stopController.abort(), 20)
    }
  })

  await mkdir('agent_temp/ui', { recursive: true })
  const directory = await mkdtemp(resolve('agent_temp/ui/run-'))
  await runBombadil(origin, directory, f.root, {
    testSignal: t.signal,
    stopSignal: stopController.signal,
  })

  assert.deepEqual(
    reports.filter((r) => r.error),
    [],
  )
  assert.deepEqual(
    reports.map((r) => r.name),
    expectedNames,
  )

  const beta = await f.ctx.sessionPersistence.stat('beta' as never)
  assert.ok(beta?.location && beta.location.kind === 'jsonl')
  assert.deepEqual(f.openedDirectories, [dirname(beta.location.path)])
  assert.deepEqual((await f.injectView()).config.whitelist, [f.route])

  for (const [sessionId, mode] of [
    ['another', 'ultrafast'],
    ['team-child', 'standard'],
  ]) {
    const response = await f.request(
      'rong-aio.speed?' + new URLSearchParams({ sessionId, ...f.route }),
    )
    assert.equal(((await response.json()) as { mode: string }).mode, mode)
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { serve } from './fixture.mjs'
import { runBombadil } from './driver.mjs'

test('Bombadil verifies the DSH client slots in Chromium', { timeout: 100000 }, async (t) => {
  const reports = []
  const { origin, f } = await serve(t, (report) => {
    reports.push(report)
    console.log(report.name, report.error ?? 'OK')
  })
  await mkdir('agent_temp/bombadil', { recursive: true })
  const directory = await mkdtemp(resolve('agent_temp/bombadil/run-'))
  await runBombadil(origin, directory, f.root, t.signal)
  assert.deepEqual(
    reports.filter((r) => r.error),
    [],
  )
  assert.deepEqual(
    reports.map((r) => r.name),
    [
      'openSlider',
      'models',
      'speedAndTeam',
      'settings',
      'sideChat',
      'workspaces',
      'operations',
      'exploration',
    ],
    'Every workflow and at least eight browser exploration clicks must complete before the time limit',
  )
  const beta = await f.ctx.sessionPersistence.stat('beta')
  assert.deepEqual(f.openedDirectories, [dirname(beta.location.path)])
  assert.deepEqual((await f.injectView()).config.whitelist, [f.route])
  for (const [sessionId, mode] of [
    ['another', 'ultrafast'],
    ['team-child', 'standard'],
  ]) {
    const response = await f.request(
      'rong-aio.speed?' + new URLSearchParams({ sessionId, ...f.route }),
    )
    assert.equal((await response.json()).mode, mode)
  }
})

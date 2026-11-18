/** 校验授权配置的来源、有效字段与读取错误。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, route } from '../helpers/fixture.ts'

test('工程文件不能扩张授权；用户配置损坏或含未知字段时仅阻止开启', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure([])
  await mkdir(f.paths.base('workspace', f.workspace), { recursive: true })
  const projectConfig = join(f.paths.base('workspace', f.workspace), 'config.json')
  await writeFile(projectConfig, JSON.stringify({ version: 1, whitelist: [route] }))
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
  assert.deepEqual(await f.controller.references(), {})
  await assert.rejects(f.select(), /未获/)
  await writeFile(projectConfig, '{')
  await f.configure()
  assert.deepEqual((await f.controller.context(f.workspace)).config.errors, [])
  await f.select()
  await writeFile(
    f.paths.config(),
    JSON.stringify({ version: 1, unknown: true, whitelist: [route] }),
  )
  await assert.rejects(f.select(), /unknown/)
  await writeFile(f.paths.config(), '{')
  assert.ok((await f.controller.context()).config.errors.length)
  await assert.rejects(f.controller.capture('s'))
  f.sessions.idle('s')
  await f.select(null)
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
  await f.controller.capture('s')
  await f.controller.admit('s', { ...route, model: 'denied' }, 'BASE', true)
  assert.deepEqual(f.entry.frozen?.state, { name: null })
})

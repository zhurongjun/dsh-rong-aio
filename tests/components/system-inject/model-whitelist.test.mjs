/** 从用户和工程配置验证实际授权范围。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runtime } from '../../integration/helpers/runtime.mjs'

test('工程白名单不能授予权限；用户配置损坏时关闭的会话仍可发送', async (t) => {
  const f = await runtime(t)
  const project = join(f.workspace, '.dsh/system_inject')
  await mkdir(project, { recursive: true })
  await writeFile(
    join(project, 'config.json'),
    JSON.stringify({ version: 1, whitelist: [f.route] }),
  )
  await f.configure([])
  const select = () =>
    f.injectRequest({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  assert.equal((await select()).status, 409)
  await writeFile(join(f.user, 'config.json'), '{')
  const { config } = await f.injectView()
  assert.ok(config.errors.length)
  assert.equal((await select()).status, 409)
  assert.equal((await f.injectView({ sessionId: f.agent.id })).session.resolved.status, 'off')
  assert.deepEqual(await f.run(), { kind: 'completed' })
  assert.equal(f.calls.length, 1)
  assert.ok(!f.calls[0].messages[0].content[0].text.includes(f.prompt.body))
})

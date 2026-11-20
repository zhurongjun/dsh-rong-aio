/** 从用户和工程配置验证实际授权范围。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runtime } from '../../integration/helpers/runtime.mjs'

test('自动审查保留宿主提示词和审查决定，按实际模型授权，普通请求仍校验首段', async (t) => {
  const f = await runtime(t)
  const sessionId = f.agent.id
  assert.equal(
    (await f.injectRequest({ type: 'select', sessionId, state: { name: f.prompt.name } })).status,
    200,
  )
  assert.deepEqual(await f.run(), { kind: 'completed' })

  const system = '按宿主策略审查待执行的工具调用。'
  const messages = [{ role: 'user', content: [{ type: 'text', text: '待审查的操作' }] }]
  const send = (purpose, model = f.route.model) =>
    Array.fromAsync(f.ctx.llm.stream({ ...f.route, model, sessionId, purpose, system, messages }))

  const chunks = await send('auto-review')
  assert.equal(f.calls.at(-1).system, system)
  assert.deepEqual(f.calls.at(-1).messages, messages)
  const decision = chunks.find((chunk) => chunk.type === 'block-end').block
  assert.deepEqual(JSON.parse(decision.text), { risk: 'high', decision: 'deny' })

  await assert.rejects(send('auto-review', 'denied'), /模型未获破甲模式授权：fixture \/ denied/)
  await assert.rejects(send(undefined), /实际请求未包含破甲正文首段/)
  assert.equal(f.calls.length, 2)
})

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

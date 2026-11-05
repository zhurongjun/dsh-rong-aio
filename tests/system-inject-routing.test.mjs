/** 实际路由回归：预览不得捕获模型，最终分发的模型与辅助请求必须经过相同护栏。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostFixture } from './helpers/system-inject-host.mjs'

test('Astra 预览不拦截；切换为白名单模型后仅按原生最终路由校验', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  f.selection.current = { provider: 'fixture', model: 'astra' }
  const preview = await f.api()
  assert.equal(preview.session.resolved.status, 'on')
  assert.equal(preview.session.error, undefined)
  await assert.rejects(f.stream(), /astra/)
  f.selection.current = f.route
  const request = await f.stream()
  assert.equal(request.model, 'allowed')
  assert.equal(f.calls(), 1)
})

test('轮询不改写原生捕获的模型；下一步骤重新装配时换模经过护栏', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  await f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent })
  assert.deepEqual(f.selection.assembled, f.route)
  f.selection.current = { provider: 'fixture', model: 'denied' }
  for (let i = 0; i < 4; i++) {
    const view = await f.api()
    assert.equal(view.session.resolved.status, 'on')
    assert.deepEqual(f.selection.assembled, f.route)
  }
  await assert.rejects(f.stream(), /denied/)
  assert.equal(f.calls(), 0)
})

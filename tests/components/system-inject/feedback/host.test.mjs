/** 通过会话 API 确认和清理拒绝通知。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostFixture } from '../helpers/host.mjs'

test('通知确认经过会话 API 清理宿主错误，未破甲的模型选择和实际请求不被护栏拦截', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  await assert.rejects(f.stream({ model: 'denied' }), /未获/)
  const before = await f.api()
  await f.api({
    type: 'acknowledge-error',
    sessionId: f.agent.id,
    noticeId: before.session.error.id,
  })
  assert.equal((await f.api()).session.error, undefined)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: null } })
  await f.ctx.sessionController.selectModel({
    sessionId: f.agent.id,
    provider: 'fixture',
    model: 'denied',
  })
  assert.equal((await f.api()).session.resolved.status, 'off')
  const request = await f.stream({ model: 'denied' })
  assert.equal(f.calls(), 1)
  assert.equal(request.messages[0].content[0].text.includes(f.prompt.body), false)
})

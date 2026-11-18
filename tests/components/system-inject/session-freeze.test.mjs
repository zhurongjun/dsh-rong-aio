import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtime } from '../../integration/helpers/runtime.mjs'

test('重载会丢弃尚未发送的选词；首次以关闭状态发送后，该会话保持只读', async (t) => {
  const f = await runtime(t)
  const session = { sessionId: f.agent.id }
  const select = () =>
    f.injectRequest({ type: 'select', ...session, state: { name: f.prompt.name } })
  assert.equal((await select()).status, 200)
  assert.equal((await f.injectView(session)).session.resolved.status, 'on')
  await f.enable('rong-aio-system-inject', false)
  await f.enable('rong-aio-system-inject', true)
  assert.equal((await f.injectView(session)).session.resolved.status, 'off')
  assert.deepEqual(await f.run(), { kind: 'completed' })
  assert.ok(!f.calls[0].messages[0].content[0].text.includes(f.prompt.body))
  assert.equal((await select()).status, 409)
  assert.equal((await f.injectView(session)).session.resolved.editable, false)
})

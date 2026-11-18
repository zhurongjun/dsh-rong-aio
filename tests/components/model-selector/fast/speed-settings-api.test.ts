/** 通过公开 HTTP 接口验证速度选项及保存结果。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { speedHost } from '../speed-host-fixture.mjs'

const identity = { sessionId: 'a', provider: 'openai', model: 'gpt-6-astra' }

test('支持的速度档位取决于型号和连接协议，未开放的组合拒绝写入', async (t) => {
  const { call, protocols } = await speedHost(t)
  for (const model of [identity.model, 'catalog-alias', 'gpt-6-astra-2026-09-01']) {
    const response = await call({ ...identity, model })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).modes, ['standard', 'fast', 'ultrafast'])
  }
  for (const model of ['gpt-6-astra-mini', 'deepseek-v4'])
    assert.equal((await call({ ...identity, model }, 'fast')).status, 400)
  assert.equal((await call(identity, 'invalid')).status, 400)
  protocols.openai = 'openai-completions'
  assert.deepEqual((await (await call(identity)).json()).modes, ['standard', 'fast'])
  assert.equal((await call(identity, 'ultrafast')).status, 400)
  protocols.openai = 'openai-codex-responses'
  assert.deepEqual((await (await call(identity)).json()).modes, [])
  assert.equal((await call(identity, 'fast')).status, 400)
})

test('速度设置隔离会话与模型，保存失败后仍可读回最后一次成功的档位', async (t) => {
  const { call, failWrites } = await speedHost(t)
  assert.equal((await call(identity, 'fast')).status, 200)
  for (const other of [
    { ...identity, sessionId: 'b' },
    { ...identity, model: 'gpt-6.1-sol' },
  ])
    assert.equal((await (await call(other)).json()).mode, 'standard')
  failWrites()
  assert.equal((await call(identity, 'ultrafast')).status, 503)
  assert.equal((await (await call(identity)).json()).mode, 'fast')
})

/** 在提供商 HTTP 边界观察实际请求，覆盖并行会话、协议和辅助用途。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { speedHost } from '../speed-host-fixture.mjs'

test('并行会话各自使用已选速度；标题生成和其他模型的请求保持原样', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init)
    return Response.json({
      payload: await request.json(),
      beta: request.headers.get('anthropic-beta'),
    })
  })
  const { ctx, call } = await speedHost(t)
  const openai = { sessionId: 'first', provider: 'openai', model: 'gpt-6-astra' }
  const other = { ...openai, sessionId: 'second' }
  const claude = { sessionId: 'third', provider: 'anthropic', model: 'claude-opus-5' }
  assert.equal((await call(openai, 'ultrafast')).status, 200)
  assert.equal((await call(claude, 'fast')).status, 200)
  const messages = [{ role: 'user', content: '保持原文' }]
  const send = async (identity, purpose, model = identity.model) => {
    let received
    const path = identity.provider === 'anthropic' ? 'messages' : 'responses'
    const stream = ctx.waterfall(
      'llm/stream',
      { ...identity, purpose, messages },
      async function* () {
        const http = await fetch('https://fixture.invalid/v1/' + path, {
          method: 'POST',
          headers: { 'anthropic-beta': 'existing' },
          body: JSON.stringify({ model, messages }),
        })
        received = await http.json()
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    )
    for await (const _chunk of stream) {
      /* 等待流消费完毕后读取提供商收到的请求。 */
    }
    return received
  }
  const [first, second, anthropic, title, mismatch] = await Promise.all([
    send(openai),
    send(other),
    send(claude),
    send(openai, 'session-title'),
    send(openai, undefined, 'other'),
  ])
  assert.deepEqual(first.payload, { model: openai.model, messages, service_tier: 'ultrafast' })
  assert.deepEqual(second.payload, { model: other.model, messages, service_tier: 'default' })
  assert.deepEqual(anthropic.payload, { model: claude.model, messages, speed: 'fast' })
  assert.deepEqual(
    new Set(anthropic.beta.split(',')),
    new Set(['existing', 'fast-mode-2026-02-01']),
  )
  assert.deepEqual(title.payload, { model: openai.model, messages })
  assert.deepEqual(mismatch.payload, { model: 'other', messages })
})

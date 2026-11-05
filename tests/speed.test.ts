/** Fast 型号规则回归：允许列表、规范化别名、日期后缀与未知型号拒绝。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { speedRuleFor, speedKey } from '../src/components/model-selector/shared/speed.ts'
import { createSpeedTransport } from '../src/components/model-selector/host/speed-transport.ts'

const openai = speedRuleFor('gpt-6-astra')!

const anthropic = speedRuleFor('claude-opus-5')!

test('名称白名单：大小写、显示别名、日期后缀；不误开未知或不支持的型号', () => {
  assert.equal(speedRuleFor('GPT-6 Astra'), openai)
  assert.equal(speedRuleFor('alias', 'GPT 6 Astra'), openai)
  assert.equal(speedRuleFor('gpt-6-astra-2026-09-01'), openai)
  assert.deepEqual(speedRuleFor('Claude Opus 5.5')?.modes, ['standard', 'fast'])
  for (const name of [
    'gpt-6-astra-mini',
    'ft:gpt-6-astra',
    'claude-opus-4-6',
    'claude-sonnet-5',
    'deepseek-v4',
  ])
    assert.equal(speedRuleFor(name), undefined)
  assert.notEqual(
    speedKey({ sessionId: 'a', provider: 'b', model: 'c' }),
    speedKey({ sessionId: 'a', provider: 'c', model: 'b' }),
  )
})

test('传输：并发隔离、真实 JSON 字段、beta 合并、取消信号、卸载还原', async () => {
  const realFetch = globalThis.fetch
  const seen: Request[] = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    seen.push(request)
    return Response.json({
      body: await request.clone().json(),
      beta: request.headers.get('anthropic-beta'),
    })
  }
  const delegate = globalThis.fetch
  const transport = createSpeedTransport()
  const signal = new AbortController()

  const generate = (model: string, path: string) =>
    async function* () {
      await new Promise((resolve) => setTimeout(resolve, model === 'gpt-6-astra' ? 3 : 1))
      yield await (
        await fetch(`https://fixture.invalid/v1/${path}`, {
          method: 'POST',
          signal: signal.signal,
          headers: {
            'content-type': 'application/json',
            'anthropic-beta': 'existing-beta',
            'content-length': '0',
            'openai-service-tier': 'ultrafast',
          },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'keep me' }] }),
        })
      ).json()
    }

  const consume = async (stream: AsyncIterable<unknown>) => {
    const result = []
    for await (const item of stream) result.push(item)
    return result as { body: Record<string, unknown>; beta: string }[]
  }

  try {
    const [fast, standard, ultra, claude, untouched] = await Promise.all([
      consume(
        transport.stream(
          { model: 'gpt-6-astra', rule: openai, mode: 'fast' },
          generate('gpt-6-astra', 'responses'),
        ),
      ),
      consume(
        transport.stream(
          { model: 'gpt-6-astra', rule: openai, mode: 'standard' },
          generate('gpt-6-astra', 'chat/completions'),
        ),
      ),
      consume(
        transport.stream(
          { model: 'gpt-6-astra', rule: openai, mode: 'ultrafast' },
          generate('gpt-6-astra', 'responses'),
        ),
      ),
      consume(
        transport.stream(
          { model: 'claude-opus-5', rule: anthropic, mode: 'fast' },
          generate('claude-opus-5', 'messages'),
        ),
      ),
      consume(generate('gpt-6-astra', 'responses')()),
    ])
    assert.equal(fast[0].body.service_tier, 'fast')
    for (const request of seen.filter((item) => !item.url.endsWith('/messages')).slice(1)) {
      if (!request.headers.has('content-length'))
        assert.equal(request.headers.get('openai-service-tier'), null)
    }
    assert.equal(standard[0].body.service_tier, 'default')
    assert.equal(ultra[0].body.service_tier, 'ultrafast')
    assert.equal(claude[0].body.speed, 'fast')
    assert.equal(claude[0].beta, 'existing-beta,fast-mode-2026-02-01')
    assert.equal(untouched[0].body.service_tier, undefined)
    assert.deepEqual(fast[0].body.messages, [{ role: 'user', content: 'keep me' }])
    const mismatch = await consume(
      transport.stream(
        { model: 'gpt-6-astra', rule: openai, mode: 'fast' },
        generate('other', 'responses'),
      ),
    )
    assert.equal(mismatch[0].body.service_tier, undefined)
    signal.abort()
    assert.ok(seen.every((request) => request.signal.aborted))
    transport.dispose()
    assert.equal(globalThis.fetch, delegate)
    const after = await consume(
      transport.stream(
        { model: 'gpt-6-astra', rule: openai, mode: 'fast' },
        generate('gpt-6-astra', 'responses'),
      ),
    )
    assert.equal(after[0].body.service_tier, undefined)
  } finally {
    transport.dispose()
    globalThis.fetch = realFetch
  }
})

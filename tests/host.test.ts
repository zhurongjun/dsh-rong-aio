/** 速度宿主回归：按会话/路由持久化、HTTP 字段改写、并发作用域隔离及卸载恢复。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/components/model-selector/host/index.ts'

test('宿主接口：验证型号与协议、按会话隔离、持久化后回应、失败保留原值、释放资源', async () => {
  const records = new Map<string, string>()
  const effects: (() => unknown)[] = []
  let route: { fetch(request: Request): Promise<Response> } | undefined
  let fails = false
  let closed = false
  let protocol = 'openai-responses'
  const original = globalThis.fetch
  const ctx = {
    storageDomain: {
      async open(spec: { name: string }) {
        assert.match(spec.name, /^[a-z][a-z0-9_]*$/)
        return {
          table: () => ({
            get: (key: string) => records.get(key),
            async put(key: string, value: string) {
              if (fails) throw new Error('disk failure')
              records.set(key, value)
            },
          }),
          close() {
            closed = true
          },
        }
      },
    },
    effect(setup: () => () => unknown) {
      effects.push(setup())
    },
    connection: {
      fetch: {
        register(value: typeof route) {
          route = value
        },
      },
    },
    llm: {
      async resolveModelInfo(_provider: string, model: string) {
        return { name: model }
      },
      listConfigurableProviders() {
        return [
          {
            provider: 'fixture',
            settingsNs: 'llm-fixture',
            settingsPath: ['providers', 'fixture'],
          },
        ]
      },
    },
    settings: {
      describe() {
        return [{ ns: 'llm-fixture', value: { providers: { fixture: { api: protocol } } } }]
      },
    },
    on() {},
  }

  const call = async (mode?: string, sessionId = 'a', model = 'gpt-6-astra') => {
    const identity = { sessionId, provider: 'fixture', model }
    const response = await route!.fetch(
      mode
        ? new Request('https://fixture.invalid/api/rong-aio.speed', {
            method: 'PUT',
            body: JSON.stringify({ ...identity, mode }),
          })
        : new Request(
            `https://fixture.invalid/api/rong-aio.speed?${new URLSearchParams(identity)}`,
          ),
    )
    return { status: response.status, data: await response.json() }
  }

  try {
    await apply(ctx as unknown as Context)
    assert.deepEqual((await call()).data.modes, ['standard', 'fast', 'ultrafast'])
    assert.equal((await call('fast')).data.mode, 'fast')
    assert.equal((await call(undefined, 'b')).data.mode, 'standard')
    fails = true
    assert.equal((await call('ultrafast')).status, 503)
    assert.equal((await call()).data.mode, 'fast')
    assert.equal((await call('invalid')).status, 400)
    assert.equal((await call('fast', 'a', 'deepseek-v4')).status, 400)
    protocol = 'openai-completions'
    assert.deepEqual((await call()).data.modes, ['standard', 'fast'])
    assert.equal((await call('ultrafast')).status, 400)
    protocol = 'openai-codex-responses'
    assert.deepEqual((await call()).data.modes, [])
    assert.equal((await call('fast')).status, 400)
  } finally {
    for (const effect of effects.reverse()) await effect()
  }
  assert.ok(closed)
  assert.equal(globalThis.fetch, original)
})

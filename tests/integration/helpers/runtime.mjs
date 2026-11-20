/** 真实 DSH 请求链验证两个组件协作，网络、设置与速度存储使用可控替身。 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { SessionStore } from '@deepseek-ai/dsh-session'
import ClientModules from '@deepseek-ai/dsh-client-modules'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LlmRuntime, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import { prepareBundle } from './bundle.mjs'
import { fixture, prompt, route } from './files.mjs'

export async function runtime(t) {
  const f = await fixture()
  const ctx = new Context()
  t.after(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      await f.cleanup()
    }
  })
  await f.put()
  await f.configure()
  const wire = []
  const calls = []
  // 网络适配器只记录入参并触发可控 HTTP，不访问外部服务或产生模型费用。
  class Adapter extends LlmAdapter {
    async listModels(provider) {
      return [route.model, 'denied'].map((id) => ({ provider, id, name: id }))
    }

    async *stream(options) {
      calls.push(options)
      await fetch('https://fixture.invalid/responses', {
        method: 'POST',
        body: JSON.stringify({ model: options.model, input: options.messages }),
      })
      if (options.purpose === 'auto-review') {
        const text = JSON.stringify({ risk: 'high', decision: 'deny' })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }

  for (const plugin of [
    SessionProjectionRegistry,
    SessionStore,
    AgentRegistry,
    SystemPrompt,
    LlmRuntime,
    Tools,
    AgentLoop,
  ])
    await ctx.plugin(plugin, {})
  ctx.tools.setExecutor({
    describe: () => ({ schemas: [], knownNames: [] }),
    execute: () => {
      throw new Error('本测试不执行工具')
    },
  })
  ctx.llm.registerAdapter(['fixture'], new Adapter())
  ctx.llm.registerConfigurableProviders([
    { provider: 'fixture', displayName: 'Fixture', settingsNs: 'fixture', settingsPath: [] },
  ])
  ctx.provide('settings', {
    describe: () => [{ ns: 'fixture', value: { api: 'openai-responses' } }],
  })
  const records = new Map()
  ctx.provide('storageDomain', {
    open: async () => ({
      table: () => ({
        get: (key) => records.get(key),
        put: async (key, value) => {
          records.set(key, value)
        },
      }),
      close() {},
    }),
  })
  ctx.provide('dshHomePath', (name) => join(f.root, 'home', name))
  ctx.provide('workspaceRegistry', { list: () => [{ path: f.workspace }] })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'denied' }),
  })
  ctx.provide('sessionQuery', { inspectSession: async (id, read) => read(ctx.sessions.get(id)) })
  // 选模入口只代替宿主目录授权及默认保存；AgentModel、日志和调用上下文仍是真实服务。
  ctx.provide('sessionController', {
    async selectModel(request) {
      ctx.agents.get(request.sessionId).model.select(request)
      return { selected: request }
    },
  })
  new HostConnectionService(ctx, [], {})
  const http = ctx.connection.createSharedFetchHandler('/api')
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(
      typeof input === 'string' ? new URL(input, 'http://fixture/') : input,
      init,
    )
    if (new URL(request.url).origin === 'http://fixture')
      return http.fetch(request, ctx.connection.browserPeer)
    assert.equal(request.url, 'https://fixture.invalid/responses')
    wire.push(await request.json())
    return Response.json({})
  })

  const request = (path, body) =>
    http.fetch(
      new Request(
        `http://fixture/api/${path}`,
        body === undefined
          ? {}
          : {
              method: 'POST',
              body: JSON.stringify(body),
            },
      ),
      ctx.connection.browserPeer,
    )
  const components = await prepareBundle(ctx, f.root)
  await ctx.plugin(ClientModules)
  await ctx.loader.root.update([
    {
      id: 'sessions',
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: join(f.root, 'sessions') },
    },
    ...components,
  ])
  await ctx.loader.await()
  const clients = () =>
    ctx.clientModules
      .graph()
      .entries.map((entry) => entry.id)
      .sort()
  const enable = async (id, enabled) => {
    await ctx.loader.update(id, { disabled: !enabled })
    await ctx.loader.await()
  }

  const { agent } = await ctx.agents.create({
    sessionId: 'native-loop',
    meta: { cwd: f.workspace },
    agentOptions: route,
  })
  const run = async (target = agent) => {
    target.followup(
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'test' }] }),
    )
    await target.whenIdle()
    return target.session.snapshotEvents().at(-1).data.reason
  }

  const injectRequest = (command, query = {}) =>
    request('rong-aio.system-inject?' + new URLSearchParams(query), command)
  const injectView = async (query) => {
    const response = await injectRequest(undefined, query)
    assert.equal(response.status, 200)
    return response.json()
  }
  return {
    ...f,
    route,
    prompt,
    ctx,
    request,
    injectRequest,
    injectView,
    run,
    enable,
    agent,
    clients,
    calls,
    wire,
  }
}

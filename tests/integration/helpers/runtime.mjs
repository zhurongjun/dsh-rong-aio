/** 真实 DSH 请求链验证两个组件协作，网络、设置与速度存储使用可控替身。 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import ClientModules from '@deepseek-ai/dsh-client-modules'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LlmRuntime, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import Commands from '@deepseek-ai/dsh-commands'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Approval from '@deepseek-ai/dsh-user-approval'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import { prepareBundle } from './bundle.mjs'
import { fixture, prompt, route } from './files.mjs'

export async function runtime(t, { side = false, reply } = {}) {
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
        body: JSON.stringify({
          model: options.model,
          input: options.messages,
          tools: options.tools,
          toolHistory: options.toolHistory,
        }),
      })
      if (options.purpose === 'auto-review') {
        const text = JSON.stringify({ risk: 'high', decision: 'deny' })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      } else if (reply) {
        yield* reply(options)
        return
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }

  for (const plugin of [
    SessionProjectionRegistry,
    SessionStore,
    AgentRegistry,
    SessionQueryEngine,
    SystemPrompt,
    LlmRuntime,
    Tools,
    AgentLoop,
  ])
    await ctx.plugin(plugin, {})
  ctx.tools.setExecutor({
    describe: (tools) => ({
      schemas: tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      })),
    }),
    execute: (input) => executeToolBatch(input, new ToolExecutionPipeline(ctx), () => 1),
  })
  ctx.llm.registerAdapter(['fixture'], new Adapter())
  ctx.llm.registerConfigurableProviders([
    { provider: 'fixture', displayName: 'Fixture', settingsNs: 'fixture', settingsPath: [] },
  ])
  ctx.provide('settings', {
    configure: () => () => {},
    describe: () => [{ ns: 'fixture', value: { api: 'openai-responses' } }],
  })
  if (side) {
    ctx.provide('shell', { sandboxMode: 'workspace-write' })
    for (const plugin of [Commands, SandboxPolicy, Approval, PermissionPresets])
      await ctx.plugin(plugin, {})
  }
  const domains = new Map()
  const savedTables = new Map()
  ctx.provide('storageDomain', {
    get: (name) => domains.get(name),
    open: async (spec) => {
      let global = spec.global?.initial
      const tables = new Map(
        Object.keys(spec.tables).map((name) => {
          const key = spec.name + '/' + name
          const records = savedTables.get(key) ?? new Map()
          savedTables.set(key, records)
          return [
            name,
            {
              get size() {
                return records.size
              },
              keys: () => records.keys(),
              entries: () => records.entries(),
              get: (key) => records.get(key),
              delete: async (key) => records.delete(key),
              put: async (key, value) => {
                records.set(key, value)
              },
              update: async (key, change) => {
                const value = change(records.get(key))
                records.set(key, value)
                return value
              },
            },
          ]
        }),
      )
      const domain = {
        table: (name) => tables.get(name),
        global: {
          get: () => global,
          set: async (value) => {
            global = value
          },
        },
        close: () => domains.delete(spec.name),
      }
      domains.set(spec.name, domain)
      return domain
    },
  })
  ctx.provide('dshHomePath', (name) => join(f.root, 'home', name))
  ctx.plugin(WorkspaceRegistry)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'denied' }),
  })
  // 选模入口只代替宿主目录授权及默认保存；AgentModel、日志和调用上下文仍是真实服务。
  const openedDirectories = []
  ctx.provide('sessionController', {
    canOpenWorkspacePath: () => true,
    async openWorkspacePath({ path }) {
      openedDirectories.push(path)
      return { opened: true }
    },
    async selectModel(request) {
      ctx.agents.get(request.sessionId).model.select(request)
      return { selected: request }
    },
    async resolveAgent(id) {
      const agent = ctx.agents.get(id)
      return agent ? { agent } : { error: new Error('不存在的会话') }
    },
    async prompt({ sessionId, content }) {
      ctx.agents.get(sessionId).followup(createUserMessage({ source: { kind: 'user' }, content }))
      return { accepted: true }
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
  await ctx.workspaceRegistry.create(f.workspace)
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
    openedDirectories,
  }
}

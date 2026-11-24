import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import ClientModules from '@deepseek-ai/dsh-client-modules'
import Commands from '@deepseek-ai/dsh-commands'
import { LlmAdapter, LlmRuntime, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SessionStore, type SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import Approval from '@deepseek-ai/dsh-user-approval'
import { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { prepareBundle } from './bundle.ts'
import { fixture, prompt, route } from './files.ts'

export interface RuntimeOptions {
  side?: boolean
  spills?: boolean
  reply?: (options: Record<string, unknown>) => AsyncGenerator<Record<string, unknown>>
}

function provideStub(ctx: Context, key: string, value: unknown): void {
  ;(ctx as unknown as { provide(name: string, impl: unknown): void }).provide(key, value)
}

export async function runtime(
  t: TestContext,
  { side = false, spills = false, reply }: RuntimeOptions = {},
) {
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

  const wire: Array<Record<string, unknown>> = []
  const calls: Array<Record<string, unknown>> = []
  const protocols: Record<string, string> = {
    fixture: 'openai-responses',
    openai: 'openai-responses',
    anthropic: 'anthropic-messages',
  }
  let failWrites = false

  const reasoning = {
    efforts: ['off', 'medium', 'high'].map((id) => ({ id: ReasoningEffortId(id), name: id })),
  }

  class Adapter extends LlmAdapter {
    async listModels(provider: string) {
      return [route.model, 'denied'].map((id) => ({ provider, id, name: id }))
    }

    async resolveModel(provider: string, model: string) {
      return {
        provider,
        id: model,
        name: model === 'catalog-alias' ? 'GPT 6 Astra' : model,
        ...(model === route.model ? { reasoning } : {}),
      }
    }

    async *stream(options: Parameters<LlmAdapter['stream']>[0]) {
      const record = options as unknown as Record<string, unknown>
      calls.push(record)
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
        yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
        yield { type: 'text-delta' as const, index: 0, text }
        yield { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text } }
      } else if (reply) {
        yield* reply(record) as AsyncGenerator<never>
        return
      }
      yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
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
  ]) {
    await ctx.plugin(plugin as Parameters<Context['plugin']>[0], {})
  }

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

  ctx.llm.registerAdapter(['fixture', 'openai', 'anthropic'], new Adapter())
  ctx.llm.registerConfigurableProviders(
    [
      { provider: 'fixture', displayName: 'Fixture' },
      { provider: 'openai', displayName: 'OpenAI' },
      { provider: 'anthropic', displayName: 'Anthropic' },
    ].map((entry) => ({ ...entry, settingsNs: entry.provider, settingsPath: [] })),
  )

  provideStub(ctx, 'settings', {
    configure: () => () => {},
    describe: () => Object.entries(protocols).map(([ns, api]) => ({ ns, value: { api } })),
  })

  if (side) {
    provideStub(ctx, 'shell', { sandboxMode: 'workspace-write' })
    for (const plugin of [Commands, SandboxPolicy, Approval, PermissionPresets]) {
      await ctx.plugin(plugin as Parameters<Context['plugin']>[0], {})
    }
  }

  const domains = new Map<string, unknown>()
  const savedTables = new Map<string, Map<string, unknown>>()
  provideStub(ctx, 'storageDomain', {
    get: (name: string) => domains.get(name),
    open: async (spec: {
      name: string
      global?: { initial?: unknown }
      tables: Record<string, unknown>
    }) => {
      let global = spec.global?.initial
      const tables = new Map(
        Object.keys(spec.tables).map((name) => {
          const key = spec.name + '/' + name
          const records = savedTables.get(key) ?? new Map<string, unknown>()
          savedTables.set(key, records)
          return [
            name,
            {
              get size() {
                return records.size
              },
              keys: () => records.keys(),
              entries: () => records.entries(),
              get: (entryKey: string) => records.get(entryKey),
              delete: async (entryKey: string) => records.delete(entryKey),
              put: async (entryKey: string, value: unknown) => {
                if (failWrites) throw new Error('disk failure')
                records.set(entryKey, value)
              },
              update: async (entryKey: string, change: (prev: unknown) => unknown) => {
                if (failWrites) throw new Error('disk failure')
                const value = change(records.get(entryKey))
                records.set(entryKey, value)
                return value
              },
            },
          ]
        }),
      )
      const domain = {
        table: (name: string) => tables.get(name),
        global: {
          get: () => global,
          set: async (value: unknown) => {
            global = value
          },
        },
        close: () => domains.delete(spec.name),
      }
      domains.set(spec.name, domain)
      return domain
    },
  })

  provideStub(ctx, 'dshHomePath', (name: string) => join(f.root, 'home', name))
  await ctx.plugin(WorkspaceRegistry)
  provideStub(ctx, 'agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'denied' }),
  })

  const openedDirectories: string[] = []
  ctx.plugin({
    name: 'session-controller-stub',
    inject: ['agents'],
    apply(controllerCtx) {
      provideStub(controllerCtx, 'sessionController', {
        canOpenWorkspacePath: () => true,
        async openWorkspacePath({ path }: { path: string }) {
          openedDirectories.push(path)
          return { opened: true }
        },
        async selectModel(selection: {
          sessionId: string
          provider: string
          model: string
          reasoningEffort?: string
        }) {
          const target = controllerCtx.agents.get(selection.sessionId as SessionId)
          assert.ok(target, `missing agent ${selection.sessionId}`)
          target.model.select(selection as never)
          return { selected: selection }
        },
        async resolveAgent(id: string) {
          const live = controllerCtx.agents.get(id as SessionId)
          if (live) return { agent: live }
          const persistence = controllerCtx.get('sessionPersistence')
          const stored = await persistence?.stat(id as SessionId)
          if (!stored || stored.header.origin === 'subagent') {
            return { error: new Error('不存在的会话') }
          }
          const resumed = await controllerCtx.agents.resume({
            resumeSessionId: id as SessionId,
            agentOptions: route,
          })
          return { agent: resumed.agent }
        },
        async prompt({ sessionId, content }: { sessionId: string; content: never }) {
          const target = controllerCtx.agents.get(sessionId as SessionId)
          assert.ok(target, `missing agent ${sessionId}`)
          target.followup(createUserMessage({ source: { kind: 'user' }, content }))
          return { accepted: true }
        },
      })
    },
  })

  new HostConnectionService(ctx, [], {} as never)
  const http = ctx.connection.createSharedFetchHandler('/api')

  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(
      typeof input === 'string' ? new URL(input, 'http://fixture/') : input,
      init,
    )
    const url = new URL(req.url)
    if (url.origin === 'http://fixture') return http.fetch(req, ctx.connection.browserPeer)
    assert.equal(url.origin, 'https://fixture.invalid')
    const payload = (await req.json()) as Record<string, unknown>
    if (url.pathname.startsWith('/v1/')) {
      return Response.json({ payload, beta: req.headers.get('anthropic-beta') })
    }
    wire.push(payload)
    return Response.json({})
  })

  const request = (path: string, body?: unknown) =>
    http.fetch(
      new Request(
        `http://fixture/api/${path}`,
        body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) },
      ),
      ctx.connection.browserPeer,
    )

  const spillsRoot = join(f.root, 'spills')
  const components = await prepareBundle(ctx, f.root, { spills })
  await ctx.plugin(ClientModules)
  await ctx.loader.root.update([
    {
      id: 'sessions',
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: join(f.root, 'sessions') },
    },
    ...(spills
      ? [
          {
            id: 'spill',
            name: '@deepseek-ai/dsh-spill-local',
            config: { root: spillsRoot },
          },
        ]
      : []),
    ...components,
  ])
  await ctx.loader.await()
  await ctx.workspaceRegistry.create(f.workspace)

  const clients = () =>
    ctx.clientModules
      .graph()
      .entries.map((entry) => entry.id)
      .sort()

  const enable = async (id: string, enabled: boolean) => {
    await ctx.loader.update(id, { disabled: !enabled })
    await ctx.loader.await()
  }

  const { agent } = await ctx.agents.create({
    sessionId: 'native-loop' as SessionId,
    meta: { cwd: f.workspace },
    agentOptions: route,
  })

  const getAgent = (id: string) => {
    const found = ctx.agents.get(id as SessionId)
    assert.ok(found, `missing agent ${id}`)
    return found
  }

  const run = async (target = agent, text = 'test') => {
    target.followup(
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    )
    await target.whenIdle()
    return (target.session.snapshotEvents().at(-1)?.data as { reason?: unknown } | undefined)
      ?.reason
  }

  const injectRequest = (command?: unknown, query: Record<string, string> = {}) =>
    request('rong-aio.system-inject?' + new URLSearchParams(query), command)

  const injectView = async (query?: Record<string, string>) => {
    const response = await injectRequest(undefined, query)
    assert.equal(response.status, 200)
    return response.json() as Promise<Record<string, any>>
  }

  return {
    ...f,
    route,
    prompt,
    ctx,
    spillsRoot,
    protocols,
    failStorageWrites() {
      failWrites = true
    },
    request,
    injectRequest,
    injectView,
    run,
    enable,
    agent,
    getAgent,
    clients,
    calls,
    wire,
    openedDirectories,
  }
}

export type RuntimeFixture = Awaited<ReturnType<typeof runtime>>

export async function storedSession(
  f: RuntimeFixture,
  id: string,
  workspace = f.ctx.workspaceRegistry.list()[0],
  text?: string,
  meta?: { parentSession?: SessionId; origin?: 'subagent' },
) {
  const handle = await f.ctx.agents.create({
    sessionId: id as SessionId,
    meta: { cwd: workspace.path, ...meta },
    agentOptions: f.route,
  })
  if (text !== undefined) {
    handle.agent.followup(
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    )
    await handle.agent.whenIdle()
  }
  await f.ctx.sessions.flush(handle.agent.session)
  const stored = await f.ctx.sessionPersistence.stat(id as never)
  assert.ok(stored?.location && stored.location.kind === 'jsonl')
  if (meta?.origin !== 'subagent') await workspace.attachSession(id as never)
  await handle.dispose()
  return {
    directory: dirname(stored.location.path),
    target: { id, createdAt: stored.header.createdAt },
  }
}

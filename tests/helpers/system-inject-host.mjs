import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import * as component from '../../src/components/system-inject/host/index.ts'
import { fixture, prompt, route } from './system-inject.ts'

export async function hostFixture(t) {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  const ctx = new Context()
  const selection = { current: route, assembled: undefined }
  const agent = {
    id: 'native-s',
    ctx,
    options: route,
    session: {
      header: { id: 'native-s', cwd: f.workspace },
      requestHeader: () => undefined,
      snapshotEvents: () => [],
    },
  }
  const agents = [agent]
  let fiber
  let endpoint
  let failFlush = false
  let calls = 0
  let failApi = false
  ctx.provide('agents', { list: () => agents, isOwnedBy: () => false })
  ctx.provide('dshHomePath', (path) => join(f.root, 'home', path))
  ctx.provide('sessions', {
    get: (id) => agents.find((a) => a.id === id)?.session,
    flush: async () => {
      if (failFlush) throw new Error('disk failure')
      return true
    },
  })
  let modelCommits = 0
  const nativeSelect = async (request) => {
    modelCommits++
    selection.current = { provider: request.provider, model: request.model }
    return { selected: selection.current }
  }
  ctx.provide('sessionController', { selectModel: nativeSelect })
  ctx.provide('sessionProjections', { stateOf: () => ({ pending: selection.current }) })
  ctx.provide('agentDefaultModel', { currentSelection: () => route })
  ctx.provide('sessionPersistence', {
    name: 'session-persistence-jsonl',
    stat: async (id) => ({ header: agents.find((a) => a.id === id).session.header }),
  })
  const entries = [
    {
      options: { name: '@deepseek-ai/dsh-session-persistence-jsonl' },
      disabled: false,
      fiber: { state: 2, config: { root: join(f.root, 'sessions') } },
    },
  ]
  ctx.provide('loader', {
    entries: function* () {
      yield* entries
    },
  })
  ctx.provide('workspaceRegistry', { list: () => [{ path: f.workspace, title: '工程' }] })
  ctx.provide('llm', {
    listProviders: () => [{ id: 'fixture' }],
    listModels: async () => [{ id: 'allowed' }, { id: 'denied' }],
  })
  ctx.provide('connection', {
    fetch: {
      register: (value) => {
        endpoint = value
        fiber.ctx.effect(() => () => {
          endpoint = undefined
        })
      },
    },
  })
  await ctx.plugin(SystemPrompt, {})
  ctx.systemPrompt.section({ name: 'base', order: 1, text: 'KEEP ORIGINAL DSH RULES' })
  const release = installModelSelection(ctx, selection)
  fiber = ctx.plugin(component)
  await fiber
  const api = async (command, id = agent.id) => {
    const scoped = command && !('sessionId' in command) ? undefined : id
    const url = 'http://fixture/api/rong-aio.system-inject' + (scoped ? '?sessionId=' + scoped : '')
    if (command && !command.revision && !('sessionId' in command))
      command = { ...command, revision: (await api(undefined, '')).config.revision }
    const response = await endpoint.fetch(
      new Request(url, command ? { method: 'POST', body: JSON.stringify(command) } : undefined),
    )
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }
  const stream = async (options = {}) => {
    try {
      const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
      const actualRoute = await ctx.waterfall('agent/request', { agent }, async () => ({
        provider: 'fixture',
        model: 'seed',
      }))
      const request = {
        ...actualRoute,
        sessionId: agent.id,
        messages: [createSystemMessage(renderPrompt(assembly))],
        ...options,
      }
      for await (const _chunk of ctx.waterfall('llm/stream', request, async function* () {
        calls++
        if (failApi) throw new Error('API failure')
        yield { type: 'finish', reason: { kind: 'stop' } }
      })) {
        /* drain the actual middleware */
      }
      return request
    } finally {
      ctx.emit('agent/status', { agent, status: 'idle' })
    }
  }
  const dispose = async () => {
    release()
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
  t.after(dispose)
  return {
    ...f,
    ctx,
    agent,
    agents,
    entries,
    selection,
    api,
    stream,
    fiber,
    modelCommits: () => modelCommits,
    nativeSelect,
    async reload() {
      await fiber.dispose()
      fiber = ctx.plugin(component)
      await fiber
      return fiber
    },
    calls: () => calls,
    endpoint: () => endpoint,
    failFlush(value) {
      failFlush = value
    },
    failApi(value) {
      failApi = value
    },
    async frozen(id = agent.id) {
      return JSON.parse(
        await readFile(join(f.location({ id, cwd: f.workspace }), 'system_inject.json'), 'utf8'),
      )
    },
    prompt,
    route,
  }
}

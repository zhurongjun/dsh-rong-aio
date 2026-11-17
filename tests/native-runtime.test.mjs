/** 新版真实运行链回归：使用 Cordis、Connection、AgentLoop、LLM、JSONL、Session 与 SystemPrompt；网络、设置与速度存储为可控替身。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { SessionStore } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LlmRuntime, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import TeamService from '@deepseek-ai/dsh-agent-team'
import * as injectComponent from '../src/components/system-inject/host/index.ts'
import * as speedComponent from '../src/components/model-selector/host/index.ts'
import { fixture, prompt } from './helpers/system-inject.ts'

test('原生 Team 服务：根会话选项持久化与投影同步，子会话不能修改，重载恢复选择', async (t) => {
  const f = await fixture(t)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [
    SessionProjectionRegistry,
    SessionStore,
    AgentRegistry,
    SystemPrompt,
    LlmRuntime,
    Tools,
    AgentLoop,
  ])
    await ctx.plugin(plugin)
  await ctx.plugin(JsonlPersistence, { root: join(f.root, 'sessions') })
  // 本测试不创建真实 subagent 运行树，只提供根解析；Team、投影、会话和磁盘均为原生服务。
  ctx.provide('subagents', {
    rootOf: (agent) =>
      agent.session.header.parentSession
        ? ctx.agents.get(agent.session.header.parentSession)
        : agent,
  })
  let team = ctx.plugin(TeamService)
  await team
  const { agent: root } = await ctx.agents.create({
    sessionId: 'team-root',
    meta: { cwd: f.workspace },
  })
  const { agent: child } = await ctx.agents.create({
    sessionId: 'team-child',
    meta: { cwd: f.workspace, parentSession: root.id, origin: 'subagent' },
  })
  const enabled = () => ctx.sessionProjections.snapshot(root.session).values.agentTeam.enabled
  assert.equal(enabled(), false)
  await ctx.agentTeams.setEnabled(root, true)
  assert.equal(enabled(), true)
  await ctx.agentTeams.setEnabled(root, true)
  assert.equal(
    root.session.snapshotEvents().filter((event) => event.type === 'team/mode').length,
    1,
  )
  await assert.rejects(ctx.agentTeams.setEnabled(child, false), /root Session/)
  assert.equal(enabled(), true)
  await team.dispose()
  team = ctx.plugin(TeamService)
  await team
  assert.equal(enabled(), true)
  await ctx.agentTeams.setEnabled(root, false)
  assert.equal(enabled(), false)
  assert.equal((await ctx.sessionPersistence.stat(root.id)).header.id, root.id)
})

test('真实 rc.3 请求链：POST 保存 Fast、首段冻结、重试与子会话护栏、独立停用及路由释放', async (t) => {
  const f = await fixture(t)
  const route = { provider: 'fixture', model: 'gpt-6-astra' }
  await f.put()
  await f.configure([route])
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const originalFetch = globalThis.fetch
  const wire = []
  const calls = []
  globalThis.fetch = async (input, init) => {
    wire.push(await new Request(input, init).json())
    return Response.json({})
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  // 网络适配器只记录入参并触发可控 HTTP，不访问外部服务或产生模型费用。
  class Adapter extends LlmAdapter {
    async listModels() {
      return [route.model, 'denied'].map((id) => ({ id, name: id }))
    }

    async *stream(options) {
      calls.push(options)
      await fetch('https://fixture.invalid/responses', {
        method: 'POST',
        body: JSON.stringify({ model: options.model, input: options.messages }),
      })
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
  ctx.provide('sessionQuery', {
    inspectSession: () => {
      throw new Error('驻留会话不应读取冷日志')
    },
  })
  await ctx.plugin(JsonlPersistence, { root: join(f.root, 'sessions') })
  ctx.provide('loader', {
    entries: function* () {
      yield {
        options: { name: '@deepseek-ai/dsh-session-persistence-jsonl' },
        disabled: false,
        fiber: { state: 2, effectiveConfig: { root: join(f.root, 'sessions') } },
      }
    },
  })
  // 选模入口只代替宿主目录授权及默认保存；AgentModel、日志和调用上下文仍是真实服务。
  ctx.provide('sessionController', {
    async selectModel(request) {
      ctx.agents.get(request.sessionId).model.select(request)
      return { selected: request }
    },
  })
  new HostConnectionService(ctx, [], {})
  const http = ctx.connection.createSharedFetchHandler('/api')
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
  let injectFiber = ctx.plugin(injectComponent)
  await injectFiber
  const speedFiber = ctx.plugin(speedComponent)
  await speedFiber

  const { agent } = await ctx.agents.create({
    sessionId: 'native-loop',
    meta: { cwd: f.workspace },
    agentOptions: route,
  })
  const identity = { sessionId: agent.id, ...route }
  const saved = await request('rong-aio.speed', { ...identity, mode: 'fast' })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).mode, 'fast')
  const selection = await request('rong-aio.system-inject', {
    type: 'select',
    sessionId: agent.id,
    state: { name: prompt.name },
  })
  assert.equal(selection.status, 200, JSON.stringify(await selection.json()))

  const run = async (target = agent) => {
    target.followup(
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'test' }] }),
    )
    await target.whenIdle()
    return target.session.snapshotEvents().at(-1).data.reason
  }
  assert.deepEqual(await run(), { kind: 'completed' })
  assert.equal(calls.length, 1)
  assert.equal(wire[0].service_tier, 'fast')
  assert.deepEqual(wire[0].input, calls[0].messages)
  const text = calls[0].messages[0].content[0].text
  assert.ok(text.startsWith(prompt.body))
  assert.match(text, /DeepSeek Harness/)
  const frozen = JSON.parse(
    await readFile(join(f.location(agent.session.header), 'system_inject.json'), 'utf8'),
  )
  assert.equal(frozen.state.snapshot.body, prompt.body)

  // 最新白名单对重试和实际子会话请求同样有效，拒绝不得进入适配器。
  await f.configure([])
  assert.equal((await run()).kind, 'error')
  assert.equal(calls.length, 1)
  const { agent: child } = await ctx.agents.create({
    sessionId: 'native-child',
    meta: { cwd: f.workspace, parentSession: agent.id, origin: 'subagent' },
    agentOptions: route,
  })
  assert.equal((await run(child)).kind, 'error')
  assert.equal(calls.length, 1)
  await f.configure([route])
  assert.deepEqual(await run(child), { kind: 'completed' })
  assert.equal(calls.length, 2)
  assert.equal(wire[1].service_tier, 'default')

  await speedFiber.dispose()
  assert.equal((await request('rong-aio.speed?' + new URLSearchParams(identity))).status, 404)
  await assert.rejects(
    ctx.sessionController.selectModel({
      sessionId: agent.id,
      provider: 'fixture',
      model: 'denied',
    }),
  )
  assert.deepEqual(await run(), { kind: 'completed' })
  assert.equal(wire.at(-1).service_tier, undefined)
  await injectFiber.dispose()
  assert.equal((await request('rong-aio.system-inject?sessionId=' + agent.id)).status, 404)
  await ctx.sessionController.selectModel({
    sessionId: agent.id,
    provider: 'fixture',
    model: 'denied',
  })
  assert.deepEqual(await run(), { kind: 'completed' })
  assert.ok(!calls.at(-1).messages[0].content[0].text.includes(prompt.body))
  injectFiber = ctx.plugin(injectComponent)
  await injectFiber
  await ctx.sessionController.selectModel({ sessionId: agent.id, ...route })
  assert.deepEqual(await run(), { kind: 'completed' })
  assert.ok(calls.at(-1).messages[0].content[0].text.startsWith(prompt.body))
})

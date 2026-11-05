/** 宿主夹具：真实 Cordis/SystemPrompt 与可控原生服务组合，不发起外部模型 API 调用。 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import * as component from '../../src/components/system-inject/host/index.ts'
import { fixture, prompt, route } from './system-inject.ts'

/**
 * 启动真实组件宿主，保留原生选模、存储、目录等服务的可控最小替身。
 * 适配器调用次数只在护栏放行后累加，用于证明拒绝请求没有进入模型 API。
 */
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

  // 原生服务替身：只实现组件依赖的公开面，副作用与失败均由测试显式控制。
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

  /** 模拟原生选模落盘边界；计数用于验证校验失败时没有先保存再回滚。 */
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

  // 装配真实中间件；固定基础段用于核验注入保留 DSH 原有系统提示词。
  await ctx.plugin(SystemPrompt, {})
  ctx.systemPrompt.section({ name: 'base', order: 1, text: 'KEEP ORIGINAL DSH RULES' })
  const release = installModelSelection(ctx, selection)
  fiber = ctx.plugin(component)
  await fiber

  /** 调用组件注册的真实 HTTP handler；设置命令自动补充最新 revision，并要求成功响应。 */
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

  /** 执行真实提示词装配与事件瀑布，模拟最终适配器；无论成功失败都发出 idle 释放候选。 */
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

  /** 释放模型安装钩子、组件 fiber 与根 Context，避免测试间泄漏方法包装。 */
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

    /** 仅卸载并重新装载组件，保留磁盘文件，用于验证持久化与内存状态的差异。 */
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

    /** 直接读取伴随文件断言落盘结果；不存在时抛 ENOENT，不能由 UI 状态替代。 */
    async frozen(id = agent.id) {
      return JSON.parse(
        await readFile(join(f.location({ id, cwd: f.workspace }), 'system_inject.json'), 'utf8'),
      )
    },
    prompt,
    route,
  }
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import TeamService from '@deepseek-ai/dsh-agent-team'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { runtime, type RuntimeFixture } from './helpers/runtime.ts'

interface WireMessage {
  role: string
  isError?: boolean
  toolCallId?: string
  source: { kind: string }
  content: Array<{ text?: string }>
}

async function draft(f: RuntimeFixture, parent: string = f.agent.id) {
  const response = await f.request('rong-aio.side', { parent, action: 'draft' })
  const body = (await response.json()) as { fork: Record<string, unknown> }
  assert.equal(response.status, 200, JSON.stringify(body))
  return body.fork
}

async function sendFirst(
  f: RuntimeFixture,
  point: Record<string, unknown>,
  text = '侧聊首条消息',
  key = randomUUID(),
) {
  const response = await f.request('rong-aio.side', {
    ...point,
    action: 'create',
    key,
    text,
    permission: 'read',
  })
  const body = (await response.json()) as { id: string }
  assert.equal(response.status, 200, JSON.stringify(body))
  return body.id
}

async function say(f: RuntimeFixture, agentId: string, text: string) {
  const signal = new AbortController().signal
  await f.ctx.sessionController.prompt(
    { sessionId: agentId as SessionId, content: [{ type: 'text', text }] } as never,
    signal,
  )
  await f.getAgent(agentId).whenIdle()
}

function assertSideOpening(input: WireMessage[], parent: string, question: string): number {
  const policies = input.filter((m) =>
    m.content[0]?.text?.startsWith('<system-reminder>\nYou are in a side conversation'),
  )
  const boundaries = input.filter((m) =>
    m.content[0]?.text?.startsWith('Side conversation boundary.\n'),
  )
  assert.equal(policies.length, 1)
  assert.equal(boundaries.length, 1)

  const start = input.indexOf(policies[0])
  assert.deepEqual(
    input.slice(start, start + 3).map((m) => m.role),
    ['user', 'user', 'user'],
  )
  assert.equal(input[start + 1], boundaries[0])
  assert.notEqual(policies[0].source.kind, 'user')
  assert.notEqual(boundaries[0].source.kind, 'user')
  assert.match(
    policies[0].content[0].text ?? '',
    /Only instructions submitted after the side-conversation boundary are active/,
  )
  assert.match(policies[0].content[0].text ?? '', /Sub-agents are off-limits/)
  assert.ok(
    boundaries[0].content[0].text?.includes(
      'Parent chat: ' + JSON.stringify({ sessionId: parent }),
    ),
  )
  assert.equal(input[start + 2].source.kind, 'user')
  assert.equal(input[start + 2].content[0].text, question)
  return start
}

test('从未发言的主会话新建侧聊时，原生系统提示在前，首问前仅一组侧聊规则和边界', async (t) => {
  const f = await runtime(t, { side: true })
  const id = await sendFirst(f, await draft(f), '空主会话的首问')
  await f.getAgent(id).whenIdle()

  const input = f.wire.at(-1)?.input as WireMessage[]
  assert.equal(input[0].role, 'system')
  assert.ok(assertSideOpening(input, f.agent.id, '空主会话的首问') >= 1)
})

test('侧聊冻结分叉上下文，隔离主会话后续消息并支持重载恢复与删除', async (t) => {
  const f = await runtime(t, { side: true })
  const parent = f.agent.id
  const history = async () =>
    (
      (await (await f.request('rong-aio.side?parent=' + parent)).json()) as {
        rows: Array<{ title: string }>
      }
    ).rows

  await say(f, parent, '主会话的分叉点')
  const key = randomUUID()
  const point = await draft(f)
  assert.deepEqual(await history(), [])
  assert.equal(await f.ctx.sessionPersistence.stat(('rong-side-' + key) as SessionId), undefined)

  await say(f, parent, '主会话稍后的消息')
  const parentRequest = f.wire.at(-1) as {
    model: string
    tools: unknown
    input: WireMessage[]
  }

  const id = await sendFirst(f, point, '只在侧聊出现的问题', key)
  assert.equal(await sendFirst(f, point, '只在侧聊出现的问题', key), id)
  assert.equal((await f.request('rong-aio.side', { parent, action: 'open', id })).status, 200)
  const child = f.getAgent(id)
  await child.whenIdle()

  const sideRequest = f.wire.at(-1) as { model: string; tools: unknown; input: WireMessage[] }
  assert.equal(sideRequest.model, parentRequest.model)
  assert.deepEqual(sideRequest.tools, parentRequest.tools)
  assert.deepEqual(sideRequest.input.slice(0, parentRequest.input.length), parentRequest.input)
  const policyIndex = assertSideOpening(sideRequest.input, parent, '只在侧聊出现的问题')
  const sideSerialized = JSON.stringify(sideRequest.input)
  assert.match(sideSerialized, /主会话的分叉点/)
  assert.match(sideSerialized, /主会话稍后的消息/)

  await say(f, parent, '回到主会话')
  const nextParent = f.wire.at(-1)?.input as WireMessage[]
  const nextQuestion = nextParent.findIndex((m) => m.content[0]?.text === '回到主会话')
  assert.deepEqual(sideRequest.input.slice(0, policyIndex), nextParent.slice(0, nextQuestion))
  assert.doesNotMatch(
    JSON.stringify(nextParent),
    /只在侧聊出现的问题|Side conversation boundary|You are in a side conversation/,
  )
  assert.equal((await history())[0].title, '只在侧聊出现的问题')
  assert.deepEqual(child.model.current(), f.agent.model.current())

  assert.equal(((await draft(f, id)) as { parent: string }).parent, parent)
  const nested = await f.request('rong-aio.side', {
    ...point,
    action: 'create',
    text: 'nested',
    permission: 'read',
    parent: id,
    key: randomUUID(),
  })
  assert.equal(nested.status, 409)
  assert.equal((await f.request('rong-aio.side', { parent, action: 'delete', id })).status, 400)

  await f.enable('rong-aio-side', false)
  await f.enable('rong-aio-side', true)
  assert.equal((await f.request('rong-aio.side', { parent, action: 'open', id })).status, 200)
  await say(f, id, '恢复后继续')

  const restoredInput = f.wire.at(-1)?.input as WireMessage[]
  assert.deepEqual(restoredInput.slice(0, sideRequest.input.length), sideRequest.input)
  assertSideOpening(restoredInput, parent, '只在侧聊出现的问题')
  assert.doesNotMatch(JSON.stringify(restoredInput), /回到主会话/)

  assert.equal(
    (await f.request('rong-aio.side', { parent, action: 'delete', id, confirmed: true })).status,
    200,
  )
  assert.deepEqual(await history(), [])
  assert.equal(await f.ctx.sessionPersistence.stat(id as SessionId), undefined)
})

test('侧聊独立控制只读与跟随权限，禁止通过命令修改权限', async (t) => {
  const f = await runtime(t, { side: true })
  const parent = f.agent.id
  const signal = new AbortController().signal
  let writes = 0

  f.ctx.tools.register({
    name: 'write',
    description: '测试写入',
    parameters: { type: 'object' } as never,
    output: { schema: { type: 'boolean' } as never, render: () => [{ type: 'text', text: 'ok' }] },
    execute: async () => {
      writes++
      return true
    },
  })

  await say(f, parent, '主会话消息')
  const id = await sendFirst(f, await draft(f), '权限测试')
  const child = f.getAgent(id)
  await child.whenIdle()

  const runWrite = () =>
    executeToolBatch(
      {
        agent: child,
        signal,
        calls: [
          { type: 'tool-call', id: randomUUID() as ToolCallId, name: 'write', arguments: '{}' },
        ],
      },
      new ToolExecutionPipeline(f.ctx),
      () => 1,
    )

  await runWrite()
  assert.equal(writes, 0)

  const override = await f.ctx.commands.execute(child, '/permission danger-full-access', [], signal)
  assert.ok(override)
  assert.equal(override.result.kind, 'error')
  await runWrite()
  assert.equal(writes, 0)

  assert.equal(
    (await f.request('rong-aio.side', { parent, action: 'permission', id, permission: 'follow' }))
      .status,
    200,
  )
  await runWrite()
  assert.equal(writes, 1)

  f.ctx.permissionPresets.set(f.agent.session, 'danger-full-access')
  await Promise.resolve()
  assert.equal(f.ctx.permissionPresets.current(child.session), 'danger-full-access')

  assert.equal(
    (await f.request('rong-aio.side', { parent, action: 'permission', id, permission: 'read' }))
      .status,
    200,
  )
  await runWrite()
  assert.equal(writes, 1)
})

test('主会话可以在侧聊等待审批时继续，侧聊的两次审批单独留痕', { timeout: 15000 }, async (t) => {
  const f = await runtime(t, { side: true })
  const parent = f.agent.id
  await f.run()
  const post = (action: string, fields: Record<string, unknown>) =>
    f.request('rong-aio.side', { parent, action, ...fields })

  const id = await sendFirst(f, await draft(f))
  await f.getAgent(id).whenIdle()
  assert.equal((await post('permission', { id, permission: 'follow' })).status, 200)
  const child = f.getAgent(id)

  const history = async () =>
    (
      (await (await f.request('rong-aio.side?parent=' + parent)).json()) as {
        rows: Array<{ pending: boolean }>
      }
    ).rows

  let asked = Promise.withResolvers<void>()
  let answer = Promise.withResolvers<string>()
  f.ctx.on(
    'approval/request' as never,
    (request: { agent: { id: string } }, next: () => unknown) => {
      if (request.agent.id !== id) return next()
      asked.resolve()
      return answer.promise
    },
  )
  f.ctx.on(
    'agent/pre-step' as never,
    async (
      { agent, signal }: { agent?: typeof child; signal: AbortSignal },
      next: () => Promise<unknown>,
    ) => {
      if (agent?.id === id) {
        await f.ctx.approval.request({ agent, signal, toolName: 'test-write' })
      }
      return next()
    },
  )

  for (const decision of ['allowed-once', 'rejected']) {
    asked = Promise.withResolvers<void>()
    answer = Promise.withResolvers<string>()
    const turn = f.run(child)
    try {
      await asked.promise
      assert.equal((await history())[0].pending, true)
      assert.equal((await post('delete', { id, confirmed: true })).status, 409)
      assert.deepEqual(await f.run(), { kind: 'completed' })
    } finally {
      answer.resolve(decision)
    }
    await turn
    assert.equal((await history())[0].pending, false)
  }

  const audit = (await f.ctx.sessionQuery.readSession(id as SessionId)).events
  assert.deepEqual(
    audit
      .filter((e) => e.type === 'approval/decided')
      .map((e) => (e.data as { outcome: string }).outcome),
    ['allowed-once', 'rejected'],
  )
  assert.ok(
    !(await f.ctx.sessionQuery.readSession(parent as SessionId)).events.some(
      (e) => e.type === 'approval/asked',
    ),
  )
})

test(
  '工具执行半轮分叉保留已完成工具结果与回放状态，系统前缀漂移时拒绝发送',
  { timeout: 15000 },
  async (t) => {
    const pending = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const streaming = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    let step = 0

    const f = await runtime(t, {
      side: true,
      async *reply(options) {
        const parent = options.sessionId === f.agent.id
        if (parent) step++
        const tool = parent && step <= 2
        const block = tool
          ? { type: 'tool-call', id: 'read-' + step, name: 'read', arguments: '{}' }
          : { type: 'text', text: parent ? '父会话稍后完成' : '侧聊回答' }
        yield { type: 'block-start', index: 0, blockType: block.type }
        if (parent && step === 3) {
          yield { type: 'text-delta', index: 0, text: '父会话稍后' }
          streaming.resolve()
          await finish.promise
        }
        yield { type: 'block-end', index: 0, block }
        yield {
          type: 'finish',
          reason: { kind: 'stop' },
          replayState: { response: { token: 'reply-replay-' + step } },
        }
      },
    })

    let reads = 0
    f.ctx.tools.register({
      name: 'read',
      description: '读取示例',
      parameters: { type: 'object' } as never,
      output: {
        schema: { type: 'string' } as never,
        render: (_args: unknown, text: string) => [{ type: 'text', text }],
      },
      execute: async () => {
        if (++reads === 2) {
          pending.resolve()
          await release.promise
          return '分叉后返回的结果'
        }
        return '分叉前返回的结果'
      },
    })

    const point = await draft(f)
    const running = f.run()
    try {
      await pending.promise
      f.agent.followup(
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: '父会话队列' }],
        }),
      )
      const child = f.getAgent(await sendFirst(f, point))
      await child.whenIdle()

      const side = f.wire.at(-1) as { input: WireMessage[]; tools: unknown; toolHistory: unknown }
      const pendingResult = side.input.findIndex(
        (m) => m.role === 'tool' && m.toolCallId === 'read-2',
      )
      assert.ok(pendingResult > 0)
      assert.equal(assertSideOpening(side.input, f.agent.id, '侧聊首条消息'), pendingResult + 1)
      assert.equal(side.input[pendingResult].isError, true)
      assert.match(JSON.stringify(side.input), /分叉前返回的结果/)
      assert.match(JSON.stringify(side.input), /reply-replay-2/)
      assert.doesNotMatch(JSON.stringify(side.input), /父会话队列|分叉后返回的结果/)

      release.resolve()
      await streaming.promise
      const parent = f.wire.at(-1) as { input: WireMessage[]; tools: unknown; toolHistory: unknown }
      assert.deepEqual(side.input.slice(0, pendingResult), parent.input.slice(0, pendingResult))
      assert.deepEqual(side.tools, parent.tools)
      assert.deepEqual(side.toolHistory, parent.toolHistory)

      const before = f.wire.length
      const remove = f.ctx.systemPrompt.section({
        name: 'test:drift',
        order: 1,
        text: '新的系统前缀',
      })
      assert.equal(((await f.run(child)) as { kind: string }).kind, 'error')
      assert.equal(f.wire.length, before)

      remove()
      assert.deepEqual(await f.run(child), { kind: 'completed' })
      const resumed = f.wire.at(-1) as {
        input: WireMessage[]
        tools: unknown
        toolHistory: unknown
      }
      const [system, ...history] = resumed.input.slice(0, side.input.length)
      assert.equal(system.role, 'system')
      assert.deepEqual(system.content, side.input[0].content)
      assert.deepEqual(history, side.input.slice(1))
      assert.deepEqual(resumed.tools, side.tools)
      assert.deepEqual(resumed.toolHistory, side.toolHistory)
    } finally {
      release.resolve()
      finish.resolve()
      await running
    }
  },
)

test('破甲与 Agent Team 主会话分叉侧聊时保留完整前缀，切换关闭后不影响已分叉前缀且禁止团队工具', async (t) => {
  const f = await runtime(t, { side: true })
  f.ctx.provide('subagents' as never, { rootOf: (agent: unknown) => agent } as never)
  await f.ctx.plugin(TeamService as Parameters<typeof f.ctx.plugin>[0], {})
  const parent = f.agent.id
  const signal = new AbortController().signal
  let teamCreated = 0

  f.ctx.systemPrompt.section({
    name: 'team:policy',
    order: f.ctx.systemPrompt.getSectionOrder('TEAM_POLICY'),
    text: ({ agent }) =>
      agent && f.ctx.agentTeams.isEnabled(agent) ? 'Agent Teams is available in this session.' : '',
  })
  f.ctx.tools.register(
    defineTool({
      name: 'team_task_create',
      description: 'Create team task',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
      execute: async () => {
        teamCreated++
        return 'ok'
      },
    } as never),
    { when: ({ agent }) => Boolean(agent && f.ctx.agentTeams.isEnabled(agent)) },
  )

  assert.equal(
    (
      await f.injectRequest({
        type: 'select',
        sessionId: parent,
        state: { name: f.prompt.name },
      })
    ).status,
    200,
  )
  await f.ctx.agentTeams.setEnabled(f.agent, true)
  assert.deepEqual(await f.run(), { kind: 'completed' })

  const parentRequest = f.wire.at(-1) as { input: WireMessage[]; tools: Array<{ name: string }> }
  assert.ok(parentRequest.input[0].content[0].text?.startsWith(f.prompt.body))
  assert.match(
    parentRequest.input[0].content[0].text ?? '',
    /Agent Teams is available in this session/,
  )
  assert.ok(parentRequest.tools?.some((tool) => tool.name === 'team_task_create'))

  const point = await draft(f)
  const id = await sendFirst(f, point, '破甲与 Team 下的侧聊')
  const child = f.getAgent(id)
  await child.whenIdle()
  const sideRequest = f.wire.at(-1) as { input: WireMessage[]; tools: unknown }
  assert.deepEqual(sideRequest.input.slice(0, parentRequest.input.length), parentRequest.input)
  assert.deepEqual(sideRequest.tools, parentRequest.tools)

  assert.equal(
    (await f.request('rong-aio.side', { parent, action: 'permission', id, permission: 'follow' }))
      .status,
    200,
  )
  await executeToolBatch(
    {
      agent: child,
      signal,
      calls: [
        {
          type: 'tool-call',
          id: randomUUID() as ToolCallId,
          name: 'team_task_create',
          arguments: '{}',
        },
      ],
    },
    new ToolExecutionPipeline(f.ctx),
    () => 1,
  )
  assert.equal(teamCreated, 0)

  await f.ctx.agentTeams.setEnabled(f.agent, false)
  const secondId = await sendFirst(f, await draft(f), '末轮切换后新建侧聊')
  await f.getAgent(secondId).whenIdle()
  const secondRequest = f.wire.at(-1) as { input: WireMessage[]; tools: unknown }
  assert.deepEqual(secondRequest.input.slice(0, parentRequest.input.length), parentRequest.input)
  assert.deepEqual(secondRequest.tools, parentRequest.tools)
})

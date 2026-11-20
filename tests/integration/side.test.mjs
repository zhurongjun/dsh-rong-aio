import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { runtime } from './helpers/runtime.mjs'

async function draft(f, parent = f.agent.id) {
  const response = await f.request('rong-aio.side', { parent, action: 'draft' })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body.fork
}
async function sendFirst(f, point, text = '侧聊首条消息', key = randomUUID()) {
  const response = await f.request('rong-aio.side', {
    ...point,
    action: 'create',
    key,
    text,
    permission: 'read',
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body.id
}

function assertSideOpening(input, parent, question) {
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
    policies[0].content[0].text,
    /Only instructions submitted after the side-conversation boundary are active/,
  )
  assert.match(policies[0].content[0].text, /Sub-agents are off-limits/)
  assert.ok(
    boundaries[0].content[0].text.includes('Parent chat: ' + JSON.stringify({ sessionId: parent })),
  )
  assert.equal(input[start + 2].source.kind, 'user')
  assert.equal(input[start + 2].content[0].text, question)
  return start
}

test('从未发言的主会话新建侧聊时，原生系统提示在前，首问之前只有一组侧聊规则和边界', async (t) => {
  const f = await runtime(t, { side: true })
  const child = f.ctx.agents.get(await sendFirst(f, await draft(f), '空主会话的首问'))
  await child.whenIdle()
  const { input } = f.wire.at(-1)
  assert.equal(input[0].role, 'system')
  assert.ok(assertSideOpening(input, f.agent.id, '空主会话的首问') >= 1)
})

test('侧聊冻结分叉上下文，单独执行权限策略并从历史重新进入', async (t) => {
  const f = await runtime(t, { side: true })
  const parent = f.agent.id
  const signal = new AbortController().signal
  const post = async (action, fields = {}) => {
    const response = await f.request('rong-aio.side', { parent, action, ...fields })
    const data = await response.json()
    assert.equal(response.status, 200, JSON.stringify(data))
    return data
  }
  const history = async () => (await f.request('rong-aio.side?parent=' + parent)).json()
  const say = async (agent, text) => {
    await f.ctx.sessionController.prompt(
      { sessionId: agent.id, content: [{ type: 'text', text }] },
      signal,
    )
    await agent.whenIdle()
  }
  let writes = 0
  f.ctx.tools.register({
    name: 'write',
    description: '测试写入',
    parameters: { type: 'object' },
    output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'ok' }] },
    execute: async () => {
      writes++
      return true
    },
  })
  await say(f.agent, '主会话的分叉点')
  const key = randomUUID()
  const point = await draft(f)
  assert.deepEqual((await history()).rows, [])
  assert.equal(await f.ctx.sessionPersistence.stat('rong-side-' + key), undefined)
  await say(f.agent, '主会话稍后的消息')
  const parentRequest = f.wire.at(-1)
  const id = await sendFirst(f, point, '只在侧聊出现的问题', key)
  assert.equal(await sendFirst(f, point, '只在侧聊出现的问题', key), id)
  await post('open', { id })
  const child = f.ctx.agents.get(id)
  await child.whenIdle()
  const sideRequest = f.wire.at(-1)
  assert.equal(sideRequest.model, parentRequest.model)
  assert.deepEqual(sideRequest.tools, parentRequest.tools)
  assert.deepEqual(sideRequest.input.slice(0, parentRequest.input.length), parentRequest.input)
  const policyIndex = assertSideOpening(sideRequest.input, parent, '只在侧聊出现的问题')
  const input = JSON.stringify(f.wire.at(-1).input)
  assert.match(input, /主会话的分叉点/)
  assert.match(input, /只在侧聊出现的问题/)
  assert.match(input, /主会话稍后的消息/)
  await say(f.agent, '回到主会话')
  const nextParent = f.wire.at(-1).input
  const nextQuestion = nextParent.findIndex((m) => m.content[0]?.text === '回到主会话')
  assert.deepEqual(sideRequest.input.slice(0, policyIndex), nextParent.slice(0, nextQuestion))
  assert.doesNotMatch(
    JSON.stringify(f.wire.at(-1).input),
    /只在侧聊出现的问题|Side conversation boundary|You are in a side conversation/,
  )
  assert.equal((await history()).rows[0].title, '只在侧聊出现的问题')
  assert.deepEqual(child.model.current(), f.agent.model.current())

  const write = () =>
    executeToolBatch(
      {
        agent: child,
        signal,
        calls: [{ type: 'tool-call', id: randomUUID(), name: 'write', arguments: '{}' }],
      },
      new ToolExecutionPipeline(f.ctx),
      () => 1,
    )
  await write()
  assert.equal(writes, 0)
  const override = await f.ctx.commands.execute(child, '/permission danger-full-access', [], signal)
  assert.equal(override.result.kind, 'error')
  await write()
  assert.equal(writes, 0)
  await post('permission', { id, permission: 'follow' })
  await write()
  assert.equal(writes, 1)
  f.ctx.permissionPresets.set(f.agent.session, 'danger-full-access')
  await Promise.resolve()
  assert.equal(f.ctx.permissionPresets.current(child.session), 'danger-full-access')
  await post('permission', { id, permission: 'read' })
  await write()
  assert.equal(writes, 1)
  assert.equal((await draft(f, id)).parent, parent)
  const nested = await f.request('rong-aio.side', {
    ...point,
    action: 'create',
    text: 'test',
    permission: 'read',
    parent: id,
    key: randomUUID(),
  })
  assert.equal(nested.status, 409)
  assert.equal((await f.request('rong-aio.side', { parent, action: 'delete', id })).status, 400)
  const secondPoint = await draft(f)
  assert.equal((await history()).rows.length, 1)
  const second = await sendFirst(f, secondPoint, '另一个问题')
  assert.notEqual(second, id)
  await f.ctx.agents.get(second).whenIdle()
  await post('delete', { id: second, confirmed: true })
  assert.equal((await history()).rows.length, 1)
  await f.enable('rong-aio-side', false)
  await f.enable('rong-aio-side', true)
  await post('open', { id })
  await say(f.ctx.agents.get(id), '恢复后继续')
  assert.deepEqual(f.wire.at(-1).input.slice(0, sideRequest.input.length), sideRequest.input)
  assertSideOpening(f.wire.at(-1).input, parent, '只在侧聊出现的问题')
  const restored = JSON.stringify(f.wire.at(-1).input)
  assert.match(restored, /只在侧聊出现的问题/)
  assert.match(restored, /主会话的分叉点/)
  assert.doesNotMatch(restored, /回到主会话/)
  await post('delete', { id, confirmed: true })
  assert.deepEqual((await history()).rows, [])
  assert.equal(await f.ctx.sessionPersistence.stat(id), undefined)
})

test('主会话可以在侧聊等待审批时继续，侧聊的两次审批单独留痕', { timeout: 15000 }, async (t) => {
  const f = await runtime(t, { side: true })
  const parent = f.agent.id
  await f.run()
  const post = (action, fields) => f.request('rong-aio.side', { parent, action, ...fields })
  const id = await sendFirst(f, await draft(f))
  await f.ctx.agents.get(id).whenIdle()
  assert.equal((await post('permission', { id, permission: 'follow' })).status, 200)
  const child = f.ctx.agents.get(id)
  const history = async () =>
    (await (await f.request('rong-aio.side?parent=' + parent)).json()).rows
  let asked, answer
  f.ctx.on('approval/request', (request, next) => {
    if (request.agent.id !== id) return next()
    asked.resolve()
    return answer.promise
  })
  // A test capability asks DSH for approval in its owning turn, just like a native tool.
  f.ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (agent.id === id) await f.ctx.approval.request({ agent, signal, toolName: 'test-write' })
    return next()
  })
  for (const decision of ['allowed-once', 'rejected']) {
    asked = Promise.withResolvers()
    answer = Promise.withResolvers()
    const turn = f.run(child)
    try {
      await asked.promise
      assert.equal((await history())[0].pending, true)
      assert.equal((await post('delete', { id, confirmed: true })).status, 409)
      assert.equal((await f.run()).kind, 'completed')
    } finally {
      answer.resolve(decision)
    }
    await turn
    assert.equal((await history())[0].pending, false)
  }
  const audit = (await f.ctx.sessionQuery.readSession(id)).events
  assert.deepEqual(
    audit.filter((e) => e.type === 'approval/decided').map((e) => e.data.outcome),
    ['allowed-once', 'rejected'],
  )
  assert.ok(
    !(await f.ctx.sessionQuery.readSession(parent)).events.some((e) => e.type === 'approval/asked'),
  )
})

test('分叉与重开沿用 DSH 已提交的压缩结果', async (t) => {
  const f = await runtime(t, { side: true })
  const key = randomUUID()
  const scope = { parent: f.agent.id }
  // A deterministic summarizer using the same public Session surface transaction as a host plugin.
  async function summarize(agent, text) {
    await agent.runMaintenance(async () => {
      const { session } = agent
      const read = await f.ctx.sessionQuery.readSession(agent.id)
      const target = read.events.findLast(
        (e) =>
          session.surface.nodes.includes(e.seq) &&
          e.type === 'user/message' &&
          e.data.source.kind === 'user',
      )
      const compactionId = randomUUID()
      const point = { start: target.seq, end: target.seq }
      const start = session.append('compaction/start', { compactionId, turn: null })
      const content = [{ type: 'text', text }]
      const summary = session.append('compaction/summary', {
        compactionId,
        summary: content,
        shadowedRange: point,
        shadowedSeqs: [target.seq],
        shadowedTokenCount: 1,
        ...f.route,
      })
      session.append(
        'user/message',
        createUserMessage({ content, source: { kind: 'compact-checkpoint', compactionId } }),
        {
          surfaceOp: { op: 'replace', startSeq: target.seq, endSeq: target.seq },
          sourceEventSeqs: [start.seq, summary.seq, target.seq],
        },
      )
      session.append('compaction/end', { compactionId, turn: null })
    })
  }
  assert.equal((await f.run()).kind, 'completed')
  await summarize(f.agent, '主会话摘要')
  const point = await draft(f)
  assert.equal((await f.run()).kind, 'completed')
  const parent = f.wire.at(-1).input
  const cut = parent.findIndex((m) => m.source.kind === 'user')
  assert.ok(cut > 0 && parent.slice(0, cut).some((m) => m.source.kind === 'compact-checkpoint'))
  const id = await sendFirst(f, point, '侧聊首条消息', key)
  const child = f.ctx.agents.get(id)
  await child.whenIdle()
  assert.deepEqual(f.wire.at(-1).input.slice(0, cut), parent.slice(0, cut))
  await summarize(child, '侧聊摘要')
  await f.enable('rong-aio-side', false)
  await f.enable('rong-aio-side', true)
  assert.equal((await f.request('rong-aio.side', { ...scope, action: 'open', id })).status, 200)
  assert.equal((await f.run(f.ctx.agents.get(id))).kind, 'completed')
  const resumed = f.wire.at(-1).input
  assert.deepEqual(resumed.slice(0, cut), parent.slice(0, cut))
  assert.deepEqual(
    resumed.filter((m) => m.source.kind === 'compact-checkpoint').map((m) => m.content[0].text),
    ['主会话摘要', '侧聊摘要'],
  )
})

test(
  '首发捕获父回合已提交的半轮，保留工具结果、回放信息及完整请求前缀',
  { timeout: 15000 },
  async (t) => {
    const pending = Promise.withResolvers()
    const release = Promise.withResolvers()
    const streaming = Promise.withResolvers()
    const finish = Promise.withResolvers()
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
      parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
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
      const child = f.ctx.agents.get(await sendFirst(f, point))
      await child.whenIdle()
      const side = f.wire.at(-1)
      const pendingResult = side.input.findIndex(
        (m) => m.role === 'tool' && m.toolCallId === 'read-2',
      )
      assert.ok(pendingResult > 0)
      assert.equal(assertSideOpening(side.input, f.agent.id, '侧聊首条消息'), pendingResult + 1)
      assert.equal(side.input[pendingResult].isError, true)
      assert.equal(
        side.input.filter((m) => m.role === 'tool' && m.toolCallId === 'read-2').length,
        1,
      )
      assert.match(JSON.stringify(side.input), /分叉前返回的结果/)
      assert.match(JSON.stringify(side.input), /reply-replay-2/)
      assert.doesNotMatch(JSON.stringify(side.input), /父会话队列|分叉后返回的结果/)
      assert.equal(reads, 2)

      release.resolve()
      await streaming.promise
      const parent = f.wire.at(-1)
      assert.equal(parent.input[pendingResult].toolCallId, 'read-2')
      assert.match(JSON.stringify(parent.input[pendingResult]), /分叉后返回的结果/)
      // Compare provider requests all the way through the outstanding call, including its replay envelope.
      assert.deepEqual(side.input.slice(0, pendingResult), parent.input.slice(0, pendingResult))
      assert.deepEqual(side.tools, parent.tools)
      assert.deepEqual(side.toolHistory, parent.toolHistory)
      const later = f.ctx.agents.get(await sendFirst(f, point, '流式回复中的侧问'))
      await later.whenIdle()
      const laterRequest = f.wire.at(-1)
      assert.deepEqual(laterRequest.input.slice(0, parent.input.length), parent.input)
      assert.ok(
        laterRequest.input
          .slice(parent.input.length)
          .some((m) => m.content[0]?.text === '流式回复中的侧问'),
      )
      assert.doesNotMatch(JSON.stringify(laterRequest.input), /父会话稍后|父会话队列/)
      assert.deepEqual(laterRequest.tools, parent.tools)
      assert.deepEqual(laterRequest.toolHistory, parent.toolHistory)
      assert.equal(reads, 2)

      const before = f.wire.length
      const remove = f.ctx.systemPrompt.section({
        name: 'test:drift',
        order: 1,
        text: '新的系统前缀',
      })
      assert.equal((await f.run(child)).kind, 'error')
      assert.equal(f.wire.length, before)
      await f.enable('rong-aio-side', false)
      await f.enable('rong-aio-side', true)
      assert.equal(
        (await f.request('rong-aio.side', { parent: f.agent.id, action: 'open', id: child.id }))
          .status,
        200,
      )
      const resumed = f.ctx.agents.get(child.id)
      assert.equal((await f.run(resumed)).kind, 'error')
      assert.equal(f.wire.length, before)
      remove()
      assert.equal((await f.run(resumed)).kind, 'completed')
      const [system, ...history] = f.wire.at(-1).input.slice(0, side.input.length)
      // Restoring a system section re-renders its internal UUID. All its provider-visible blocks must match.
      assert.equal(system.role, 'system')
      assert.deepEqual(system.content, side.input[0].content)
      assert.deepEqual(history, side.input.slice(1))
      assert.deepEqual(f.wire.at(-1).tools, side.tools)
      assert.deepEqual(f.wire.at(-1).toolHistory, side.toolHistory)
      assert.equal(reads, 2)
    } finally {
      release.resolve()
      finish.resolve()
      await running
    }
  },
)

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import TeamService from '@deepseek-ai/dsh-agent-team'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { runtime, storedSession } from './helpers/runtime.ts'

const openai = { sessionId: 'a', provider: 'openai', model: 'gpt-6-astra' }

test('支持的速度档位取决于型号和连接协议，未开放的组合拒绝写入', async (t) => {
  const f = await runtime(t)
  const call = (identity: typeof openai, mode?: string) =>
    mode === undefined
      ? f.request('rong-aio.speed?' + new URLSearchParams(identity))
      : f.request('rong-aio.speed', { ...identity, mode })

  for (const model of [openai.model, 'catalog-alias', 'gpt-6-astra-2026-09-01']) {
    const response = await call({ ...openai, model })
    assert.equal(response.status, 200)
    assert.deepEqual(((await response.json()) as { modes: string[] }).modes, [
      'standard',
      'fast',
      'ultrafast',
    ])
  }

  for (const model of ['gpt-6-astra-mini', 'deepseek-v4']) {
    assert.equal((await call({ ...openai, model }, 'fast')).status, 400)
  }
  assert.equal((await call(openai, 'invalid')).status, 400)

  f.protocols.openai = 'openai-completions'
  assert.deepEqual(((await (await call(openai)).json()) as { modes: string[] }).modes, [
    'standard',
    'fast',
  ])
  assert.equal((await call(openai, 'ultrafast')).status, 400)

  f.protocols.openai = 'openai-codex-responses'
  assert.deepEqual(((await (await call(openai)).json()) as { modes: string[] }).modes, [])
  assert.equal((await call(openai, 'fast')).status, 400)
})

test('速度设置隔离会话与模型，保存失败后仍可读回最后一次成功的档位', async (t) => {
  const f = await runtime(t)
  const call = (identity: typeof openai, mode?: string) =>
    mode === undefined
      ? f.request('rong-aio.speed?' + new URLSearchParams(identity))
      : f.request('rong-aio.speed', { ...identity, mode })

  assert.equal((await call(openai, 'fast')).status, 200)
  for (const other of [
    { ...openai, sessionId: 'b' },
    { ...openai, model: 'gpt-6.1-sol' },
  ]) {
    assert.equal(((await (await call(other)).json()) as { mode: string }).mode, 'standard')
  }

  f.failStorageWrites()
  assert.equal((await call(openai, 'ultrafast')).status, 503)
  assert.equal(((await (await call(openai)).json()) as { mode: string }).mode, 'fast')
})

test('并行会话各自使用已选速度；标题生成和其他模型的请求保持原样', async (t) => {
  const f = await runtime(t)
  const firstIdentity = { sessionId: 'first', provider: 'openai', model: 'gpt-6-astra' }
  const secondIdentity = { ...firstIdentity, sessionId: 'second' }
  const claudeIdentity = { sessionId: 'third', provider: 'anthropic', model: 'claude-opus-5' }

  assert.equal(
    (await f.request('rong-aio.speed', { ...firstIdentity, mode: 'ultrafast' })).status,
    200,
  )
  assert.equal((await f.request('rong-aio.speed', { ...claudeIdentity, mode: 'fast' })).status, 200)

  const messages = [{ role: 'user', content: '保持原文' }]
  const send = async (identity: typeof firstIdentity, purpose?: string, model = identity.model) => {
    let received: { payload: Record<string, unknown>; beta: string | null } | undefined
    const endpoint = identity.provider === 'anthropic' ? 'messages' : 'responses'
    const stream = f.ctx.waterfall(
      'llm/stream' as never,
      { ...identity, purpose, messages } as never,
      async function* () {
        const http = await fetch(`https://fixture.invalid/v1/${endpoint}`, {
          method: 'POST',
          headers: { 'anthropic-beta': 'existing' },
          body: JSON.stringify({ model, messages }),
        })
        received = (await http.json()) as { payload: Record<string, unknown>; beta: string | null }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } as never,
    ) as unknown as AsyncIterable<unknown>
    for await (const chunk of stream) void chunk
    assert.ok(received)
    return received
  }

  const [first, second, anthropic, title, mismatch] = await Promise.all([
    send(firstIdentity),
    send(secondIdentity),
    send(claudeIdentity),
    send(firstIdentity, 'session-title'),
    send(firstIdentity, undefined, 'other'),
  ])

  assert.deepEqual(first.payload, {
    model: firstIdentity.model,
    messages,
    service_tier: 'ultrafast',
  })
  assert.deepEqual(second.payload, {
    model: secondIdentity.model,
    messages,
    service_tier: 'default',
  })
  assert.deepEqual(anthropic.payload, { model: claudeIdentity.model, messages, speed: 'fast' })
  assert.deepEqual(
    new Set((anthropic.beta ?? '').split(',')),
    new Set(['existing', 'fast-mode-2026-02-01']),
  )
  assert.deepEqual(title.payload, { model: firstIdentity.model, messages })
  assert.deepEqual(mismatch.payload, { model: 'other', messages })
})

test('Agent Team 默认对新建、复用与未开轮空白顶层主会话启用，不覆盖已关闭状态、历史对话、子会话与侧聊', async (t) => {
  const f = await runtime(t, { side: true })
  const persistedBlank = await storedSession(f, 'persisted-blank')
  const persistedBlankResume = await storedSession(f, 'persisted-blank-resume')
  const persistedHistory = await storedSession(f, 'persisted-history', undefined, '历史首轮消息')

  f.ctx.provide(
    'subagents' as never,
    {
      rootOf: (agent: { session: { header: { parentSession?: string } } }) =>
        agent.session.header.parentSession ? f.getAgent(agent.session.header.parentSession) : agent,
    } as never,
  )
  await f.ctx.plugin(TeamService as Parameters<typeof f.ctx.plugin>[0])

  assert.equal(f.ctx.agentTeams.isEnabled(f.agent), true)

  const fresh = await f.ctx.agents.create({
    sessionId: 'fresh-main' as SessionId,
    meta: { cwd: f.workspace },
    agentOptions: f.route,
  })
  assert.equal(f.ctx.agentTeams.isEnabled(fresh.agent), true)

  const child = await f.ctx.agents.create({
    sessionId: 'fresh-sub' as SessionId,
    meta: { cwd: f.workspace, parentSession: fresh.agent.id, origin: 'subagent' },
    agentOptions: f.route,
  })
  assert.equal(
    child.agent.session.ownEvents().some((event) => event.type === 'team/mode'),
    false,
  )

  const blankResumed = await f.ctx.agents.resume({
    resumeSessionId: persistedBlankResume.target.id as SessionId,
    agentOptions: f.route,
  })
  assert.equal(f.ctx.agentTeams.isEnabled(blankResumed.agent), true)

  const coldWake = await f.request(
    'rong-aio.speed?' +
      new URLSearchParams({
        sessionId: persistedBlank.target.id,
        provider: f.route.provider,
        model: f.route.model,
      }),
  )
  assert.equal(coldWake.status, 200)
  assert.equal(f.ctx.agentTeams.isEnabled(f.getAgent(persistedBlank.target.id)), true)

  const historyResumed = await f.ctx.agents.resume({
    resumeSessionId: persistedHistory.target.id as SessionId,
    agentOptions: f.route,
  })
  assert.equal(f.ctx.agentTeams.isEnabled(historyResumed.agent), false)

  await f.ctx.agentTeams.setEnabled(fresh.agent, false)
  assert.equal(f.ctx.agentTeams.isEnabled(fresh.agent), false)
  await f.enable('rong-aio-model-selector', false)
  await f.enable('rong-aio-model-selector', true)
  assert.equal(f.ctx.agentTeams.isEnabled(fresh.agent), false)

  await fresh.dispose()
  const reopenedOff = await f.ctx.agents.resume({
    resumeSessionId: 'fresh-main' as SessionId,
    agentOptions: f.route,
  })
  assert.equal(f.ctx.agentTeams.isEnabled(reopenedOff.agent), false)

  const draftRes = await f.request('rong-aio.side', {
    parent: f.agent.id,
    action: 'draft',
  })
  const { fork } = (await draftRes.json()) as { fork: Record<string, unknown> }
  const sideRes = await f.request('rong-aio.side', {
    ...fork,
    action: 'create',
    key: randomUUID(),
    text: '侧聊团队隔离验证',
    permission: 'read',
  })
  const { id: sideId } = (await sideRes.json()) as { id: string }
  await f.getAgent(sideId).whenIdle()
  assert.equal(
    f
      .getAgent(sideId)
      .session.ownEvents()
      .some((event) => event.type === 'team/mode'),
    false,
  )
})

/** 安装包两个组件的启停、会话隔离和实际提供商请求。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtime } from './helpers/runtime.mjs'

test('安装后设置 Fast 与破甲词，首条请求冻结正文，子会话继承并重新校验授权', async (t) => {
  const f = await runtime(t)
  const { route, prompt, agent, ctx, request, run, calls, wire, clients, enable } = f
  const selector = 'dsh-rong-aio-model-selector'
  const inject = 'dsh-rong-aio-system-inject'
  const manager = 'dsh-rong-aio-session-manager'
  const side = 'dsh-rong-aio-side'
  assert.deepEqual(clients(), [selector, manager, side, inject])
  const session = { sessionId: agent.id }
  assert.equal((await f.injectView(session)).session.resolved.status, 'off')
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

  assert.deepEqual(await run(), { kind: 'completed' })
  assert.equal(calls.length, 1)
  assert.equal(wire[0].service_tier, 'fast')
  assert.deepEqual(wire[0].input, calls[0].messages)
  const text = calls[0].messages[0].content[0].text
  assert.ok(text.startsWith(prompt.body))
  assert.match(text, /DeepSeek Harness/)
  const view = await request('rong-aio.system-inject?sessionId=' + agent.id)
  assert.equal((await view.json()).session.resolved.editable, false)

  await f.put({ ...prompt, body: '模板已修改' })
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
  assert.ok(calls[1].messages[0].content[0].text.startsWith(prompt.body))

  await enable('rong-aio-model-selector', false)
  assert.deepEqual(clients(), [manager, side, inject])
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
  await enable('rong-aio-system-inject', false)
  assert.deepEqual(clients(), [manager, side])
  assert.equal((await request('rong-aio.system-inject?sessionId=' + agent.id)).status, 404)
  await ctx.sessionController.selectModel({
    sessionId: agent.id,
    provider: 'fixture',
    model: 'denied',
  })
  assert.deepEqual(await run(), { kind: 'completed' })
  assert.ok(!calls.at(-1).messages[0].content[0].text.includes(prompt.body))
  await enable('rong-aio-system-inject', true)
  assert.deepEqual(clients(), [manager, side, inject])
  await ctx.sessionController.selectModel({ sessionId: agent.id, ...route })
  assert.deepEqual(await run(), { kind: 'completed' })
  assert.ok(calls.at(-1).messages[0].content[0].text.startsWith(prompt.body))
})

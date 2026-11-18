/** 真实宿主选模与请求分发校验，拒绝时检查适配器调用。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import { hostFixture } from '../helpers/host.mjs'
import { INJECT_SELECTION_ERROR } from '../../../../src/components/system-inject/shared/selection-error.ts'

test('原生装配与分发：预览不冻结，精确护栏、完整预设和存储失败均不调用适配器', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  assert.equal((await f.api()).session.resolved.status, 'on')
  assert.equal((await f.api()).session.resolved.editable, true)
  await assert.rejects(f.frozen(), { code: 'ENOENT' })
  await assert.rejects(f.stream({ model: 'denied' }), /未获/)
  assert.equal(f.calls(), 0)
  assert.equal((await f.api()).session.resolved.editable, true)
  await assert.rejects(f.frozen(), { code: 'ENOENT' })
  const complete = f.ctx.systemPrompt.section({
    name: 'complete',
    order: 0,
    complete: true,
    text: 'COMPLETE',
  })
  await assert.rejects(f.stream(), /首段/)
  complete()
  f.failFlush(true)
  await assert.rejects(f.stream(), /disk failure/)
  assert.equal(f.calls(), 0)
  f.failFlush(false)
  f.failApi(true)
  await assert.rejects(f.stream(), /API failure/)
  assert.equal((await f.frozen()).state.snapshot.body, f.prompt.body)
  f.failApi(false)
  const request = await f.stream()
  assert.equal(request.messages[0].content[0].text.startsWith(f.prompt.body + '\n\n'), true)
  const count = f.calls()
  await assert.rejects(f.stream({ model: 'denied', purpose: 'compaction' }), /未获/)
  await assert.rejects(
    f.stream({ purpose: 'compaction', messages: [createSystemMessage('OTHER')] }),
    /首段/,
  )
  assert.equal(f.calls(), count)
  await f.stream({ purpose: 'compaction' })
  await f.stream({
    purpose: 'session-title',
    model: 'denied',
    messages: [createSystemMessage('title only')],
  })
  await f.api({ type: 'whitelist', routes: [] })
  await assert.rejects(f.stream(), /未获/)
})

test('公共选模方法在保存前拒绝不合法模型，停用还原；子快照可脱离父会话恢复', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  await assert.rejects(
    f.ctx.sessionController.selectModel({
      sessionId: f.agent.id,
      provider: 'fixture',
      model: 'denied',
    }),
    { code: INJECT_SELECTION_ERROR },
  )
  assert.equal(f.modelCommits(), 0)
  assert.equal(f.selection.current.model, 'allowed')
  await f.stream()
  const child = {
    ...f.agent,
    id: 'child',
    session: {
      ...f.agent.session,
      header: { id: 'child', cwd: f.workspace, parentSession: f.agent.id },
    },
  }
  f.agents.push(child)
  await f.api(undefined, child.id)
  f.agents.splice(0, 1)
  await f.reload()
  assert.equal(
    (await f.api(undefined, child.id)).session.resolved.state.snapshot.body,
    f.prompt.body,
  )
  await f.ctx.sessionController.selectModel({
    sessionId: child.id,
    provider: 'fixture',
    model: 'allowed',
  })
  assert.equal(f.modelCommits(), 1)
  const service = f.ctx.sessionController
  await f.ctx.fiber.dispose()
  await service.selectModel({ sessionId: child.id, provider: 'fixture', model: 'denied' })
  assert.equal(f.modelCommits(), 2)
})

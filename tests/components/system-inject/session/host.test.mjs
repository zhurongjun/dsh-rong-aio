/** 通过真实宿主检查会话初始化、快照定位、冻结与恢复。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostFixture } from '../helpers/host.mjs'

test('真实宿主：新会话关闭且不弹拒绝，改模型/重载均不自动开启，首次发送冻结关闭', async (t) => {
  const f = await hostFixture(t)
  f.selection.current = { ...f.route, model: 'denied' }
  let view = await f.api()
  assert.equal(view.session.resolved.status, 'off')
  assert.equal(view.session.error, undefined)
  await f.ctx.sessionController.selectModel({ sessionId: f.agent.id, ...f.route })
  assert.equal((await f.api()).session.resolved.status, 'off')
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  assert.equal((await f.api()).session.resolved.status, 'on')
  await f.reload()
  view = await f.api()
  assert.equal(view.session.resolved.status, 'off')
  assert.equal(view.session.error, undefined)
  const request = await f.stream({ model: 'denied' })
  assert.equal(request.messages[0].content[0].text.includes(f.prompt.body), false)
  assert.deepEqual((await f.frozen()).state, { name: null })
  assert.equal(f.calls(), 1)
})

test('冻结后编辑、改名、删除都不改变实际请求；子会话继承及卸载清理', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  const before = await f.stream()
  const template = (await f.api(undefined, '')).config.templates[0]
  await f.api({
    type: 'save-template',
    scope: 'user',
    file: template.file,
    template: { ...f.prompt, name: 'renamed', display_name: '新显示名', body: 'NEW' },
    confirmed: true,
  })
  await f.api({ type: 'delete-template', file: template.file, confirmed: true })
  const after = await f.stream()
  assert.deepEqual(after.messages[0].content, before.messages[0].content)
  const child = {
    ...f.agent,
    id: 'child',
    session: {
      ...f.agent.session,
      header: { id: 'child', cwd: f.workspace, parentSession: f.agent.id },
    },
  }
  f.agents.push(child)
  const childView = await f.api(undefined, child.id)
  assert.equal(childView.session.resolved.state.snapshot.body, f.prompt.body)
  assert.equal(childView.session.resolved.source, 'parent')
  await f.fiber.dispose()
  assert.equal(f.endpoint(), undefined)
})

test('无法唯一识别活动存储时禁止冻结；不能回退猜测默认目录', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  f.entries.push(f.entries[0])
  await assert.rejects(f.stream(), /无法唯一定位/)
  assert.equal(f.calls(), 0)
})

test('Cordis 4.1 使用生效配置定位快照，忽略原始 root 表达式', async (t) => {
  const f = await hostFixture(t)
  const fiber = f.entries[0].fiber
  fiber.config = { root: { expression: "dshHomePath('sessions')" } }

  await f.reload()
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  await f.stream()
  assert.equal((await f.frozen()).state.name, f.prompt.name)
})

test('冷会话保持关闭，只有显式选词才通过历史投影读取模型', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  const meta = f.agent.session.header
  const events = [{ type: 'model/selection', data: f.route, seq: 0 }]
  f.ctx.sessionPersistence.stat = async () => ({ header: meta })
  f.ctx.sessionQuery.inspectSession = async (id, read) => {
    assert.equal(id, meta.id)
    return read({ snapshotEvents: () => events })
  }
  let restores = 0
  f.ctx.sessionController.projections = async ({ sessionId }) => {
    assert.equal(sessionId, meta.id)
    restores++
    return { kind: 'sequenced', values: { modelSelection: { next: f.route } } }
  }
  f.agents.length = 0
  await f.reload()
  const view = await f.api()
  assert.equal(view.session.resolved.editable, true)
  assert.equal(view.session.resolved.status, 'off')
  assert.deepEqual(view.session.resolved.state, { name: null })
  assert.equal(view.session.error, undefined)
  assert.equal(restores, 0)
  await f.api({ type: 'select', sessionId: meta.id, state: { name: f.prompt.name } })
  assert.equal(restores, 1)
})

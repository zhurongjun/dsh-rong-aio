/** 真实宿主服务接入回归：配置范围、提示词装配、选择适配、冻结护栏及继承。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import { hostFixture } from './helpers/system-inject-host.mjs'
import { INJECT_SELECTION_ERROR } from '../src/components/system-inject/shared/selection-error.ts'

test('全局设置只返回用户库，输入框项目设置合并两层，缺少项目上下文不能写入项目', async (t) => {
  const f = await hostFixture(t)
  const projectPrompt = { ...f.prompt, name: 'project', display_name: '项目词' }
  await f.put(projectPrompt, 'workspace')
  const global = await f.api(undefined, '')
  assert.deepEqual(
    global.config.templates.map((item) => item.scope),
    ['user'],
  )
  const url =
    'http://fixture/api/rong-aio.system-inject?workspace=' + encodeURIComponent(f.workspace)
  const project = await (await f.endpoint().fetch(new Request(url))).json()
  assert.deepEqual(
    project.config.templates.map((item) => item.scope),
    ['user', 'workspace'],
  )
  assert.equal(project.config.workspace, f.workspace)
  assert.equal('workspaces' in project, false)
  const rejected = await f.endpoint().fetch(
    new Request('http://fixture/api/rong-aio.system-inject', {
      method: 'POST',
      body: JSON.stringify({
        type: 'save-template',
        revision: global.config.revision,
        scope: 'workspace',
        template: { ...projectPrompt, name: 'another' },
      }),
    }),
  )
  assert.equal(rejected.status, 409)
  assert.match((await rejected.json()).error, /工作区/)
})

test('模型目录名称仅作展示，白名单仍只保存精确提供商与模型标识', async (t) => {
  const f = await hostFixture(t)
  f.ctx.llm.listProviders = () => [{ id: 'fixture', name: '测试提供商' }]
  f.ctx.llm.listModels = async () => [{ id: 'allowed', name: '测试模型' }]
  const view = await f.api(undefined, '')
  assert.deepEqual(view.routes, [
    {
      provider: 'fixture',
      model: 'allowed',
      providerName: '测试提供商',
      modelName: '测试模型',
    },
  ])
  await f.api({ type: 'whitelist', routes: [f.route, f.route] })
  assert.deepEqual((await f.api(undefined, '')).config.whitelist, [f.route])
})

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

test('通知确认经过会话 API 清理宿主错误，未破甲的模型选择和实际请求不被护栏拦截', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  await assert.rejects(f.stream({ model: 'denied' }), /未获/)
  const before = await f.api()
  await f.api({
    type: 'acknowledge-error',
    sessionId: f.agent.id,
    noticeId: before.session.error.id,
  })
  assert.equal((await f.api()).session.error, undefined)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: null } })
  await f.ctx.sessionController.selectModel({
    sessionId: f.agent.id,
    provider: 'fixture',
    model: 'denied',
  })
  assert.equal((await f.api()).session.resolved.status, 'off')
  const request = await f.stream({ model: 'denied' })
  assert.equal(f.calls(), 1)
  assert.equal(request.messages[0].content[0].text.includes(f.prompt.body), false)
})

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

test('冷会话保持关闭，只有显式选词才通过历史投影读取模型', async (t) => {
  const f = await hostFixture(t)
  await f.api({ type: 'select', sessionId: f.agent.id, state: { name: f.prompt.name } })
  const meta = f.agent.session.header
  const events = [{ type: 'model/selection', data: f.route, seq: 0 }]
  f.ctx.sessionPersistence.stat = async () => ({ header: meta })
  f.ctx.sessionController.inspect = async () => ({ meta, events, inheritedEventCount: 0 })
  let restores = 0
  f.ctx.sessionProjections.restore = (checkpoint, log, base, header, inherited) => {
    assert.deepEqual(checkpoint, {})
    assert.equal(log, events)
    assert.equal(base, 0)
    assert.equal(header, meta)
    assert.equal(inherited, 0)
    restores++
    return { snapshot: { values: { modelSelection: { next: f.route } } } }
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

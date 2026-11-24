/** 真实宿主的用户与工程模板编辑范围。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runtime } from '../../integration/helpers/runtime.mjs'

test('全局设置只返回用户库，输入框项目设置合并两层，缺少项目上下文不能写入项目', async (t) => {
  const f = await runtime(t)
  const projectPrompt = { ...f.prompt, name: 'project', display_name: '项目词' }
  await f.put(projectPrompt, 'workspace')
  const global = await f.injectView()
  assert.deepEqual(
    global.config.templates.map((item) => item.scope),
    ['user'],
  )
  const project = await (await f.injectRequest(undefined, { workspace: f.workspace })).json()
  assert.deepEqual(
    project.config.templates.map((item) => item.scope),
    ['user', 'workspace'],
  )
  assert.equal(project.config.workspace, f.workspace)
  const rejected = await f.injectRequest({
    type: 'save-template',
    revision: global.config.revision,
    scope: 'workspace',
    template: { ...projectPrompt, name: 'another' },
  })
  assert.equal(rejected.status, 409)
  assert.match((await rejected.json()).error, /工作区/)
})

test('库按 Markdown 名称索引，忽略子目录并报告损坏文件和跨库重名', async (t) => {
  const f = await runtime(t)
  const directory = join(f.user, 'prompts')
  await rename(join(directory, f.prompt.name + '.md'), join(directory, 'renamed.md'))
  await mkdir(join(directory, 'nested'))
  await writeFile(join(directory, 'nested/ignored.md'), '---\nname: nested\n---\nNESTED')
  await writeFile(join(directory, 'broken.md'), '无元信息')
  await f.put(f.prompt, 'workspace')
  const { config } = await (await f.injectRequest(undefined, { workspace: f.workspace })).json()
  assert.deepEqual(
    config.templates.map(({ name, conflict }) => [name, conflict]),
    [
      [f.prompt.name, true],
      [f.prompt.name, true],
    ],
  )
  assert.match(config.errors.join(), /broken\.md/)
  const denied = await f.injectRequest({
    type: 'select',
    sessionId: f.agent.id,
    state: { name: f.prompt.name },
  })
  assert.equal(denied.status, 409)
  assert.equal((await f.injectView({ sessionId: f.agent.id })).session.resolved.status, 'off')
})

test('同一版本的两次模板编辑只接受一次，刷新后可继续编辑', async (t) => {
  const f = await runtime(t)
  const { config } = await f.injectView()
  const save = (body, revision) =>
    f.injectRequest({
      type: 'save-template',
      scope: 'user',
      file: config.templates[0].file,
      template: { ...f.prompt, body },
      revision,
    })
  const bodies = ['第一份编辑', '第二份编辑']
  const responses = await Promise.all(bodies.map((body) => save(body, config.revision)))
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  const latest = (await f.injectView()).config
  assert.equal(latest.templates[0].body, bodies[responses.findIndex((response) => response.ok)])
  assert.equal((await save('刷新后的编辑', latest.revision)).status, 200)
  assert.equal((await f.injectView()).config.templates[0].body, '刷新后的编辑')
})

test('删除会话所选的模板需要确认；确认后该会话显示引用已失效', async (t) => {
  const f = await runtime(t)
  assert.equal(
    (
      await f.injectRequest({
        type: 'select',
        sessionId: f.agent.id,
        state: { name: f.prompt.name },
      })
    ).status,
    200,
  )
  const { config } = await f.injectView()
  const command = {
    type: 'delete-template',
    file: config.templates[0].file,
    revision: config.revision,
  }
  assert.equal((await f.injectRequest(command)).status, 409)
  assert.equal((await f.injectView({ sessionId: f.agent.id })).session.resolved.status, 'on')
  assert.equal((await f.injectRequest({ ...command, confirmed: true })).status, 200)
  assert.equal((await f.injectView({ sessionId: f.agent.id })).session.resolved.status, 'invalid')
})

test('支持 ETag 条件读取与无状态 Markdown 导入导出 RPC', async (t) => {
  const f = await runtime(t)
  const initial = await fetch('http://fixture/api/rong-aio.system-inject')
  assert.equal(initial.status, 200)
  const etag = initial.headers.get('etag')
  assert.ok(etag)

  const cached = await fetch('http://fixture/api/rong-aio.system-inject', {
    headers: { 'if-none-match': etag },
  })
  assert.equal(cached.status, 304)

  await f.put({ ...f.prompt, name: 'extra', display_name: '额外' })
  const stale = await fetch('http://fixture/api/rong-aio.system-inject', {
    headers: { 'if-none-match': etag },
  })
  assert.equal(stale.status, 200)
  assert.notEqual(stale.headers.get('etag'), etag)

  const formatted = await f.injectRequest({ type: 'format-markdown', template: f.prompt })
  assert.equal(formatted.status, 200)
  const { markdown } = await formatted.json()
  assert.equal(typeof markdown, 'string')
  assert.match(markdown, /LITERAL/)

  const parsed = await f.injectRequest({ type: 'parse-markdown', markdown })
  assert.equal(parsed.status, 200)
  const { prompt } = await parsed.json()
  assert.deepEqual(prompt, f.prompt)
})

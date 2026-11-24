import assert from 'node:assert/strict'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { runtime } from './helpers/runtime.ts'

test('全局设置只返回用户库，项目设置合并两层，缺少工作区禁止写入项目模板', async (t) => {
  const f = await runtime(t)
  const projectPrompt = { ...f.prompt, name: 'project', display_name: '项目词' }
  await f.put(projectPrompt, 'workspace')

  const globalView = await f.injectView()
  assert.deepEqual(
    (globalView.config.templates as Array<{ scope: string }>).map((item) => item.scope),
    ['user'],
  )

  const projectView = (await (
    await f.injectRequest(undefined, { workspace: f.workspace })
  ).json()) as { config: { workspace: string; templates: Array<{ scope: string }> } }
  assert.deepEqual(
    projectView.config.templates.map((item) => item.scope),
    ['user', 'workspace'],
  )
  assert.equal(projectView.config.workspace, f.workspace)

  const rejected = await f.injectRequest({
    type: 'save-template',
    revision: globalView.config.revision,
    scope: 'workspace',
    template: { ...projectPrompt, name: 'another' },
  })
  assert.equal(rejected.status, 409)
  assert.match(((await rejected.json()) as { error: string }).error, /工作区/)
})

test('模板库按 Markdown 名称索引，忽略子目录并报告损坏文件和跨库重名', async (t) => {
  const f = await runtime(t)
  const directory = join(f.user, 'prompts')
  await rename(join(directory, f.prompt.name + '.md'), join(directory, 'renamed.md'))
  await mkdir(join(directory, 'nested'))
  await writeFile(join(directory, 'nested/ignored.md'), '---\nname: nested\n---\nNESTED')
  await writeFile(join(directory, 'broken.md'), '无元信息')
  await f.put(f.prompt, 'workspace')

  const { config } = (await (
    await f.injectRequest(undefined, { workspace: f.workspace })
  ).json()) as {
    config: { templates: Array<{ name: string; conflict: boolean }>; errors: string[] }
  }

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

test('同一版本的并发编辑仅接受一次；删除所选模板需确认并使引用失效', async (t) => {
  const f = await runtime(t)
  const { config } = await f.injectView()
  const save = (body: string, revision: string) =>
    f.injectRequest({
      type: 'save-template',
      scope: 'user',
      file: config.templates[0].file,
      template: { ...f.prompt, body },
      revision,
    })

  const bodies = ['第一份编辑', '第二份编辑']
  const responses = await Promise.all(bodies.map((body) => save(body, config.revision)))
  assert.deepEqual(responses.map((res) => res.status).sort(), [200, 409])

  const latest = (await f.injectView()).config
  assert.equal(latest.templates[0].body, bodies[responses.findIndex((res) => res.ok)])
  assert.equal((await save('刷新后的编辑', latest.revision)).status, 200)
  assert.equal((await f.injectView()).config.templates[0].body, '刷新后的编辑')

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

  const deleteCmd = {
    type: 'delete-template',
    file: latest.templates[0].file,
    revision: (await f.injectView()).config.revision,
  }
  assert.equal((await f.injectRequest(deleteCmd)).status, 409)
  assert.equal((await f.injectView({ sessionId: f.agent.id })).session.resolved.status, 'on')
  assert.equal((await f.injectRequest({ ...deleteCmd, confirmed: true })).status, 200)
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
  const { markdown } = (await formatted.json()) as { markdown: string }
  assert.match(markdown, /LITERAL/)

  const parsed = await f.injectRequest({ type: 'parse-markdown', markdown })
  assert.equal(parsed.status, 200)
  const { prompt } = (await parsed.json()) as { prompt: unknown }
  assert.deepEqual(prompt, f.prompt)
})

test('自动审查保留宿主提示词且按实际模型授权；工程白名单不可越权且配置损坏时关闭会话可发送', async (t) => {
  const f = await runtime(t)
  const sessionId = f.agent.id
  assert.equal(
    (await f.injectRequest({ type: 'select', sessionId, state: { name: f.prompt.name } })).status,
    200,
  )
  assert.deepEqual(await f.run(), { kind: 'completed' })

  const system = '按宿主策略审查待执行的工具调用。'
  const messages = [
    { role: 'user' as const, content: [{ type: 'text' as const, text: '待审查的操作' }] },
  ]
  const send = (purpose?: string, model = f.route.model) =>
    Array.fromAsync(
      f.ctx.llm.stream({
        ...f.route,
        model,
        sessionId,
        purpose: purpose as never,
        system,
        messages,
      }),
    )

  const chunks = (await send('auto-review')) as Array<{ type: string; block?: { text: string } }>
  assert.equal(f.calls.at(-1)?.system, system)
  assert.deepEqual(f.calls.at(-1)?.messages, messages)
  const decision = chunks.find((chunk) => chunk.type === 'block-end')?.block
  assert.deepEqual(JSON.parse(decision?.text ?? '{}'), { risk: 'high', decision: 'deny' })

  await assert.rejects(send('auto-review', 'denied'), /模型未获破甲模式授权：fixture \/ denied/)
  await assert.rejects(send(undefined), /实际请求未包含破甲正文首段/)

  const f2 = await runtime(t)
  const projectDir = join(f2.workspace, '.dsh/system_inject')
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'config.json'),
    JSON.stringify({ version: 1, whitelist: [f2.route] }),
  )
  await f2.configure([])

  const select = () =>
    f2.injectRequest({ type: 'select', sessionId: f2.agent.id, state: { name: f2.prompt.name } })
  assert.equal((await select()).status, 409)

  await writeFile(join(f2.user, 'config.json'), '{')
  const { config } = await f2.injectView()
  assert.ok((config.errors as string[]).length)
  assert.equal((await select()).status, 409)
  assert.equal((await f2.injectView({ sessionId: f2.agent.id })).session.resolved.status, 'off')
  assert.deepEqual(await f2.run(), { kind: 'completed' })
  assert.equal(f2.calls.length, 1)
})

test('安装包启停、Fast 与破甲首轮冻结正文，子会话继承与重新校验', async (t) => {
  const f = await runtime(t)
  const { route, prompt, agent, ctx, request, run, calls, wire, clients, enable } = f
  assert.deepEqual(clients(), [
    'dsh-rong-aio-model-selector',
    'dsh-rong-aio-session-manager',
    'dsh-rong-aio-side',
    'dsh-rong-aio-system-inject',
  ])

  const identity = { sessionId: agent.id, ...route }
  assert.equal((await request('rong-aio.speed', { ...identity, mode: 'fast' })).status, 200)
  assert.equal(
    (
      await request('rong-aio.system-inject', {
        type: 'select',
        sessionId: agent.id,
        state: { name: prompt.name },
      })
    ).status,
    200,
  )

  assert.deepEqual(await run(), { kind: 'completed' })
  assert.equal(calls.length, 1)
  assert.equal(wire[0].service_tier, 'fast')
  assert.deepEqual(wire[0].input, calls[0].messages)
  const firstMessages = calls[0].messages as Array<{ content: Array<{ text: string }> }>
  assert.ok(firstMessages[0].content[0].text.startsWith(prompt.body))
  assert.match(firstMessages[0].content[0].text, /DeepSeek Harness/)
  assert.equal((await f.injectView({ sessionId: agent.id })).session.resolved.editable, false)

  await f.put({ ...prompt, body: '模板已修改' })
  await f.configure([])
  assert.equal(((await run()) as { kind: string }).kind, 'error')
  assert.equal(calls.length, 1)

  const { agent: child } = await ctx.agents.create({
    sessionId: 'native-child' as SessionId,
    meta: { cwd: f.workspace, parentSession: agent.id, origin: 'subagent' },
    agentOptions: route,
  })
  assert.equal(((await run(child)) as { kind: string }).kind, 'error')
  assert.equal(calls.length, 1)

  await f.configure([route])
  assert.deepEqual(await run(child), { kind: 'completed' })
  assert.equal(calls.length, 2)
  assert.equal(wire[1].service_tier, 'default')
  const childMessages = calls[1].messages as Array<{ content: Array<{ text: string }> }>
  assert.ok(childMessages[0].content[0].text.startsWith(prompt.body))

  await enable('rong-aio-model-selector', false)
  assert.deepEqual(clients(), [
    'dsh-rong-aio-session-manager',
    'dsh-rong-aio-side',
    'dsh-rong-aio-system-inject',
  ])
  assert.equal((await request('rong-aio.speed?' + new URLSearchParams(identity))).status, 404)
  await assert.rejects(
    ctx.sessionController.selectModel({
      sessionId: agent.id,
      provider: 'fixture',
      model: 'denied',
    }),
  )
  assert.deepEqual(await run(), { kind: 'completed' })
  assert.equal(wire.at(-1)?.service_tier, undefined)

  await enable('rong-aio-system-inject', false)
  assert.deepEqual(clients(), ['dsh-rong-aio-session-manager', 'dsh-rong-aio-side'])
  assert.equal((await f.injectRequest(undefined, { sessionId: agent.id })).status, 404)
  await ctx.sessionController.selectModel({
    sessionId: agent.id,
    provider: 'fixture',
    model: 'denied',
  })
  assert.deepEqual(await run(), { kind: 'completed' })
  const uninjectedMessages = calls.at(-1)?.messages as Array<{ content: Array<{ text: string }> }>
  assert.ok(!uninjectedMessages[0].content[0].text.includes(prompt.body))

  await enable('rong-aio-system-inject', true)
  assert.deepEqual(clients(), [
    'dsh-rong-aio-session-manager',
    'dsh-rong-aio-side',
    'dsh-rong-aio-system-inject',
  ])
  await ctx.sessionController.selectModel({ sessionId: agent.id, ...route })
  assert.deepEqual(await run(), { kind: 'completed' })
  const reinjectedMessages = calls.at(-1)?.messages as Array<{ content: Array<{ text: string }> }>
  assert.ok(reinjectedMessages[0].content[0].text.startsWith(prompt.body))
})

test('重载丢弃未发送选词；首次关闭状态发送后会话保持只读', async (t) => {
  const f = await runtime(t)
  const session = { sessionId: f.agent.id }
  const select = () =>
    f.injectRequest({ type: 'select', ...session, state: { name: f.prompt.name } })

  assert.equal((await select()).status, 200)
  assert.equal((await f.injectView(session)).session.resolved.status, 'on')

  await f.enable('rong-aio-system-inject', false)
  await f.enable('rong-aio-system-inject', true)
  assert.equal((await f.injectView(session)).session.resolved.status, 'off')

  assert.deepEqual(await f.run(), { kind: 'completed' })
  const msgs = f.calls[0].messages as Array<{ content: Array<{ text: string }> }>
  assert.ok(!msgs[0].content[0].text.includes(f.prompt.body))
  assert.equal((await select()).status, 409)
  assert.equal((await f.injectView(session)).session.resolved.editable, false)
})

/** 破甲文件与事务回归：Markdown、目录冲突、显式选择、版本校验、冻结及跨进程写入。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, prompt, route } from './helpers/system-inject.ts'
import { importMarkdown, exportMarkdown } from '../src/components/system-inject/shared/markdown.ts'
import { resolveState, stateLabel } from '../src/components/system-inject/shared/state.ts'
import { commandSchema } from '../src/components/system-inject/shared/protocol.ts'
import { SessionStore } from '../src/components/system-inject/host/session-store.ts'
import {
  sessionDirectory,
  projectKey,
  encodeSessionSegment,
} from '../src/components/system-inject/host/session-location.ts'

test('Markdown 必须提供 name，显示名回退，正文不展开变量；重命名文件不改变索引', async (t) => {
  assert.deepEqual(importMarkdown(exportMarkdown(prompt)), prompt)
  assert.equal(importMarkdown('---\nname: v1\nstatus: ignored\n---\nBODY').display_name, 'v1')
  for (const text of [
    'BODY',
    '---\nname: 中文\n---\nBODY',
    '---\nname: ..\n---\nBODY',
    '---\nname: a\nname: b\n---\nBODY',
  ])
    assert.throws(() => importMarkdown(text))
  const f = await fixture(t)
  const file = await f.put()
  await rename(file, join(f.paths.prompts('user'), 'renamed.md'))
  assert.equal((await f.controller.context()).config.templates[0].name, prompt.name)
})

test('只扫描直属 Markdown；用户和工程同名冲突，损坏文件明确报错', async (t) => {
  const f = await fixture(t)
  await f.put()
  await mkdir(join(f.paths.prompts('user'), 'nested'))
  await writeFile(
    join(f.paths.prompts('user'), 'nested/ignored.md'),
    exportMarkdown({ ...prompt, name: 'nested' }),
  )
  await f.put({ ...prompt, display_name: '工程同名' }, 'workspace')
  let { config } = await f.controller.context(f.workspace)
  assert.equal(config.templates.length, 2)
  assert.ok(config.templates.every((item) => item.conflict))
  assert.equal(
    resolveState({ session: { name: prompt.name }, prompts: config.templates }).status,
    'invalid',
  )
  await writeFile(join(f.paths.prompts('user'), 'broken.md'), 'missing metadata')
  config = (await f.controller.context(f.workspace)).config
  assert.match(config.errors.join(), /broken.md/)
})

test('新会话默认关闭，仅显式选择开启；关闭、失效名称与预览不冻结', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
  await f.select()
  let view = await f.controller.view('s')
  assert.equal(view.session!.resolved.status, 'on')
  assert.equal(stateLabel(view.session!.resolved), prompt.display_name)
  assert.equal(view.session!.resolved.editable, true)
  assert.equal(f.entry.frozen, undefined)
  assert.equal(view.session!.resolved.source, 'session')
  await assert.rejects(f.select('missing'), /已失效/)
  assert.equal(f.entry.state.name, prompt.name)
  await f.select(null)
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
  assert.equal(
    commandSchema.safeParse({ type: 'select', sessionId: 's', state: {} }).success,
    false,
  )
  await f.select()
  await rm(join(f.paths.prompts('user'), prompt.name + '.md'))
  view = await f.controller.view('s')
  assert.equal(view.session!.resolved.status, 'invalid')
  assert.match(stateLabel(view.session!.resolved), /已失效/)
})

test('工程文件不能扩张授权；用户配置损坏或含未知字段时仅阻止开启', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure([])
  await mkdir(f.paths.base('workspace', f.workspace), { recursive: true })
  const projectConfig = join(f.paths.base('workspace', f.workspace), 'config.json')
  await writeFile(projectConfig, JSON.stringify({ version: 1, whitelist: [route] }))
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
  assert.deepEqual(await f.controller.references(), {})
  await assert.rejects(f.select(), /未获/)
  await writeFile(projectConfig, '{')
  await f.configure()
  assert.deepEqual((await f.controller.context(f.workspace)).config.errors, [])
  await f.select()
  await writeFile(
    f.paths.config(),
    JSON.stringify({ version: 1, unknown: true, whitelist: [route] }),
  )
  await assert.rejects(f.select(), /unknown/)
  await writeFile(f.paths.config(), '{')
  assert.ok((await f.controller.context()).config.errors.length)
  await assert.rejects(f.controller.capture('s'))
  f.sessions.idle('s')
  await f.select(null)
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
  await f.controller.capture('s')
  await f.controller.admit('s', { ...route, model: 'denied' }, 'BASE', true)
  assert.deepEqual(f.entry.frozen?.state, { name: null })
})

test('捕获后文件变化或并发改选拒绝；失败没有冻结，重新准备可成功', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.select()
  await f.controller.capture('s')
  await assert.rejects(
    f.controller.command({ type: 'select', sessionId: 's', state: { name: null } }),
    /正在发送/,
  )
  await f.put({ ...prompt, body: 'UPDATED' })
  await assert.rejects(f.controller.admit('s', route, prompt.body, true), /变化/)
  assert.equal(f.entry.frozen, undefined)
  f.sessions.idle('s')
  await f.controller.capture('s')
  await f.controller.admit('s', route, 'UPDATED', true)
  assert.equal(f.entry.frozen!.state.snapshot!.body, 'UPDATED')
})

test('白名单、前缀和持久化失败均不冻结；成功后恢复及删除模板不漂移', async (t) => {
  const f = await fixture(t)
  const file = await f.put()
  await f.configure()
  await f.select()
  await f.controller.capture('s')
  await assert.rejects(
    f.controller.admit('s', { ...route, model: 'Allowed' }, prompt.body, true),
    /未获/,
  )
  await assert.rejects(f.controller.admit('s', route, 'OTHER', true), /首段/)
  f.failFlush(true)
  await assert.rejects(f.controller.admit('s', route, prompt.body, true), /disk failure/)
  assert.equal(f.entry.frozen, undefined)
  f.failFlush(false)
  await f.controller.admit('s', route, prompt.body, true)
  await rm(file)
  await f.configure()
  const view = await f.controller.view('s')
  assert.equal(view.session!.resolved.status, 'on')
  assert.equal(view.session!.resolved.state.snapshot!.body, prompt.body)
  const restored = new SessionStore(
    f.location,
    async () => {},
    async () => false,
  )
  assert.deepEqual((await restored.initialize(f.entry.meta)).frozen, f.entry.frozen)
  await f.configure([])
  await assert.rejects(f.controller.admit('s', route, prompt.body, true), /未获/)
})

test('临时选择只在宿主内存；关闭也冻结，父子快照独立持久化', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.controller.command({ type: 'select', sessionId: 's', state: { name: null } })
  const fresh = new SessionStore(
    f.location,
    async () => {},
    async () => false,
  )
  assert.deepEqual((await fresh.initialize(f.entry.meta)).state, { name: null })
  await f.controller.capture('s')
  await f.controller.admit('s', route, 'BASE', true)
  assert.equal(f.entry.frozen!.state.name, null)
  const child = await f.sessions.initialize({ id: 'child', cwd: f.workspace, parent: 's' }, f.entry)
  assert.equal(child.frozen!.state.name, null)
  assert.equal(child.frozen!.source, 'parent')
  assert.equal(
    JSON.parse(await readFile(join(f.location(child.meta), 'system_inject.json'), 'utf8')).state
      .name,
    null,
  )
})

test('跨进程文件版本拒绝覆盖；改名和删除允许确认后产生失效引用', async (t) => {
  const f = await fixture(t)
  const file = await f.put()
  await f.configure()
  await f.select()
  let { config } = await f.controller.context(f.workspace)
  await f.put({ ...prompt, display_name: '外部修改' })
  await assert.rejects(
    f.controller.command(
      { type: 'save-template', scope: 'user', file, template: prompt, revision: config.revision },
      f.workspace,
    ),
    /已在其他/,
  )
  config = (await f.controller.context(f.workspace)).config
  await assert.rejects(
    f.controller.command({ type: 'delete-template', file, revision: config.revision }, f.workspace),
    /请确认/,
  )
  await f.controller.command(
    {
      type: 'save-template',
      scope: 'user',
      file,
      template: { ...prompt, name: 'new-name' },
      revision: config.revision,
      confirmed: true,
    },
    f.workspace,
  )
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'invalid')
  assert.equal(importMarkdown(await readFile(file, 'utf8')).name, 'new-name')
  config = (await f.controller.context(f.workspace)).config
  await f.controller.command(
    { type: 'delete-template', file, revision: config.revision, confirmed: true },
    f.workspace,
  )
  assert.equal((await f.controller.context(f.workspace)).config.templates.length, 0)
})

test('rc.5 会话路径对点号、中文、分隔符和无工作区保持一致', () => {
  assert.equal(projectKey('/Users/a/project.test'), '--Users-a-project.test--')
  assert.equal(encodeSessionSegment('../x'), '..~002Fx')
  assert.equal(encodeSessionSegment('..'), '~002E~002E')
  assert.equal(projectKey('C:\\a\\b'), '--C-a-b--')
  assert.equal(sessionDirectory('/custom', { id: 's' }), join('/custom', '_no-cwd', 's'))
  assert.match(projectKey('/项目'), /~9879~76EE/)
})

test('两个进程写同一配置只接受一个版本，另一个报告冲突而非覆盖', async (t) => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { pathToFileURL } = await import('node:url')
  const { resolve } = await import('node:path')
  const { readVersion } = await import('../src/components/system-inject/host/files.ts')
  const f = await fixture(t)
  await f.configure()
  const path = f.paths.config()
  const before = await readVersion(path)
  const moduleUrl = pathToFileURL(resolve('src/components/system-inject/host/files.ts')).href
  const script = `import { withFileLocks, writeVersion } from ${JSON.stringify(moduleUrl)};
    const [directory, path, revision, value] = process.argv.slice(1);
    try { await withFileLocks([directory], () => writeVersion(path, value, revision)); process.stdout.write('saved') }
    catch { process.stdout.write('conflict') }`
  const run = promisify(execFile)
  const results = await Promise.all(
    ['ONE', 'TWO'].map((value) =>
      run(process.execPath, [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        script,
        f.paths.user,
        path,
        before.revision,
        value,
      ]),
    ),
  )
  assert.deepEqual(results.map((item) => item.stdout).sort(), ['conflict', 'saved'])
  assert.ok(['ONE', 'TWO'].includes(await readFile(path, 'utf8')))
})

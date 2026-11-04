import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile, rm, access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, prompt, route } from './helpers/system-inject.ts'
import { SessionStore } from '../src/components/system-inject/host/session-store.ts'
import { INJECT_SELECTION_ERROR } from '../src/components/system-inject/shared/selection-error.ts'

test('旧会话没有快照时明确关闭；空白会话才获得可选择资格', async (t) => {
  const f = await fixture(t)
  const sessions = new SessionStore(
    f.location,
    async () => {},
    async (meta) => meta.id === 'old',
  )
  const old = await sessions.initialize({ id: 'old', cwd: f.workspace })
  assert.equal(old.eligible, false)
  assert.equal(old.frozen?.state.name, null)
  assert.equal((await sessions.initialize({ id: 'blank', cwd: f.workspace })).eligible, true)
  assert.equal(
    JSON.parse(await readFile(join(f.location(old.meta), 'system_inject.json'), 'utf8')).state.name,
    null,
  )
})

test('兜底拒绝后只持久化资格，重启丢弃临时选词；冻结后清理资格标记', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.controller.command({ type: 'select', sessionId: 's', state: { name: prompt.name } })
  await f.controller.capture('s')
  await assert.rejects(f.controller.admit('s', { ...route, model: 'denied' }, prompt.body, true))
  const pending = join(f.location(f.entry.meta), 'system_inject.pending.json')
  assert.deepEqual(JSON.parse(await readFile(pending, 'utf8')), { version: 1 })
  const restarted = new SessionStore(
    f.location,
    async () => {},
    async () => true,
  )
  const recovered = await restarted.initialize(f.entry.meta)
  assert.equal(recovered.eligible, true)
  assert.deepEqual(recovered.state, { name: null })
  assert.equal(recovered.frozen, undefined)
  await f.controller.admit('s', route, prompt.body, true)
  await assert.rejects(access(pending))
  assert.equal(
    (
      await new SessionStore(
        f.location,
        async () => {},
        async () => true,
      ).initialize(f.entry.meta)
    ).eligible,
    false,
  )
})

test('独立子快照优先于父依赖与损坏的残余资格文件；单会话损坏保持只读', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.select()
  await f.controller.capture('s')
  await f.controller.admit('s', route, prompt.body, true)
  const meta = { id: 'child', cwd: f.workspace, parent: 's' }
  await f.sessions.initialize(meta, f.entry)
  await writeFile(join(f.location(meta), 'system_inject.pending.json'), 'broken')
  const restored = new SessionStore(
    f.location,
    async () => {},
    async () => {
      throw new Error('不应读历史')
    },
  )
  const child = await restored.initialize(meta, async () => {
    throw new Error('父会话已删除')
  })
  assert.equal(child.loadError, undefined)
  assert.equal(child.frozen?.state.snapshot?.body, prompt.body)
  await writeFile(join(f.location(meta), 'system_inject.json'), 'broken')
  const broken = await new SessionStore(
    f.location,
    async () => {},
    async () => false,
  ).initialize(meta)
  assert.equal(broken.eligible, false)
  assert.ok(broken.loadError)
})

test('冻结后请求和浏览均不扫描模板、不读取工程配置、不获取工程目录锁', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.select()
  await f.controller.capture('s')
  await f.controller.admit('s', route, prompt.body, true)
  const directory = f.paths.base('workspace', f.workspace)
  await rm(directory, { recursive: true })
  await writeFile(directory, 'not a directory')
  f.controller.catalog.scan = async () => {
    throw new Error('不应扫描目录')
  }
  assert.equal((await f.controller.view('s')).session?.resolved.status, 'on')
  await f.controller.admit('s', route, prompt.body, true)
  await f.configure([])
  await assert.rejects(f.controller.admit('s', route, prompt.body, true), /未获/)
})

test('新会话不校验模型；显式选择被拒绝后仍关闭，换回兼容模型也不会自动开启', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  f.selectRoute({ ...route, model: 'denied' })
  assert.equal((await f.controller.view('s')).resolved.status, 'off')
  assert.equal(f.entry.error, undefined)
  await assert.rejects(f.select(), { code: INJECT_SELECTION_ERROR })
  assert.deepEqual(f.entry.state, { name: null })
  f.selectRoute(route)
  assert.equal((await f.controller.view('s')).resolved.status, 'off')
  await f.select()
  assert.equal(f.entry.state.name, prompt.name)
  const other = await f.sessions.initialize({ id: 'independent', cwd: f.workspace })
  assert.deepEqual(other.state, { name: null })
  assert.equal((await f.controller.view('independent')).resolved.status, 'off')
})

test('模型提交与改选串行；捕获期间改选拒绝且模型拒绝不调用提交', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.select()
  let commits = 0
  await assert.rejects(
    f.controller.selectModel('s', { ...route, model: 'denied' }, async () => {
      commits++
    }),
    { code: INJECT_SELECTION_ERROR },
  )
  assert.equal(commits, 0)
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const model = f.controller.selectModel('s', route, async () => {
    started.resolve()
    await gate.promise
    commits++
  })
  await started.promise
  const choice = f.controller.command({ type: 'select', sessionId: 's', state: { name: null } })
  assert.deepEqual(f.entry.state, { name: prompt.name })
  gate.resolve()
  await Promise.all([model, choice])
  assert.equal(commits, 1)
  assert.equal(f.entry.state.name, null)
  await f.controller.capture('s')
  await assert.rejects(
    f.controller.command({ type: 'select', sessionId: 's', state: { name: prompt.name } }),
    /正在发送/,
  )
})

test('关闭状态的选模和请求不读取模型、模板或白名单，也不获取工程目录锁', async (t) => {
  const f = await fixture(t)
  const view = await f.controller.view('s')
  assert.equal(view.resolved.status, 'off')
  assert.deepEqual(view.resolved, view.session?.resolved)
  f.controller.catalog.scan = async () => {
    throw new Error('不应扫描目录')
  }
  f.controller.configs.read = async () => {
    throw new Error('不应读取配置')
  }
  Object.defineProperty(f.controller, 'selectedRoute', {
    value: async () => {
      throw new Error('不应读取模型')
    },
  })
  await mkdir(join(f.workspace, '.dsh'), { recursive: true })
  await writeFile(f.paths.base('workspace', f.workspace), 'not a directory')
  let commits = 0
  await f.controller.selectModel('s', { ...route, model: 'denied' }, async () => {
    commits++
  })
  assert.equal(commits, 1)
  await f.select(null)
  await f.controller.capture('s')
  assert.equal(f.controller.body('s'), '')
  await f.controller.admit('s', { ...route, model: 'denied' }, 'ORIGINAL SYSTEM', true)
  assert.deepEqual(f.entry.frozen?.state, { name: null })
  assert.equal((await f.controller.view('s')).session?.error, undefined)
})

test('关闭候选不会因旧规则或模板目录变化而开启或阻止发送', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.controller.capture('s')
  await writeFile(
    f.paths.config(),
    JSON.stringify({ version: 1, state: { name: prompt.name }, whitelist: [] }),
  )
  const view = await f.controller.view('s')
  assert.equal(view.resolved.status, 'off')
  assert.deepEqual(view.resolved, view.session?.resolved)
  assert.equal(f.controller.body('s'), '')
  await f.controller.selectModel('s', { ...route, model: 'denied' }, async () => {})
  await f.controller.admit('s', route, '', true)
  assert.deepEqual(f.entry.frozen?.state, { name: null })
})

test('选择拒绝是可确认通知，不是当前破甲状态；迟到确认不能清除更新的拒绝', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure([])
  await assert.rejects(
    f.controller.command({ type: 'select', sessionId: 's', state: { name: prompt.name } }),
  )
  const first = f.entry.error!.id
  assert.equal((await f.controller.view('s')).resolved.status, 'off')
  await f.controller.command({ type: 'acknowledge-error', sessionId: 's', noticeId: first })
  assert.equal(f.entry.error, undefined)
  assert.equal((await f.controller.view('s')).session?.error, undefined)
  await assert.rejects(
    f.controller.command({ type: 'select', sessionId: 's', state: { name: prompt.name } }),
  )
  const second = f.entry.error!.id
  assert.notEqual(first, second)
  await f.controller.command({ type: 'acknowledge-error', sessionId: 's', noticeId: first })
  assert.equal(f.entry.error!.id, second)
  await f.controller.command({ type: 'acknowledge-error', sessionId: 's', noticeId: second })
  assert.equal(f.entry.error, undefined)
  assert.equal((await f.controller.view('s')).resolved.status, 'off')
})

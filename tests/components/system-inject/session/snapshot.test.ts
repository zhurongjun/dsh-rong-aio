/** 通过控制器和文件存储检查会话选择、快照冻结与继承。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, prompt, route } from '../helpers/fixture.ts'
import { stateLabel } from '../../../../src/components/system-inject/shared/state.ts'
import { commandSchema } from '../../../../src/components/system-inject/shared/protocol.ts'
import { SessionStore } from '../../../../src/components/system-inject/host/session-store.ts'
import {
  sessionDirectory,
  projectKey,
  encodeSessionSegment,
} from '../../../../src/components/system-inject/host/session-location.ts'

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

test('0.2.2-rc.3 会话路径对点号、中文、分隔符和无工作区保持一致', () => {
  assert.equal(projectKey('/Users/a/project.test'), '--Users-a-project.test--')
  assert.equal(encodeSessionSegment('../x'), '..~002Fx')
  assert.equal(encodeSessionSegment('..'), '~002E~002E')
  assert.equal(projectKey('C:\\a\\b'), '--C-a-b--')
  assert.equal(sessionDirectory('/custom', { id: 's' }), join('/custom', '_no-cwd', 's'))
  assert.match(projectKey('/项目'), /~9879~76EE/)
})

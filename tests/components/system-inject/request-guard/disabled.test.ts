/** 关闭状态下的请求与选模不读取或启用破甲配置。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, route } from '../helpers/fixture.ts'

test('关闭状态的选模和请求不读取模型、模板或白名单，也不获取工程目录锁', async (t) => {
  const f = await fixture(t)
  const view = await f.controller.view('s')
  assert.equal(view.session!.resolved.status, 'off')
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

test('关闭候选不会因白名单或模板目录变化而开启或阻止发送', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.controller.capture('s')
  await f.configure([])
  await rm(f.paths.prompts('user'), { recursive: true })
  const view = await f.controller.view('s')
  assert.equal(view.session!.resolved.status, 'off')
  assert.equal(f.controller.body('s'), '')
  await f.controller.selectModel('s', { ...route, model: 'denied' }, async () => {})
  await f.controller.admit('s', route, '', true)
  assert.deepEqual(f.entry.frozen?.state, { name: null })
})

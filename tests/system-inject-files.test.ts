/** 文件事务回归：使用真实文件系统验证提交与清理，仅同步失败场景替换原生句柄的 sync。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readVersion, writeVersion } from '../src/components/system-inject/host/files.ts'

/** 每个测试创建独立目录，结束后清理；不读取用户数据或预存夹具。 */
async function directory(t: TestContext): Promise<string> {
  await mkdir(resolve('agent_temp/tests'), { recursive: true })
  const root = await mkdtemp(resolve('agent_temp/tests/system-inject-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('文件事务：新建与更新成功返回，拒绝旧版本且不遗留暂存文件', async (t) => {
  const root = await directory(t)
  const path = join(root, 'config.json')
  await writeVersion(path, 'FIRST', 'missing')
  const before = await readVersion(path)
  assert.equal(before.text, 'FIRST')
  await writeVersion(path, 'SECOND', before.revision)
  assert.equal(await readFile(path, 'utf8'), 'SECOND')
  await assert.rejects(writeVersion(path, 'STALE', before.revision), /已在其他/)
  await assert.rejects(writeVersion(path, 'DUPLICATE', 'missing'), /已在其他/)
  assert.equal(await readFile(path, 'utf8'), 'SECOND')
  assert.deepEqual(await readdir(root), ['config.json'])
})

test('文件事务：文件同步 EPERM 必须拒绝，不提交新文件、不覆盖旧内容并清理暂存文件', async (t) => {
  const root = await directory(t)
  const existing = join(root, 'config.json')
  const missing = join(root, 'new.json')
  await writeVersion(existing, 'ORIGINAL', 'missing')
  const before = await readVersion(existing)

  // Node 未公开 FileHandle 构造器；从真实句柄获取原型，仅在本测试隔离进程中模拟刷盘失败。
  const handle = await open(existing, 'r')
  const prototype = Object.getPrototypeOf(handle)
  await handle.close()
  const failure = Object.assign(new Error('file sync denied'), { code: 'EPERM' })
  t.mock.method(prototype, 'sync', async () => {
    throw failure
  })

  for (const [path, revision] of [
    [existing, before.revision],
    [missing, 'missing'],
  ]) {
    await assert.rejects(writeVersion(path, 'REJECTED', revision), (error) => error === failure)
  }
  assert.equal(await readFile(existing, 'utf8'), 'ORIGINAL')
  assert.deepEqual(await readVersion(missing), { revision: 'missing' })
  assert.deepEqual(await readdir(root), ['config.json'])
})

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runtime } from './helpers/runtime.mjs'
import { storedSession } from './helpers/stored-session.mjs'

test('批量删除仅清理所选会话的存档、速度设置及工作区引用', async (t) => {
  const f = await runtime(t)
  const one = await storedSession(f, 'first-session')
  const two = await storedSession(f, 'second-session')
  const other = await storedSession(f, 'another-session')
  const speedIdentity = (id) => ({ sessionId: id, ...f.route })
  const readSpeed = async (id) =>
    (await (await f.request('rong-aio.speed?' + new URLSearchParams(speedIdentity(id)))).json())
      .mode
  for (const { target } of [one, other]) {
    const saved = await f.request('rong-aio.speed', { ...speedIdentity(target.id), mode: 'fast' })
    assert.equal((await saved.json()).mode, 'fast')
  }
  for (const item of [one, two, other])
    await writeFile(join(item.directory, 'system_inject.json'), 'snapshot')
  const response = await f.request('rong-aio.session-manager', {
    action: 'delete',
    confirmed: true,
    targets: [one.target, two.target],
  })
  assert.deepEqual((await response.json()).outcomes, [{ id: one.target.id }, { id: two.target.id }])
  for (const item of [one, two]) {
    await assert.rejects(access(item.directory), { code: 'ENOENT' })
    assert.equal(await f.ctx.sessionPersistence.stat(item.target.id), undefined)
  }
  assert.equal(await readFile(join(other.directory, 'system_inject.json'), 'utf8'), 'snapshot')
  assert.equal(await readSpeed(one.target.id), 'standard')
  assert.equal(await readSpeed(other.target.id), 'fast')
  assert.deepEqual(
    f.ctx.workspaceRegistry.list()[0].sessionIds.filter((id) => id !== f.agent.id),
    [other.target.id],
  )
})

test('缺少删除确认时拒绝请求；批量删除隔离占用和过期目标', async (t) => {
  const f = await runtime(t)
  const one = await storedSession(f, 'old')
  const eligible = await storedSession(f, 'eligible')
  const live = { id: f.agent.id, createdAt: f.agent.session.header.createdAt }
  const path = 'rong-aio.session-manager'
  const removed = []
  f.ctx.on('api-session/removed', (id) => {
    removed.push(id)
  })
  assert.equal((await f.request(path, { action: 'delete', targets: [one.target] })).status, 400)
  const response = await f.request(path, {
    action: 'delete',
    confirmed: true,
    targets: [live, { ...one.target, createdAt: one.target.createdAt + 1 }, eligible.target],
  })
  const { outcomes } = await response.json()
  assert.match(outcomes[0].error, /占用/)
  assert.match(outcomes[1].error, /已变更/)
  assert.deepEqual(outcomes[2], { id: eligible.target.id })
  await access(one.directory)
  await assert.rejects(access(eligible.directory), { code: 'ENOENT' })
  assert.deepEqual(removed, [eligible.target.id], '已连接的原生侧栏应只收到成功删除的会话')
  const writer = await f.ctx.sessionPersistence.open(one.target.id, 'write')
  const remove = async () =>
    (await f.request(path, { action: 'delete', confirmed: true, targets: [one.target] })).json()
  try {
    assert.match((await remove()).outcomes[0].error, /占用/)
    await access(one.directory)
  } finally {
    await writer.close()
  }
  assert.deepEqual(await remove(), { outcomes: [{ id: one.target.id }] })
  await assert.rejects(access(one.directory), { code: 'ENOENT' })
  assert.deepEqual(removed, [eligible.target.id, one.target.id])
})

test('侧聊会话不出现在会话管理目录，且批量删除请求会被侧聊宿主认领拦截', async (t) => {
  const f = await runtime(t, { side: true })
  const draftResponse = await f.request('rong-aio.side', { parent: f.agent.id, action: 'draft' })
  assert.equal(draftResponse.status, 200)
  const { fork } = await draftResponse.json()
  const createResponse = await f.request('rong-aio.side', {
    ...fork,
    action: 'create',
    key: randomUUID(),
    text: '侧聊隔离测试',
    permission: 'read',
  })
  assert.equal(createResponse.status, 200)
  const { id: sideId } = await createResponse.json()
  await f.ctx.agents.get(sideId).whenIdle()

  const listResponse = await f.request('rong-aio.session-manager')
  assert.equal(listResponse.status, 200)
  const rows = await listResponse.json()
  assert.equal(
    rows.some((row) => row.id === sideId),
    false,
  )

  const deleteResponse = await f.request('rong-aio.session-manager', {
    action: 'delete',
    confirmed: true,
    targets: [{ id: sideId, createdAt: f.ctx.agents.get(sideId).session.header.createdAt }],
  })
  assert.equal(deleteResponse.status, 200)
  const { outcomes } = await deleteResponse.json()
  assert.equal(outcomes.length, 1)
  assert.match(outcomes[0].error, /侧聊历史/)
})

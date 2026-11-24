import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { runtime, storedSession } from './helpers/runtime.ts'

test('列表查询、批量归档复原、打开工作区及过期目标隔离', async (t) => {
  const f = await runtime(t)
  const alpha = await storedSession(f, 'alpha')
  const beta = await storedSession(f, 'beta')
  const api = 'rong-aio.session-manager'

  const rows = (await (await f.request(api)).json()) as Array<{
    id: string
    archived: boolean
    live: boolean
    canOpenDirectory: boolean
    directory?: string
  }>
  const liveRow = rows.find((row) => row.id === f.agent.id)
  const alphaRow = rows.find((row) => row.id === alpha.target.id)
  assert.equal(liveRow?.live, true)
  assert.equal(alphaRow?.archived, false)
  assert.equal(alphaRow?.directory, alpha.directory)
  assert.equal(alphaRow?.canOpenDirectory, true)

  const archiveRes = await f.request(api, {
    action: 'archive',
    targets: [alpha.target, { ...beta.target, createdAt: beta.target.createdAt + 1 }],
  })
  assert.equal(archiveRes.status, 200)
  const archiveOutcomes = (
    (await archiveRes.json()) as { outcomes: Array<{ id: string; error?: string }> }
  ).outcomes
  assert.deepEqual(archiveOutcomes[0], { id: alpha.target.id })
  assert.match(archiveOutcomes[1].error ?? '', /已变更/)

  const afterArchive = (await (await f.request(api)).json()) as typeof rows
  assert.equal(afterArchive.find((row) => row.id === alpha.target.id)?.archived, true)
  assert.equal(afterArchive.find((row) => row.id === beta.target.id)?.archived, false)

  const restoreRes = await f.request(api, { action: 'restore', targets: [alpha.target] })
  assert.deepEqual(await restoreRes.json(), { outcomes: [{ id: alpha.target.id }] })
  const afterRestore = (await (await f.request(api)).json()) as typeof rows
  assert.equal(afterRestore.find((row) => row.id === alpha.target.id)?.archived, false)

  const openRes = await f.request(api, { action: 'open-directory', target: beta.target })
  assert.equal(openRes.status, 200)
  assert.deepEqual(f.openedDirectories, [beta.directory])
})

test('批量删除清理存档、速度设置、工作区引用与孤立 spill 文件，保留跨会话引用', async (t) => {
  const f = await runtime(t, { spills: true })
  const one = await storedSession(f, 'first-session')
  const two = await storedSession(f, 'second-session')
  const other = await storedSession(
    f,
    'another-session',
    undefined,
    '保留引用 deadbeef0002-keep.txt',
  )

  const speedIdentity = (id: string) => ({ sessionId: id, ...f.route })
  const readSpeed = async (id: string) =>
    (
      (await (
        await f.request('rong-aio.speed?' + new URLSearchParams(speedIdentity(id)))
      ).json()) as {
        mode: string
      }
    ).mode

  for (const { target } of [one, other]) {
    const saved = await f.request('rong-aio.speed', { ...speedIdentity(target.id), mode: 'fast' })
    assert.equal(((await saved.json()) as { mode: string }).mode, 'fast')
  }

  for (const item of [one, two, other]) {
    await writeFile(join(item.directory, 'system_inject.json'), 'snapshot')
  }

  const spillDir = join(f.spillsRoot, one.target.id)
  const orphanSpill = join(spillDir, 'deadbeef0001-orphan.txt')
  const sharedSpill = join(spillDir, 'deadbeef0002-keep.txt')
  await mkdir(spillDir, { recursive: true })
  await writeFile(orphanSpill, 'orphan')
  await writeFile(sharedSpill, 'shared')

  const response = await f.request('rong-aio.session-manager', {
    action: 'delete',
    confirmed: true,
    targets: [one.target, two.target],
  })
  assert.deepEqual(await response.json(), {
    outcomes: [{ id: one.target.id }, { id: two.target.id }],
  })

  for (const item of [one, two]) {
    await assert.rejects(access(item.directory), { code: 'ENOENT' })
    assert.equal(await f.ctx.sessionPersistence.stat(item.target.id as never), undefined)
  }

  await assert.rejects(access(orphanSpill), { code: 'ENOENT' })
  assert.equal(await readFile(sharedSpill, 'utf8'), 'shared')
  assert.equal(await readFile(join(other.directory, 'system_inject.json'), 'utf8'), 'snapshot')
  assert.equal(await readSpeed(one.target.id), 'standard')
  assert.equal(await readSpeed(other.target.id), 'fast')
  assert.deepEqual(
    f.ctx.workspaceRegistry.list()[0].sessionIds.filter((id) => id !== f.agent.id),
    [other.target.id],
  )
})

test('缺少删除确认时拒绝请求；隔离占用会话与侧聊历史', async (t) => {
  const f = await runtime(t, { side: true })
  const one = await storedSession(f, 'old')
  const eligible = await storedSession(f, 'eligible')
  const live = { id: f.agent.id, createdAt: f.agent.session.header.createdAt }
  const api = 'rong-aio.session-manager'
  const removed: string[] = []
  f.ctx.on('api-session/removed' as never, (id: string) => {
    removed.push(id)
  })

  assert.equal((await f.request(api, { action: 'delete', targets: [one.target] })).status, 400)

  const batchRes = await f.request(api, {
    action: 'delete',
    confirmed: true,
    targets: [live, { ...one.target, createdAt: one.target.createdAt + 1 }, eligible.target],
  })
  const { outcomes } = (await batchRes.json()) as {
    outcomes: Array<{ id: string; error?: string }>
  }
  assert.match(outcomes[0].error ?? '', /占用/)
  assert.match(outcomes[1].error ?? '', /已变更/)
  assert.deepEqual(outcomes[2], { id: eligible.target.id })
  await access(one.directory)
  await assert.rejects(access(eligible.directory), { code: 'ENOENT' })
  assert.deepEqual(removed, [eligible.target.id])

  const writer = await f.ctx.sessionPersistence.open(one.target.id as never, 'write')
  const deleteOne = async () =>
    (
      await f.request(api, { action: 'delete', confirmed: true, targets: [one.target] })
    ).json() as Promise<{
      outcomes: Array<{ id: string; error?: string }>
    }>

  try {
    assert.match((await deleteOne()).outcomes[0].error ?? '', /占用/)
    await access(one.directory)
  } finally {
    await writer.close()
  }
  assert.deepEqual(await deleteOne(), { outcomes: [{ id: one.target.id }] })
  await assert.rejects(access(one.directory), { code: 'ENOENT' })
  assert.deepEqual(removed, [eligible.target.id, one.target.id])

  const draftRes = await f.request('rong-aio.side', { parent: f.agent.id, action: 'draft' })
  const { fork } = (await draftRes.json()) as { fork: Record<string, unknown> }
  const createRes = await f.request('rong-aio.side', {
    ...fork,
    action: 'create',
    key: randomUUID(),
    text: '侧聊隔离测试',
    permission: 'read',
  })
  const { id: sideId } = (await createRes.json()) as { id: string }
  await f.getAgent(sideId).whenIdle()

  const rows = (await (await f.request(api)).json()) as Array<{ id: string }>
  assert.equal(
    rows.some((row) => row.id === sideId),
    false,
  )

  const sideDelete = await f.request(api, {
    action: 'delete',
    confirmed: true,
    targets: [{ id: sideId, createdAt: f.getAgent(sideId).session.header.createdAt }],
  })
  const sideOutcomes = (
    (await sideDelete.json()) as {
      outcomes: Array<{ id: string; error?: string }>
    }
  ).outcomes
  assert.equal(sideOutcomes.length, 1)
  assert.match(sideOutcomes[0].error ?? '', /侧聊历史/)
})

test('子会话继承主会话工作区与归档状态，禁止单独操作并随主会话连带删除', async (t) => {
  const f = await runtime(t, { spills: true })
  const api = 'rong-aio.session-manager'
  const parent = await storedSession(f, 'main-parent', undefined, '主引用 deadbeef2222-child.txt')
  const child = await storedSession(f, 'child-sub', undefined, undefined, {
    parentSession: 'main-parent' as never,
    origin: 'subagent',
  })
  const grand = await storedSession(f, 'grand-sub', undefined, undefined, {
    parentSession: 'child-sub' as never,
    origin: 'subagent',
  })
  const ordinaryFork = await storedSession(f, 'ordinary-fork', undefined, undefined, {
    parentSession: 'main-parent' as never,
  })

  type Row = {
    id: string
    archived: boolean
    subagent: boolean
    parentId?: string
    workspace: { key: string; title: string }
  }
  const fetchRows = async () => (await (await f.request(api)).json()) as Row[]

  const initial = await fetchRows()
  const parentRow = initial.find((row) => row.id === parent.target.id)!
  const childRow = initial.find((row) => row.id === child.target.id)!
  const grandRow = initial.find((row) => row.id === grand.target.id)!
  const forkRow = initial.find((row) => row.id === ordinaryFork.target.id)!

  assert.equal(parentRow.subagent, false)
  assert.equal(childRow.subagent, true)
  assert.equal(childRow.parentId, parent.target.id)
  assert.deepEqual(childRow.workspace, parentRow.workspace)
  assert.equal(grandRow.subagent, true)
  assert.equal(grandRow.parentId, child.target.id)
  assert.deepEqual(grandRow.workspace, parentRow.workspace)
  assert.equal(forkRow.subagent, false)
  assert.equal(forkRow.parentId, undefined)

  for (const action of ['archive', 'restore'] as const) {
    const res = (await (await f.request(api, { action, targets: [child.target] })).json()) as {
      outcomes: Array<{ id: string; error?: string }>
    }
    assert.match(res.outcomes[0].error ?? '', /子会话跟随所属主会话/)
  }
  const directDelete = (await (
    await f.request(api, { action: 'delete', confirmed: true, targets: [grand.target] })
  ).json()) as { outcomes: Array<{ id: string; error?: string }> }
  assert.match(directDelete.outcomes[0].error ?? '', /子会话不支持单独删除/)

  await f.request(api, { action: 'archive', targets: [parent.target] })
  const archivedRows = await fetchRows()
  assert.equal(archivedRows.find((row) => row.id === parent.target.id)?.archived, true)
  assert.equal(archivedRows.find((row) => row.id === child.target.id)?.archived, true)
  assert.equal(archivedRows.find((row) => row.id === grand.target.id)?.archived, true)
  assert.equal(archivedRows.find((row) => row.id === ordinaryFork.target.id)?.archived, false)

  await f.request(api, { action: 'restore', targets: [parent.target] })
  const restoredRows = await fetchRows()
  assert.equal(restoredRows.find((row) => row.id === grand.target.id)?.archived, false)

  const liveGrand = await f.ctx.agents.resume({
    resumeSessionId: 'grand-sub' as never,
    agentOptions: f.route,
  })
  const blockedDelete = (await (
    await f.request(api, { action: 'delete', confirmed: true, targets: [parent.target] })
  ).json()) as { outcomes: Array<{ id: string; error?: string }> }
  assert.match(blockedDelete.outcomes[0].error ?? '', /子会话.*占用/)
  await access(parent.directory)
  await access(child.directory)
  await access(grand.directory)
  await liveGrand.dispose()

  const parentSpillDir = join(f.spillsRoot, parent.target.id)
  const childSpillDir = join(f.spillsRoot, child.target.id)
  const parentSpill = join(parentSpillDir, 'deadbeef1111-parent.txt')
  const childSpill = join(childSpillDir, 'deadbeef2222-child.txt')
  await mkdir(parentSpillDir, { recursive: true })
  await mkdir(childSpillDir, { recursive: true })
  await writeFile(parentSpill, 'parent-spill')
  await writeFile(childSpill, 'child-spill')

  for (const target of [parent.target, child.target, grand.target]) {
    await f.request('rong-aio.speed', { sessionId: target.id, ...f.route, mode: 'fast' })
  }

  const removed: string[] = []
  f.ctx.on('api-session/removed' as never, (id: string) => {
    removed.push(id)
  })

  const cascadeRes = await f.request(api, {
    action: 'delete',
    confirmed: true,
    targets: [parent.target],
  })
  assert.deepEqual(await cascadeRes.json(), { outcomes: [{ id: parent.target.id }] })

  for (const item of [parent, child, grand]) {
    await assert.rejects(access(item.directory), { code: 'ENOENT' })
    assert.equal(await f.ctx.sessionPersistence.stat(item.target.id as never), undefined)
    const speed = (await (
      await f.request(
        'rong-aio.speed?' + new URLSearchParams({ sessionId: item.target.id, ...f.route }),
      )
    ).json()) as { mode: string }
    assert.equal(speed.mode, 'standard')
  }
  await assert.rejects(access(parentSpill), { code: 'ENOENT' })
  await assert.rejects(access(childSpill), { code: 'ENOENT' })
  await access(ordinaryFork.directory)
  assert.deepEqual(removed, [grand.target.id, child.target.id, parent.target.id])
})

test('主会话缺失时聚合多级孤立子会话并支持统一归档、复原与级联清理', async (t) => {
  const f = await runtime(t, { spills: true })
  const api = 'rong-aio.session-manager'
  const orphanChild = await storedSession(f, 'orphan-child', undefined, undefined, {
    parentSession: 'deleted-main' as never,
    origin: 'subagent',
  })
  const orphanGrand = await storedSession(f, 'orphan-grand', undefined, undefined, {
    parentSession: 'orphan-child' as never,
    origin: 'subagent',
  })
  const orphanSibling = await storedSession(f, 'orphan-sibling', undefined, undefined, {
    parentSession: 'deleted-main' as never,
    origin: 'subagent',
  })

  type Row = {
    id: string
    createdAt: number
    title: string
    archived: boolean
    canOpenDirectory: boolean
    live: boolean
    subagent: boolean
    missing?: boolean
    parentId?: string
    workspace: { key: string; title: string }
  }
  const fetchRows = async () => (await (await f.request(api)).json()) as Row[]

  const initial = await fetchRows()
  const missingRoot = initial.find((row) => row.id === 'deleted-main')!
  assert.equal(missingRoot.missing, true)
  assert.equal(missingRoot.subagent, false)
  assert.equal(missingRoot.title, '主会话已缺失')
  assert.equal(missingRoot.archived, false)
  assert.equal(missingRoot.canOpenDirectory, false)
  assert.equal(missingRoot.live, false)
  assert.equal(missingRoot.createdAt, orphanChild.target.createdAt)

  const childRow = initial.find((row) => row.id === 'orphan-child')!
  const grandRow = initial.find((row) => row.id === 'orphan-grand')!
  const siblingRow = initial.find((row) => row.id === 'orphan-sibling')!
  assert.equal(childRow.parentId, 'deleted-main')
  assert.equal(siblingRow.parentId, 'deleted-main')
  assert.equal(grandRow.parentId, 'orphan-child')
  assert.deepEqual(childRow.workspace, missingRoot.workspace)
  assert.deepEqual(grandRow.workspace, missingRoot.workspace)

  const missingTarget = { id: 'deleted-main', createdAt: missingRoot.createdAt }

  for (const action of ['archive', 'restore'] as const) {
    const res = (await (
      await f.request(api, { action, targets: [orphanChild.target] })
    ).json()) as {
      outcomes: Array<{ id: string; error?: string }>
    }
    assert.match(res.outcomes[0].error ?? '', /子会话跟随所属主会话/)
  }
  const directDelete = (await (
    await f.request(api, { action: 'delete', confirmed: true, targets: [orphanGrand.target] })
  ).json()) as { outcomes: Array<{ id: string; error?: string }> }
  assert.match(directDelete.outcomes[0].error ?? '', /子会话不支持单独删除/)

  const archiveRes = await f.request(api, { action: 'archive', targets: [missingTarget] })
  assert.deepEqual(await archiveRes.json(), { outcomes: [{ id: 'deleted-main' }] })
  const archivedRows = await fetchRows()
  for (const id of ['deleted-main', 'orphan-child', 'orphan-grand', 'orphan-sibling']) {
    assert.equal(archivedRows.find((row) => row.id === id)?.archived, true)
  }

  const restoreRes = await f.request(api, { action: 'restore', targets: [missingTarget] })
  assert.deepEqual(await restoreRes.json(), { outcomes: [{ id: 'deleted-main' }] })
  const restoredRows = await fetchRows()
  for (const id of ['deleted-main', 'orphan-child', 'orphan-grand', 'orphan-sibling']) {
    assert.equal(restoredRows.find((row) => row.id === id)?.archived, false)
  }

  const childSpillDir = join(f.spillsRoot, orphanChild.target.id)
  const childSpill = join(childSpillDir, 'deadbeef3333-orphan.txt')
  await mkdir(childSpillDir, { recursive: true })
  await writeFile(childSpill, 'orphan-spill')
  await f.request('rong-aio.speed', {
    sessionId: orphanGrand.target.id,
    ...f.route,
    mode: 'fast',
  })

  const removed: string[] = []
  f.ctx.on('api-session/removed' as never, (id: string) => {
    removed.push(id)
  })

  const deleteRes = await f.request(api, {
    action: 'delete',
    confirmed: true,
    targets: [missingTarget],
  })
  assert.deepEqual(await deleteRes.json(), { outcomes: [{ id: 'deleted-main' }] })

  for (const item of [orphanChild, orphanGrand, orphanSibling]) {
    await assert.rejects(access(item.directory), { code: 'ENOENT' })
    assert.equal(await f.ctx.sessionPersistence.stat(item.target.id as never), undefined)
  }
  await assert.rejects(access(childSpill), { code: 'ENOENT' })
  const speed = (await (
    await f.request(
      'rong-aio.speed?' + new URLSearchParams({ sessionId: orphanGrand.target.id, ...f.route }),
    )
  ).json()) as { mode: string }
  assert.equal(speed.mode, 'standard')
  assert.deepEqual(removed, [orphanGrand.target.id, orphanChild.target.id, orphanSibling.target.id])

  const afterDelete = await fetchRows()
  for (const id of ['deleted-main', 'orphan-child', 'orphan-grand', 'orphan-sibling']) {
    assert.equal(
      afterDelete.some((row) => row.id === id),
      false,
    )
  }
})

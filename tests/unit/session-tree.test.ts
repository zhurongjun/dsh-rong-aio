import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionRow } from '../../src/components/session-manager/shared/protocol.ts'
import {
  buildSessionTree,
  collectExpandableIds,
} from '../../src/components/session-manager/shared/tree.ts'

function makeRow(overrides: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    createdAt: 1000,
    title: overrides.id,
    workspace: { key: 'ws-1', title: '工作区' },
    canOpenDirectory: false,
    archived: false,
    live: false,
    subagent: false,
    ...overrides,
  }
}

test('buildSessionTree：多级父子挂载、深度统计、创建时序排序、后代占用向上传导与可折叠节点收集', () => {
  const rows = [
    makeRow({ id: 'main', createdAt: 100 }),
    makeRow({ id: 'sub-b', createdAt: 300, subagent: true, parentId: 'main' }),
    makeRow({ id: 'sub-a', createdAt: 200, subagent: true, parentId: 'main' }),
    makeRow({ id: 'grand', createdAt: 400, subagent: true, parentId: 'sub-a' }),
    makeRow({ id: 'great', createdAt: 500, subagent: true, parentId: 'grand', live: true }),
  ]

  const roots = buildSessionTree(rows)
  assert.equal(roots.length, 1)
  const main = roots[0]
  assert.equal(main.row.id, 'main')
  assert.equal(main.depth, 0)
  assert.equal(main.maxSubtreeDepth, 3)
  assert.deepEqual(
    main.children.map((node) => node.row.id),
    ['sub-a', 'sub-b'],
  )
  assert.equal(main.children[0].depth, 1)
  assert.equal(main.children[0].maxSubtreeDepth, 2)
  assert.equal(main.children[1].depth, 1)
  assert.equal(main.children[1].maxSubtreeDepth, 0)

  const grand = main.children[0].children[0]
  assert.equal(grand.row.id, 'grand')
  assert.equal(grand.depth, 2)
  assert.equal(grand.maxSubtreeDepth, 1)
  assert.equal(grand.children[0].row.id, 'great')
  assert.equal(grand.children[0].depth, 3)
  assert.equal(grand.children[0].maxSubtreeDepth, 0)

  assert.deepEqual(
    main.descendants.map((item) => item.id),
    ['sub-a', 'grand', 'great', 'sub-b'],
  )
  assert.equal(main.descendantLive, true)
  assert.equal(main.children[0].descendantLive, true)
  assert.equal(grand.descendantLive, true)
  assert.equal(grand.children[0].descendantLive, false)
  assert.equal(main.children[1].descendantLive, false)
  assert.deepEqual(collectExpandableIds(roots), ['main', 'sub-a', 'grand'])
})

test('buildSessionTree：区分普通分叉、聚合缺失主会话的多级孤立子会话并安全隔离异常环路', () => {
  const rows = [
    makeRow({ id: 'main', createdAt: 100 }),
    makeRow({ id: 'ordinary-fork', createdAt: 200, subagent: false, parentId: 'main' }),
    makeRow({
      id: 'orphan-a',
      createdAt: 300,
      subagent: true,
      parentId: 'missing-main',
      archived: true,
    }),
    makeRow({
      id: 'orphan-b',
      createdAt: 350,
      subagent: true,
      parentId: 'missing-main',
      archived: true,
    }),
    makeRow({
      id: 'orphan-grand',
      createdAt: 360,
      subagent: true,
      parentId: 'orphan-a',
      archived: true,
    }),
    makeRow({ id: 'orphan-noparent', createdAt: 380, subagent: true }),
    makeRow({ id: 'cycle-a', createdAt: 400, subagent: true, parentId: 'cycle-b' }),
    makeRow({ id: 'cycle-b', createdAt: 500, subagent: true, parentId: 'cycle-a' }),
  ]

  const roots = buildSessionTree(rows)
  assert.equal(
    roots.every((root) => !root.row.subagent),
    true,
  )
  assert.deepEqual(
    roots.map((node) => node.row.id),
    [
      'missing-root:cycle-b',
      'missing-root:orphan-noparent',
      'missing-main',
      'ordinary-fork',
      'main',
    ],
  )

  const missingRoot = roots.find((node) => node.row.id === 'missing-main')!
  assert.equal(missingRoot.row.missing, true)
  assert.equal(missingRoot.row.title, '主会话已缺失')
  assert.equal(missingRoot.row.createdAt, 300)
  assert.equal(missingRoot.row.archived, true)
  assert.equal(missingRoot.maxSubtreeDepth, 2)
  assert.deepEqual(
    missingRoot.children.map((node) => node.row.id),
    ['orphan-a', 'orphan-b'],
  )
  assert.deepEqual(
    missingRoot.children[0].children.map((node) => node.row.id),
    ['orphan-grand'],
  )
  assert.deepEqual(
    missingRoot.descendants.map((item) => item.id),
    ['orphan-a', 'orphan-grand', 'orphan-b'],
  )

  const ordinaryFork = roots.find((node) => node.row.id === 'ordinary-fork')!
  assert.equal(ordinaryFork.children.length, 0)
  assert.equal(ordinaryFork.row.missing, undefined)

  const cycleRoot = roots.find((node) => node.row.id === 'missing-root:cycle-b')!
  assert.equal(cycleRoot.row.missing, true)
  assert.deepEqual(
    cycleRoot.children.map((node) => node.row.id),
    ['cycle-b'],
  )
  assert.deepEqual(
    cycleRoot.children[0].children.map((node) => node.row.id),
    ['cycle-a'],
  )
})

test('buildSessionTree：搜索保留命中后代的完整祖先链、维持全量后代信息并支持归档范围过滤', () => {
  const rows = [
    makeRow({ id: 'main', title: '主对话', createdAt: 100, archived: false }),
    makeRow({ id: 'sub-a', title: '子分支A', createdAt: 200, subagent: true, parentId: 'main' }),
    makeRow({
      id: 'grand',
      title: '目标孙节点',
      createdAt: 300,
      subagent: true,
      parentId: 'sub-a',
    }),
    makeRow({
      id: 'sub-b',
      title: '其他子分支',
      createdAt: 400,
      subagent: true,
      parentId: 'main',
      live: true,
    }),
    makeRow({
      id: 'archived-orphan',
      title: '已归档孤立节点',
      createdAt: 500,
      subagent: true,
      parentId: 'archived-missing',
      archived: true,
    }),
  ]

  const hitChild = buildSessionTree(rows, '目标孙节点', false)
  assert.equal(hitChild.length, 1)
  assert.equal(hitChild[0].row.id, 'main')
  assert.equal(hitChild[0].depth, 0)
  assert.equal(hitChild[0].children[0].depth, 1)
  assert.equal(hitChild[0].children[0].children[0].row.id, 'grand')
  assert.equal(hitChild[0].children[0].children[0].depth, 2)
  assert.deepEqual(
    hitChild[0].descendants.map((item) => item.id),
    ['sub-a', 'grand', 'sub-b'],
  )
  assert.equal(hitChild[0].descendantLive, true)

  const archivedRoots = buildSessionTree(rows, undefined, true)
  assert.deepEqual(
    archivedRoots.map((node) => node.row.id),
    ['archived-missing'],
  )
  assert.equal(archivedRoots[0].row.missing, true)

  const hitParent = buildSessionTree(rows, '主对话', false)
  assert.equal(hitParent.length, 1)
  assert.deepEqual(
    hitParent[0].children.map((node) => node.row.id),
    ['sub-a', 'sub-b'],
  )

  assert.deepEqual(buildSessionTree(rows, '不存在关键字', false), [])
})

/** 选择器状态回归：预览、保存互斥与通知顺序。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSelectorStore } from '../../../../src/components/model-selector/client/model-selector/selector-store.ts'

test('选择器状态：实例隔离、原子切换、重复操作不通知、保存互斥', () => {
  const first = createSelectorStore()
  const second = createSelectorStore()
  const actions = first.getState().actions
  const snapshots: ReturnType<typeof first.getState>[] = []
  const unsubscribe = first.subscribe((state) => snapshots.push(state))
  actions.show('effort')
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0]!.mounted, true)
  assert.equal(second.getState().open, false)
  actions.preview('first', 'high')
  const before = first.getState()
  actions.preview('first', 'high')
  assert.equal(first.getState(), before)
  actions.close()
  assert.equal(first.getState().preview, undefined)
  assert.equal(first.getState().mounted, true)
  actions.show('effort')
  actions.unmount() // 已重新打开时，旧退出计时器不能卸载弹层。
  assert.equal(first.getState().mounted, true)
  const request = { kind: 'effort' as const, routeKey: 'first', effort: 'max' }
  const firstId = actions.startSelection(request)!
  assert.equal(typeof firstId, 'number')
  assert.equal(actions.startSelection(request), null)
  actions.finishSelection(firstId)
  const secondId = actions.startSelection(request)!
  assert.ok(secondId > firstId)
  actions.finishSelection(firstId)
  assert.equal(first.getState().operation?.id, secondId, '迟到结束不能释放新操作')
  assert.deepEqual(before.preview, { routeKey: 'first', effort: 'high' })
  assert.equal(first.getState().actions, actions)
  unsubscribe()
})

test('预览只属于当前路由；保存接管预览，关开面板不丢失进行中操作', () => {
  const store = createSelectorStore()
  const actions = store.getState().actions
  actions.preview('new', 'high')
  actions.preview('old', undefined)
  assert.deepEqual(store.getState().preview, { routeKey: 'new', effort: 'high' })
  const id = actions.startSelection({ kind: 'reset', routeKey: 'new', effort: 'medium' })!
  actions.preview('new', 'off')
  assert.equal(store.getState().preview, undefined)
  actions.close()
  actions.show('effort')
  assert.equal(store.getState().operation?.effort, 'medium')
  actions.finishSelection(id)
  assert.equal(store.getState().operation, null)
})

test('重复拒绝重新启动 toast，旧退出回调不能清掉新通知', () => {
  const store = createSelectorStore()
  const actions = store.getState().actions
  actions.reportError('模型拒绝')
  const first = store.getState().errorSequence
  actions.reportError('模型拒绝')
  const second = store.getState().errorSequence
  assert.ok(second > first)
  actions.dismissError(first)
  assert.equal(store.getState().error, '模型拒绝')
  actions.dismissError(second)
  assert.equal(store.getState().error, null)
})

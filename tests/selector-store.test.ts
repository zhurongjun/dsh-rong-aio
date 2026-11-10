/** 瞬时 store 回归：快速开合、Toast 序号，以及 Fast 迟到请求和重复写入防护。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSelectorStore } from '../src/components/model-selector/client/model-selector/selector-store.ts'
import { createSpeedStore } from '../src/components/model-selector/client/model-selector/speed-store.ts'
import { speedKey } from '../src/components/model-selector/shared/speed.ts'

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

test('Fast 请求：路由切换与卸载取消旧写入，迟到结果不污染状态，重入不重复提交', async (t) => {
  const requests: { signal: AbortSignal; resolve(response: Response): void }[] = []
  t.mock.method(
    globalThis,
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => requests.push({ signal: init.signal!, resolve })),
  )
  const errors: string[] = []
  const store = createSpeedStore((error) => errors.push(error))
  const first = { sessionId: 'session', provider: 'first', model: 'gpt-6-astra' }
  const second = { ...first, provider: 'second' }

  const reply = async (index: number, mode: string) => {
    requests[index]!.resolve(Response.json({ mode, modes: ['standard', 'fast'] }))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  store.sync(first, false)
  await reply(0, 'standard')
  store.sync(first, false)
  assert.equal(requests.length, 1, '关闭的弹层复用已确认状态')
  const oldWrite = store.select(speedKey(first), 'fast')
  await store.select(speedKey(first), 'fast')
  assert.equal(requests.length, 2)
  store.sync(second, false)
  assert.equal(requests[1]!.signal.aborted, true)
  await reply(2, 'standard')
  await reply(1, 'fast')
  await oldWrite
  assert.equal(store.getState().key, speedKey(second))
  assert.equal(store.getState().value.mode, 'standard')
  await store.select(speedKey(first), 'fast')
  assert.equal(requests.length, 3, '旧组件事件不能向新路由写入')
  const write = store.select(speedKey(second), 'fast')
  store.dispose()
  const disposed = store.getState()
  assert.equal(requests[3]!.signal.aborted, true)
  requests[3]!.resolve(Response.json({ error: '过期失败' }, { status: 503 }))
  await write
  assert.equal(store.getState(), disposed)
  assert.deepEqual(errors, [])
  await store.select(speedKey(second), 'fast')
  assert.equal(requests.length, 4, '卸载后禁止写入')

  // React StrictMode 的 effect 清理/重建允许复用实例，不能卡在 saving。
  store.sync(second, true)
  await reply(4, 'fast')
  assert.equal(store.getState().saving, false)
  assert.equal(store.getState().value.mode, 'fast')
  store.dispose()
})

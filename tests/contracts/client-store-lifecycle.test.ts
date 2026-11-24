/** 验证客户端 store 订阅自托管生命期与菜单退场卸载状态机。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import { createMenuPresence, withLifecycle } from '../../src/client/store.ts'

test('withLifecycle：仅在首个订阅建立时激活、末位取消后清理，且支持再次订阅恢复', () => {
  let activeCount = 0
  let cleanupCount = 0
  const store = withLifecycle(
    createStore(() => ({ value: 0 })),
    () => {
      activeCount++
      return () => {
        cleanupCount++
      }
    },
  )

  const unsub1 = store.subscribe(() => {})
  const unsub2 = store.subscribe(() => {})
  assert.equal(activeCount, 1)
  assert.equal(cleanupCount, 0)

  unsub1()
  assert.equal(cleanupCount, 0)
  unsub1()
  assert.equal(cleanupCount, 0)

  unsub2()
  assert.equal(cleanupCount, 1)

  const unsub3 = store.subscribe(() => {})
  assert.equal(activeCount, 2)
  assert.equal(cleanupCount, 1)
  unsub3()
  assert.equal(cleanupCount, 2)
})

test('createMenuPresence：关闭后保留退场挂载窗口，重新打开可取消卸载，unmount 立即收尾', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const presence = createMenuPresence(180)
  const unsubscribe = presence.subscribe(() => {})

  assert.deepEqual(presence.getState(), { expanded: false, mounted: false })

  presence.open()
  assert.deepEqual(presence.getState(), { expanded: true, mounted: true })

  presence.close()
  assert.deepEqual(presence.getState(), { expanded: false, mounted: true })

  t.mock.timers.tick(100)
  presence.open()
  assert.deepEqual(presence.getState(), { expanded: true, mounted: true })

  t.mock.timers.tick(200)
  assert.deepEqual(presence.getState(), { expanded: true, mounted: true })

  presence.close()
  assert.deepEqual(presence.getState(), { expanded: false, mounted: true })
  t.mock.timers.tick(180)
  assert.deepEqual(presence.getState(), { expanded: false, mounted: false })

  presence.open()
  presence.close()
  presence.unmount()
  assert.deepEqual(presence.getState(), { expanded: false, mounted: false })

  unsubscribe()
})

/** 验证读取失败关闭后同文案再次失败仍会弹出新通知。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionState } from '../../../src/components/system-inject/client/session-state.ts'
import { createInjectStore } from '../../../src/components/system-inject/client/store.ts'

function projectNotice(store: ReturnType<typeof createInjectStore>) {
  const state = store.getState()
  return sessionState(
    state.data,
    state.verified,
    state.saving,
    state.error,
    state.errorId,
    state.dismissedNotice,
  ).notice
}

test('关闭读取失败通知后，再次遇到相同文案的读取失败仍会生成新通知', async (t) => {
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: '读取超时' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )

  const store = createInjectStore('session-1')
  t.after(() => store.dispose())

  await store.refresh()
  const firstNotice = projectNotice(store)
  assert.equal(firstNotice?.message, '读取超时')

  store.dismissNotice()
  assert.equal(projectNotice(store), undefined)

  await store.refresh()
  const secondNotice = projectNotice(store)
  assert.equal(secondNotice?.message, '读取超时')
  assert.notEqual(secondNotice?.key, firstNotice?.key)
})

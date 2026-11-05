/** 验证输入框展示忠实读取 resolved，通知与发送阶段不会重新推断破甲状态。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture } from './helpers/system-inject.ts'
import { sessionState } from '../src/components/system-inject/client/session-state.ts'
import type { StateView } from '../src/components/system-inject/shared/protocol.ts'

test('UI 忠实展示 resolve 结果，不按是否发送或请求失败切换破甲状态', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure()
  await f.select()
  const state: StateView = {
    ...(await f.controller.view('s')),
    routes: [],
    references: {},
    catalogErrors: [],
  }
  assert.equal(sessionState(state, true, false).active, true)
  assert.equal(sessionState(state, true, false).notice, undefined)
  state.session!.error = { id: 1, message: '模型未获授权' }
  assert.equal(sessionState(state, true, false).active, true)
  assert.equal(sessionState(state, true, false).notice!.message, '模型未获授权')
  state.session!.resolved.status = 'invalid'
  assert.equal(sessionState(state, true, false).active, false)
  assert.equal(sessionState(state, true, false).block, undefined)
  assert.match(sessionState(state, true, true).block!, /保存/)
  assert.equal(sessionState(state, false, false).active, false)
})

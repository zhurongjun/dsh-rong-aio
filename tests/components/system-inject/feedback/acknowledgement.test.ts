/** 会话通知的确认与过期确认隔离。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, prompt } from '../helpers/fixture.ts'

test('选择拒绝是可确认通知，不是当前破甲状态；迟到确认不能清除更新的拒绝', async (t) => {
  const f = await fixture(t)
  await f.put()
  await f.configure([])
  await assert.rejects(
    f.controller.command({ type: 'select', sessionId: 's', state: { name: prompt.name } }),
  )
  const first = f.entry.error!.id
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
  await f.controller.command({ type: 'acknowledge-error', sessionId: 's', noticeId: first })
  assert.equal(f.entry.error, undefined)
  assert.equal((await f.controller.view('s')).session?.error, undefined)
  await assert.rejects(
    f.controller.command({ type: 'select', sessionId: 's', state: { name: prompt.name } }),
  )
  const second = f.entry.error!.id
  assert.notEqual(first, second)
  await f.controller.command({ type: 'acknowledge-error', sessionId: 's', noticeId: first })
  assert.equal(f.entry.error!.id, second)
  await f.controller.command({ type: 'acknowledge-error', sessionId: 's', noticeId: second })
  assert.equal(f.entry.error, undefined)
  assert.equal((await f.controller.view('s')).session!.resolved.status, 'off')
})

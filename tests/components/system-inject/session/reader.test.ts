/** 原生只读 API 边界：替身仅模拟查询返回，拒绝丢失、迁移及损坏状态，不激活会话。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import {
  currentModel,
  hasRequestHistory,
} from '../../../../src/components/system-inject/host/session-reader.ts'

test('模型读取优先 Agent 当前选择；冷会话只接受精确投影，读取错误不回退默认值', async () => {
  const route = { provider: 'fixture', model: 'allowed' }
  let live = true
  let projection: unknown = { kind: 'sequenced', values: { modelSelection: { next: route } } }
  let failure = false
  let reads = 0
  const ctx = {
    agents: { list: () => (live ? [{ id: 's', model: { current: () => route } }] : []) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fallback', model: 'default' }) },
    sessionController: {
      projections: async (request: { sessionId: string }, signal: AbortSignal) => {
        assert.equal(request.sessionId, 's')
        assert.equal(signal.aborted, false)
        reads++
        if (failure) throw new Error('disk failure')
        return projection
      },
    },
  } as unknown as Context
  assert.deepEqual(await currentModel(ctx, 's'), route)
  assert.equal(reads, 0)
  live = false
  assert.deepEqual(await currentModel(ctx, 's'), route)
  projection = { kind: 'migration-required', values: { modelSelection: { next: route } } }
  await assert.rejects(currentModel(ctx, 's'), /迁移/)
  projection = null
  await assert.rejects(currentModel(ctx, 's'), /不存在/)
  failure = true
  await assert.rejects(currentModel(ctx, 's'), /disk failure/)
})

test('历史检测通过被动查询读取完整日志；只有实际空白日志可以放行', async () => {
  let events: { type: string }[] = []
  let fails = false
  const ctx = {
    sessions: { get: () => undefined },
    sessionQuery: {
      inspectSession: async (id: string, read: (session: unknown) => boolean) => {
        assert.equal(id, 's')
        if (fails) throw new Error('损坏的会话日志')
        return read({ snapshotEvents: () => events })
      },
    },
  } as unknown as Context
  assert.equal(await hasRequestHistory(ctx, 's'), false)
  events = [{ type: 'model/selection' }]
  assert.equal(await hasRequestHistory(ctx, 's'), false)
  events.unshift({ type: 'request/header' })
  assert.equal(await hasRequestHistory(ctx, 's'), true)
  fails = true
  await assert.rejects(hasRequestHistory(ctx, 's'), /损坏/)
})

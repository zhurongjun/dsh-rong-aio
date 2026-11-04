import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInjectStore } from '../src/components/system-inject/client/store.ts'
import {
  INJECT_SELECTION_ERROR,
  isInjectSelectionError,
} from '../src/components/system-inject/shared/selection-error.ts'
import { sessionState } from '../src/components/system-inject/client/session-state.ts'
const emptyConfig = () => ({
  revision: 'initial',
  templates: [],
  workspace: '',
  paths: {},
  errors: [],
  whitelist: [],
})

function currentNotice(store: ReturnType<typeof createInjectStore>) {
  const current = store.getState()
  return sessionState(
    current.data,
    current.verified,
    current.saving,
    current.error,
    current.dismissedNotice,
  ).notice
}

test('全局和项目设置范围固定且实例隔离，迟到项目响应不会污染全局；保存沿用相同范围', async () => {
  const original = globalThis.fetch
  const global = createInjectStore()
  const workspace = '/workspace/当前 项目'
  const project = createInjectStore(undefined, workspace)
  const delayed = Promise.withResolvers<Response>()
  const requests: { workspace: string; method: string }[] = []
  const response = (scope: string) => ({
    config: { ...emptyConfig(), workspace: scope },
    routes: [],
    references: {},
    catalogErrors: [],
    resolved: { state: { name: null }, status: 'off', source: 'none', editable: true },
  })
  try {
    globalThis.fetch = async (input, options) => {
      const scope = new URL(String(input), 'http://localhost/').searchParams.get('workspace') ?? ''
      const method = options?.method ?? 'GET'
      requests.push({ workspace: scope, method })
      return scope && method === 'GET' ? delayed.promise : Response.json(response(scope))
    }
    const read = project.refresh()
    await global.refresh()
    assert.equal(global.getState().data?.config?.workspace, '')
    delayed.resolve(Response.json(response(workspace)))
    await read
    assert.equal(project.getState().data?.config?.workspace, workspace)
    assert.equal(global.getState().data?.config?.workspace, '')
    await project.execute({ type: 'whitelist', revision: 'initial', routes: [] })
    await global.execute({ type: 'whitelist', revision: 'initial', routes: [] })
    assert.deepEqual(requests, [
      { workspace, method: 'GET' },
      { workspace: '', method: 'GET' },
      { workspace, method: 'POST' },
      { workspace: '', method: 'POST' },
    ])
    globalThis.fetch = async () => Response.json(response(workspace))
    await global.refresh()
    assert.equal(global.getState().verified, false)
    assert.equal(global.getState().data?.config?.workspace, '')
  } finally {
    global.dispose()
    project.dispose()
    globalThis.fetch = original
  }
})

test('草稿通知确认跨界面挂载与轮询保留，迟到确认响应不覆盖新通知或状态', async () => {
  const original = globalThis.fetch
  const store = createInjectStore('draft')
  const resolved = { state: { name: null }, status: 'off', source: 'none', editable: true }
  const response = (id: number) => ({
    resolved,
    session: {
      sessionId: 'draft',
      resolved,
      state: { name: null },
      error: { id, message: '模型未授权' },
    },
  })
  let server = response(1)
  const acknowledgement = Promise.withResolvers<Response>()
  try {
    globalThis.fetch = async (_url, options) => {
      if (options?.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body as string), {
          type: 'acknowledge-error',
          sessionId: 'draft',
          noticeId: 1,
        })
        return acknowledgement.promise
      }
      return Response.json(server)
    }
    await store.refresh()
    assert.equal(currentNotice(store)?.failureId, 1)
    store.dismissNotice()
    assert.equal(currentNotice(store), undefined)
    // 同一个 DSH 草稿会被重新挂载。新 UI 读取同一 store，不能依赖已卸载组件的 useState。
    const unsubscribe = store.subscribe(() => {})
    unsubscribe()
    await store.refresh()
    assert.equal(currentNotice(store), undefined)
    assert.equal(store.getState().data?.session?.resolved.status, 'off')
    server = response(2)
    await store.refresh()
    assert.equal(currentNotice(store)?.failureId, 2)
    store.dismissNotice('request:1') // 已卸载 toast 的迟到 onDone 不能确认新通知。
    assert.equal(currentNotice(store)?.failureId, 2)
    acknowledgement.resolve(Response.json(response(1)))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(currentNotice(store)?.failureId, 2)
    assert.equal(store.getState().verified, true)
  } finally {
    store.dispose()
    globalThis.fetch = original
  }
})

test('通知确认通信失败不改写破甲状态，后续刷新重试宿主清理', async () => {
  const original = globalThis.fetch
  const store = createInjectStore('draft')
  const resolved = { state: { name: null }, status: 'off', source: 'none', editable: true }
  let failure: { id: number; message: string } | undefined = { id: 1, message: '模型未授权' }
  let attempts = 0
  try {
    globalThis.fetch = async (_url, options) => {
      if (options?.method === 'POST') {
        if (++attempts === 1) throw new Error('offline')
        failure = undefined
      }
      return Response.json({
        resolved,
        session: { sessionId: 'draft', state: { name: null }, resolved, error: failure },
      })
    }
    await store.refresh()
    store.dismissNotice()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(currentNotice(store), undefined)
    assert.equal(store.getState().verified, true)
    assert.equal(store.getState().error, undefined)
    await store.refresh()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(attempts, 2)
    assert.equal(store.getState().data?.session?.error, undefined)
    assert.equal(store.getState().data?.session?.resolved.status, 'off')
  } finally {
    store.dispose()
    globalThis.fetch = original
  }
})

test('明确的选择拒绝保留已确认状态与光晕，直接呈现对应通知', async () => {
  const original = globalThis.fetch
  const store = createInjectStore('s')
  const resolved = {
    state: { name: 'a', snapshot: { display_name: 'A', description: '', body: 'BODY' } },
    status: 'on',
    source: 'session',
    editable: true,
  }
  try {
    globalThis.fetch = async () =>
      Response.json({ session: { sessionId: 's', resolved, state: { name: 'a' } }, resolved })
    await store.refresh()
    globalThis.fetch = async () =>
      Response.json(
        { code: INJECT_SELECTION_ERROR, error: '组合不兼容', details: { noticeId: 9 } },
        { status: 409 },
      )
    assert.equal(
      await store.execute({ type: 'select', sessionId: 's', state: { name: 'b' } }),
      false,
    )
    assert.equal(store.getState().verified, true)
    assert.equal(store.getState().data?.session?.resolved.status, 'on')
    assert.equal(store.getState().data?.session?.state.name, 'a')
    assert.equal(store.getState().data?.session?.error?.id, 9)
    assert.equal(store.getState().error, undefined)
  } finally {
    store.dispose()
    globalThis.fetch = original
  }
})

test('前端读取失败不保留成功标记，保存失败保留已知内容且不宣称已生效', async () => {
  const original = globalThis.fetch
  const store = createInjectStore()
  const state = {
    config: emptyConfig(),
    routes: [],
    references: {},
    catalogErrors: [],
    resolved: { state: { name: null }, status: 'off', source: 'none', editable: true },
  }
  try {
    globalThis.fetch = async () => Response.json(state)
    await store.refresh()
    assert.equal(store.getState().verified, true)
    globalThis.fetch = async () => Response.json({ error: '存储失败' }, { status: 503 })
    assert.equal(
      await store.execute({
        type: 'whitelist',
        revision: 'initial',
        routes: [],
      }),
      false,
    )
    assert.equal(store.getState().verified, false)
    assert.equal(store.getState().error, '存储失败')
    assert.deepEqual(store.getState().data, state)
    await store.refresh()
    assert.equal(store.getState().verified, false)
  } finally {
    store.dispose()
    globalThis.fetch = original
  }
})

test('前端过期读取不覆盖保存结果，组件停用中止未完成请求', async () => {
  const original = globalThis.fetch
  const store = createInjectStore()
  let finishRead: ((response: Response) => void) | undefined
  let signal: AbortSignal | undefined
  try {
    globalThis.fetch = async (_input, init) => {
      signal = init?.signal as AbortSignal
      if (init?.method === 'POST')
        return Response.json({
          config: { ...emptyConfig(), revision: 'updated' },
          routes: [],
          references: {},
          catalogErrors: [],
          resolved: { state: { name: null }, status: 'off', source: 'none', editable: true },
        })
      return new Promise((resolve) => {
        finishRead = resolve
      })
    }
    const read = store.refresh()
    assert.equal(
      await store.execute({
        type: 'whitelist',
        revision: 'initial',
        routes: [],
      }),
      true,
    )
    finishRead!(
      Response.json({
        config: emptyConfig(),
        routes: [],
        references: {},
        catalogErrors: [],
        resolved: { state: { name: null }, status: 'off', source: 'none', editable: true },
      }),
    )
    await read
    assert.equal(store.getState().data?.config.revision, 'updated')
    const pending = store.refresh()
    store.dispose()
    assert.equal(signal?.aborted, true)
    finishRead!(
      Response.json({
        config: emptyConfig(),
        routes: [],
        references: {},
        catalogErrors: [],
        resolved: { state: { name: null }, status: 'off', source: 'none', editable: true },
      }),
    )
    await pending
    assert.equal(store.getState().data?.config.revision, 'updated')
  } finally {
    store.dispose()
    globalThis.fetch = original
  }
})

test('破甲组件只识别自己的结构化拒绝，不处理选模目录文本或通信错误', () => {
  assert.equal(isInjectSelectionError({ code: INJECT_SELECTION_ERROR }), true)
  assert.equal(isInjectSelectionError(`${INJECT_SELECTION_ERROR}: rejected`), false)
  assert.equal(isInjectSelectionError('network error'), false)
  assert.equal(isInjectSelectionError({ code: 'session/writer-held' }), false)
  assert.equal(isInjectSelectionError(`prefix ${INJECT_SELECTION_ERROR}: rejected`), false)
})

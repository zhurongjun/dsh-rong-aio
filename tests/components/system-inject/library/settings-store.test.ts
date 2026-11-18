/** 验证设置范围隔离、保存失败和过期读取。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInjectStore } from '../../../../src/components/system-inject/client/store.ts'

/** 为设置接口提供最小有效空配置；每次返回新对象，避免测试互相共享可变状态。 */
const emptyConfig = () => ({
  revision: 'initial',
  templates: [],
  workspace: '',
  paths: {},
  errors: [],
  whitelist: [],
})

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

test('前端读取失败不保留成功标记，保存失败保留已知内容且不宣称已生效', async () => {
  const original = globalThis.fetch
  const store = createInjectStore()
  const state = {
    config: emptyConfig(),
    routes: [],
    references: {},
    catalogErrors: [],
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
      }),
    )
    await pending
    assert.equal(store.getState().data?.config.revision, 'updated')
  } finally {
    store.dispose()
    globalThis.fetch = original
  }
})

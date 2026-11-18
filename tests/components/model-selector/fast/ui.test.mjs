/** Fast 菜单、会话提示与异步写入的 DOM 交互。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot, ModelSelector, models, levels } from '../helpers/dom.mjs'

test('Fast 同路由刷新和写入保留确认值，只阻止速度控件，不联动禁用 Reset', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', (_url, init) => {
    const request = Promise.withResolvers()
    requests.push({ ...request, method: init.method ?? 'GET' })
    return request.promise
  })
  const reply = async (index, ok = true) =>
    act(async () =>
      requests[index].resolve(
        ok
          ? Response.json({ mode: 'fast', modes: ['standard', 'fast'] })
          : Response.json({ error: '速度拒绝' }, { status: 409 }),
      ),
    )
  const state = {
    current: { provider: 'p', model: 'first', reasoningEffort: 'high' },
    groups: [{ id: 'p', name: 'Provider', models }],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () =>
      root.render(
        React.createElement(ModelSelector, {
          sessionId: 'speed-refresh',
          available: true,
          locked: false,
          directory: { getSnapshot: () => state, subscribe: () => () => {} },
          load() {},
          select() {},
        }),
      ),
    )
    await reply(0)
    await act(async () => document.querySelector('.rong-model-trigger').click())
    const fast = document.querySelector('.rong-fast')
    const reset = document.querySelector('[aria-label="重置当前模型的推理强度"]')
    const assertWaiting = () => {
      assert.equal(fast.disabled, false)
      assert.equal(fast.getAttribute('aria-busy'), 'true')
      assert.equal(fast.querySelector('svg').getAttribute('fill'), 'currentColor')
      assert.equal(reset.disabled, false)
      assert.equal(reset.getAttribute('aria-disabled'), null)
      assert.equal(document.querySelector('[role="slider"]').getAttribute('aria-disabled'), 'false')
    }
    assertWaiting()
    await act(async () => fast.click())
    assert.equal(document.querySelector('[role="menu"]'), null)
    assert.equal(requests.length, 2)
    await reply(1)
    await act(async () => fast.click())
    await act(async () => document.querySelector('[role="menuitemradio"]').click())
    assert.equal(requests[2].method, 'POST')
    assertWaiting()
    assert.equal(document.activeElement, fast)
    await reply(2, false)
    assert.equal(fast.getAttribute('aria-label'), '速度：快速')
    assert.equal(fast.getAttribute('aria-busy'), null)
    assert.equal(document.querySelectorAll('[data-test-toast]').length, 1)
  } finally {
    await act(async () => root.unmount())
  }
})

test('Fast 菜单：按支持档位显示、键盘选择、实心状态、写入失败不冒充成功', async () => {
  let mode = 'standard'
  let fail = false
  const writes = []
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'POST') {
      writes.push(JSON.parse(init.body))
      if (fail) return Response.json({ error: '速度保存失败' }, { status: 503 })
      mode = JSON.parse(init.body).mode
    }
    return Response.json({ mode, modes: ['standard', 'fast', 'ultrafast'] })
  }
  const state = {
    current: { provider: 'p', model: 'gpt-6-astra', reasoningEffort: 'high' },
    groups: [
      {
        id: 'p',
        name: 'Provider',
        models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra', reasoning: { efforts: levels } }],
      },
    ],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const root = createRoot(document.getElementById('root'))
  await act(async () =>
    root.render(
      React.createElement(ModelSelector, {
        sessionId: 'speed-test',
        available: true,
        locked: false,
        directory: { getSnapshot: () => state, subscribe: () => () => {} },
        load() {},
        select() {},
      }),
    ),
  )

  const click = async (element) =>
    act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  await click(document.querySelector('.rong-model-trigger'))
  const fast = document.querySelector('.rong-fast')
  assert.equal(fast.disabled, false)
  assert.equal(fast.querySelector('svg').getAttribute('fill'), 'none')
  await click(fast)
  assert.equal(document.activeElement.getAttribute('aria-checked'), 'true')
  await act(async () =>
    fast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  assert.equal(document.querySelector('[role="menu"]'), null)
  assert.ok(document.querySelector('[role="dialog"]'))
  await click(fast)
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitemradio"]')].map((item) => item.textContent),
    ['标准', '快速', '超快'],
  )
  await act(async () =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    ),
  )
  assert.equal(document.activeElement.textContent, '超快')
  await click(document.activeElement)
  assert.equal(writes[0].mode, 'ultrafast')
  assert.ok(document.querySelector('.rong-trigger-fast'))
  assert.match(document.querySelector('.rong-model-trigger').getAttribute('aria-label'), /超快模式/)
  assert.equal(fast.querySelector('svg').getAttribute('fill'), 'currentColor')
  fail = true
  await click(fast)
  await click(document.querySelector('[role="menuitemradio"]'))
  assert.match(document.querySelector('[data-test-toast]').textContent, /速度保存失败/)
  assert.equal(fast.getAttribute('aria-label'), '速度：超快')
  assert.ok(document.querySelector('.rong-trigger-fast'))
  fail = false
  await click(fast)
  await click(document.querySelector('[role="menuitemradio"]'))
  assert.equal(document.querySelector('.rong-trigger-fast'), null)
  await act(async () => root.unmount())
  assert.equal(document.querySelector('[role="menu"]'), null)
})

test('输入框 Fast 提示：不打开弹层也读取持久化状态，切换会话/模型不串状态，忽略旧请求', async () => {
  let finishOldRead
  globalThis.fetch = async (url) => {
    const query = new URL(url, 'http://localhost').searchParams
    if (query.get('provider') === 'slow') {
      return new Promise((resolve) => {
        finishOldRead = () => resolve(Response.json({ mode: 'fast', modes: ['standard', 'fast'] }))
      })
    }
    const supported = query.get('model') === 'gpt-6-astra'
    return Response.json({
      mode: supported && query.get('sessionId') === 'active' ? 'fast' : 'standard',
      modes: supported ? ['standard', 'fast'] : [],
    })
  }
  let state = {
    current: { provider: 'p', model: 'gpt-6-astra', reasoningEffort: 'high' },
    groups: [
      {
        id: 'p',
        name: 'Provider',
        models: [
          { id: 'gpt-6-astra', name: 'GPT-6 Astra', reasoning: { efforts: levels } },
          { id: 'plain', name: 'Plain' },
        ],
      },
    ],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const subscribers = new Set()
  const props = {
    sessionId: 'active',
    available: true,
    locked: false,
    directory: {
      getSnapshot: () => state,
      subscribe: (fn) => {
        subscribers.add(fn)
        return () => subscribers.delete(fn)
      },
    },
    load() {},
    select() {},
  }
  const root = createRoot(document.getElementById('root'))

  const change = async (provider, model) =>
    act(async () => {
      state = { ...state, current: { provider, model, reasoningEffort: 'high' } }
      for (const notify of subscribers) notify()
    })

  await act(async () => root.render(React.createElement(ModelSelector, props)))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(
    document.querySelector('.rong-trigger-fast svg').getAttribute('fill'),
    'currentColor',
  )
  await change('slow', 'gpt-6-astra')
  assert.equal(document.querySelector('.rong-trigger-fast'), null)
  await change('p', 'plain')
  await act(async () => finishOldRead())
  assert.equal(document.querySelector('.rong-trigger-fast'), null)
  await change('p', 'gpt-6-astra')
  assert.ok(document.querySelector('.rong-trigger-fast'))
  await act(async () =>
    root.render(React.createElement(ModelSelector, { ...props, sessionId: 'other' })),
  )
  assert.equal(document.querySelector('.rong-trigger-fast'), null)
  await act(async () => root.unmount())
})

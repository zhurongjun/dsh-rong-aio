/** 模型选择器 DOM 回归：指针/键盘、退场时序、焦点、Fast 提示及错误呈现。宿主接口用可控替身驱动。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost',
})

for (const name of [
  'window',
  'document',
  'HTMLElement',
  'Element',
  'Node',
  'MouseEvent',
  'KeyboardEvent',
])
  globalThis[name] = dom.window[name]

globalThis.fetch = async () => Response.json({ mode: 'standard', modes: [] })

globalThis.IS_REACT_ACT_ENVIRONMENT = true

globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)

globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)

window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })

HTMLElement.prototype.setPointerCapture = () => {}

HTMLElement.prototype.releasePointerCapture = () => {}

HTMLElement.prototype.scrollIntoView = () => {}

globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}

const { createRoot } = await import('react-dom/client')

await mkdir('agent_temp/tests', { recursive: true })

// 只替换 DSH 的视觉原子；被测组件、状态逻辑、React 与事件处理均使用实际实现。
await build({
  entryPoints: ['src/components/model-selector/client/model-selector/ModelSelector.tsx'],
  outfile: 'agent_temp/tests/selector.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom'],
  plugins: [
    {
      name: 'dsh-test-primitives',
      setup(build) {
        build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
          path: 'primitives',
          namespace: 'fixture',
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'js',
          contents: `
      import React from 'react';
      export const MenuSurface = React.forwardRef(({compact: _compact, ...props}, ref) => React.createElement('div', {...props, ref}));
      export const Toast = ({text, onDone}) => React.createElement('div', {'data-test-toast': '', role: 'status'}, text, React.createElement('button', {'data-test-dismiss': '', onClick: onDone}, 'dismiss'));
      export const isBehindModal = (anchor) => {
        const modal = document.querySelector('[data-test-modal]');
        return !!anchor && !!modal && !modal.contains(anchor);
      };
      const Icon = () => null;
      export { Icon as IconCheckOutlineRegular, Icon as IconChevronDownOutlineRegular, Icon as IconChevronLeftOutlineRegular, Icon as IconChevronRightOutlineRegular, Icon as IconDataOutlineRegular, Icon as IconRefreshOutlineRegular, Icon as IconSearchOutlineRegular, Icon as IconWarningOutlineRegular };
    `,
        }))
      },
    },
  ],
})

const { ModelSelector } = await import('../agent_temp/tests/selector.mjs')

const levels = ['off', 'low', 'medium', 'high', 'max'].map((id) => ({ id, name: id }))

const models = [
  { id: 'first', name: 'First', reasoning: { efforts: levels } },
  { id: 'second', name: 'Second', reasoning: { efforts: levels, defaultEffort: 'high' } },
  { id: 'plain', name: 'Plain' },
]

test('原生模态窗接管焦点时立即移除模型浮层，不把退出动画叠在模态窗上', async () => {
  const state = {
    current: { provider: 'p', model: 'first' },
    groups: [{ id: 'p', name: 'Provider', models }],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const root = createRoot(document.getElementById('root'))
  const modal = document.createElement('div')
  modal.dataset.testModal = ''
  const button = document.createElement('button')
  button.textContent = '知道了'
  modal.append(button)
  const originalMatchMedia = window.matchMedia
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  try {
    await act(async () =>
      root.render(
        React.createElement(ModelSelector, {
          sessionId: 'modal-test',
          available: true,
          locked: false,
          directory: { getSnapshot: () => state, subscribe: () => () => {} },
          load() {},
          select() {},
        }),
      ),
    )
    await act(async () => document.querySelector('.rong-model-trigger').click())
    assert.ok(document.querySelector('.rong-model-popover'))
    await act(async () => {
      document.body.append(modal)
      button.focus()
    })
    assert.equal(document.querySelector('.rong-model-popover'), null)
    assert.equal(document.activeElement, button)
  } finally {
    modal.remove()
    await act(async () => root.unmount())
    window.matchMedia = originalMatchMedia
  }
})

test('通用选模拒绝只显示 toast，菜单开关不改变原模型、不创建 Modal 或抢焦点', async (t) => {
  for (const closeFirst of [false, true]) {
    await t.test(closeFirst ? '菜单先关闭' : '菜单保持打开', async () => {
      let state = {
        current: { provider: 'p', model: 'first' },
        groups: [{ id: 'p', name: 'Provider', models }],
        failures: [],
        pending: null,
        status: 'ready',
        error: null,
      }
      const subscribers = new Set()

      const update = (patch) => {
        state = { ...state, ...patch }
        for (const fn of subscribers) fn()
      }

      const result = Promise.withResolvers()
      const root = createRoot(document.getElementById('root'))
      const outside = document.createElement('div')
      const button = document.createElement('button')
      outside.append(button)

      const fail = async () => {
        update({ pending: null, status: 'error', error: 'fixture/rejected: 保存被拒绝' })
        result.resolve({ ok: false, error: { code: 'fixture/rejected', message: '保存被拒绝' } })
      }

      document.body.append(outside)

      const closeMenu = () => {
        document.querySelector('.rong-model-trigger').click()
        button.focus()
      }

      try {
        await act(async () =>
          root.render(
            React.createElement(ModelSelector, {
              sessionId: 'generic-rejection',
              available: true,
              locked: false,
              directory: {
                getSnapshot: () => state,
                subscribe: (fn) => {
                  subscribers.add(fn)
                  return () => subscribers.delete(fn)
                },
              },
              load: () => update({ error: null, status: 'ready' }),
              select: (selection) => {
                update({ pending: selection })
                return result.promise
              },
            }),
          ),
        )
        await act(async () => document.querySelector('.rong-model-trigger').click())
        await act(async () => document.querySelector('.rong-model-heading').click())
        await act(async () =>
          [...document.querySelectorAll('[role="option"]')]
            .find((row) => row.textContent === 'Second')
            .click(),
        )
        if (closeFirst) await act(closeMenu)
        const focused = document.activeElement
        await act(fail)
        assert.equal(state.current.model, 'first')
        assert.match(document.querySelector('.rong-model-trigger').textContent, /First/)
        assert.equal(document.querySelector('.rong-error'), null)
        assert.equal(document.querySelectorAll('[data-test-toast]').length, 1)
        assert.match(document.querySelector('[data-test-toast]').textContent, /保存被拒绝/)
        assert.equal(document.activeElement, focused)
        await act(async () => document.querySelector('[data-test-dismiss]').click())
        assert.equal(document.querySelector('[data-test-toast]'), null)
        if (!closeFirst) await act(closeMenu)
        outside.remove()
        await act(async () => document.querySelector('.rong-model-trigger').click())
        assert.ok(document.querySelector('.rong-model-popover'))
        assert.equal(document.querySelector('[role="alert"]'), null)
      } finally {
        outside.remove()
        await act(async () => root.unmount())
      }
    })
  }
})

test('实际组件：拖动只在释放时保存、取消不保存、失败回退、键盘与模型切换、Fast 禁用', async () => {
  let state = {
    current: { provider: 'p', model: 'first', reasoningEffort: 'medium' },
    groups: [{ id: 'p', name: 'Provider', models }],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const subscribers = new Set()
  const calls = []
  let fail = false

  const update = (patch) => {
    state = { ...state, ...patch }
    for (const fn of subscribers) fn()
  }

  const props = {
    sessionId: 'test',
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
    async select(selection) {
      calls.push(selection)
      update({ pending: selection })
      await Promise.resolve()
      update({ pending: null, ...(fail ? {} : { current: selection }) })
      return fail ? { ok: false, error: { message: '测试保存失败' } } : { ok: true }
    },
  }
  const root = createRoot(document.getElementById('root'))

  const click = async (element) => {
    await act(async () => element.click())
  }

  const key = async (element, key) => {
    await act(async () =>
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
    )
  }

  const pointer = async (element, type, x) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    await act(async () => element.dispatchEvent(event))
  }

  await act(async () => root.render(React.createElement(ModelSelector, props)))
  await click(document.querySelector('.rong-model-trigger'))
  assert.equal(document.querySelector('.rong-fast').disabled, true)
  assert.equal(document.querySelector('.rong-fast svg').getAttribute('fill'), 'none')

  // 已经过的圆点保留布局占位但隐藏，只显示圆钮右侧的未经过档位。
  assert.equal(document.querySelectorAll('.rong-effort-ticks i').length, 5)
  assert.equal(document.querySelectorAll('.rong-effort-ticks i:not([data-passed])').length, 2)
  let slider = document.querySelector('[role="slider"]')
  slider.getBoundingClientRect = () => ({ left: 0, width: 260 })
  await pointer(slider, 'pointerdown', 245)
  assert.equal(calls.length, 0)
  assert.equal(slider.getAttribute('aria-valuetext'), 'max')
  await pointer(slider, 'pointerup', 245)
  assert.equal(calls.length, 1)
  assert.equal(state.current.reasoningEffort, 'max')
  await pointer(slider, 'pointerdown', 15)
  await pointer(slider, 'pointercancel', 15)
  assert.equal(calls.length, 1)
  assert.equal(slider.getAttribute('aria-valuetext'), 'max')
  await key(slider, 'Home')
  assert.equal(state.current.reasoningEffort, 'off')
  fail = true
  await key(slider, 'End')
  assert.equal(state.current.reasoningEffort, 'off')
  assert.equal(slider.getAttribute('aria-valuetext'), 'off')
  assert.match(document.querySelector('[data-test-toast]').textContent, /测试保存失败/)
  assert.equal(document.querySelector('.rong-error'), null)
  fail = false
  await click(document.querySelector('.rong-model-heading'))
  const search = document.querySelector('[role="combobox"]')
  assert.equal(document.activeElement, search)
  await key(search, 'ArrowDown')
  assert.equal(document.activeElement, search)
  assert.equal(
    document.getElementById(search.getAttribute('aria-activedescendant')).textContent,
    'Second',
  )
  await key(search, 'Enter')
  assert.equal(state.current.reasoningEffort, 'high')
  assert.equal(document.querySelector('[role="slider"]').getAttribute('aria-valuetext'), 'high')
  assert.equal(document.querySelectorAll('.rong-effort-ticks i:not([data-passed])').length, 1)
  await click(document.querySelector('.rong-model-heading'))
  await click(
    [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === 'Plain'),
  )
  assert.equal('reasoningEffort' in state.current, false)
  assert.equal(document.querySelector('[role="slider"]'), null)
  await act(async () => root.unmount())
  assert.equal(document.querySelector('[role="dialog"]'), null)
})

test('档位提交等待宿主时保留预览；失焦不回跳、成功平滑交接、拒绝才回退', async (t) => {
  let speedReads = 0
  let modelReads = 0
  t.mock.method(globalThis, 'fetch', async () => {
    speedReads++
    return Response.json({ mode: 'fast', modes: ['standard', 'fast'] })
  })
  let time = 0
  let sequence = 0
  const frames = new Map()
  t.mock.method(globalThis.performance, 'now', () => time)
  t.mock.method(globalThis, 'requestAnimationFrame', (callback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  t.mock.method(globalThis, 'cancelAnimationFrame', (id) => frames.delete(id))
  let state = {
    current: { provider: 'p', model: 'first', reasoningEffort: 'medium' },
    groups: [{ id: 'p', name: 'Provider', models }],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const subscribers = new Set()
  const requests = []
  const update = (patch) => {
    state = { ...state, ...patch }
    for (const notify of subscribers) notify()
  }
  const root = createRoot(document.getElementById('root'))
  const pointer = async (slider, type, x) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    await act(async () => slider.dispatchEvent(event))
  }
  const tick = () => {
    time += 1000 / 60
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(time)
  }
  try {
    await act(async () =>
      root.render(
        React.createElement(ModelSelector, {
          sessionId: 'pending-effort',
          available: true,
          locked: false,
          directory: {
            getSnapshot: () => state,
            subscribe: (notify) => {
              subscribers.add(notify)
              return () => subscribers.delete(notify)
            },
          },
          load() {
            modelReads++
          },
          select(selection) {
            const request = Promise.withResolvers()
            requests.push({ ...request, selection })
            update({ pending: selection })
            return request.promise
          },
        }),
      ),
    )
    await act(async () => document.querySelector('.rong-model-trigger').click())
    const slider = document.querySelector('[role="slider"]')
    const fast = document.querySelector('.rong-fast')
    const reset = document.querySelector('[aria-label="重置当前模型的推理强度"]')
    const readsBeforeSelection = speedReads
    slider.getBoundingClientRect = () => ({ left: 0, width: 260 })
    await pointer(slider, 'pointerdown', 245)
    for (let frame = 0; frame < 30; frame++) tick()
    const stars = [...slider.querySelectorAll('.rong-effort-star')]
    assert.ok(stars.length > 0)
    await pointer(slider, 'pointerup', 245)
    await act(async () => window.dispatchEvent(new window.Event('blur')))
    assert.equal(requests.length, 1)
    assert.equal(state.current.reasoningEffort, 'medium', '预览不能提前改写宿主确认值')
    assert.equal(slider.getAttribute('aria-valuetext'), 'max')
    assert.equal(slider.getAttribute('aria-busy'), 'true')
    assert.equal(document.querySelector('.rong-effort-title').textContent, 'max')
    for (const button of [fast, reset]) {
      assert.equal(button.disabled, false, '保存不进入真正不可用的 disabled 样式')
      assert.equal(button.getAttribute('aria-disabled'), 'true')
      assert.equal(button.getAttribute('aria-busy'), 'true')
      await act(async () => button.click())
    }
    await act(async () =>
      fast.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    )
    assert.equal(requests.length, 1, '忙碌保护仍阻止重复提交')
    assert.equal(document.querySelector('[role="menu"]'), null)
    assert.equal(fast.querySelector('svg').getAttribute('fill'), 'currentColor')
    for (let frame = 0; frame < 10; frame++) {
      tick()
      assert.equal(slider.style.getPropertyValue('--rong-position'), '1', '等待中不能退回旧档')
    }
    assert.deepEqual([...slider.querySelectorAll('.rong-effort-star')], stars)
    await act(async () => {
      update({ current: requests[0].selection, pending: null })
      requests[0].resolve({ ok: true })
    })
    assert.equal(slider.getAttribute('aria-valuetext'), 'max')
    assert.equal(slider.getAttribute('aria-busy'), null)
    assert.equal(document.querySelector('[role="slider"]'), slider)
    assert.equal(fast.getAttribute('aria-busy'), null)
    assert.equal(reset.getAttribute('aria-disabled'), null)
    assert.equal(speedReads, readsBeforeSelection, 'effort 保存不触发速度重新读取')
    await act(async () =>
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })),
    )
    assert.equal(slider.getAttribute('aria-valuetext'), 'off', '键盘提交同样保留待确认预览')
    assert.equal(state.current.reasoningEffort, 'max')
    await act(async () => {
      update({ pending: null })
      requests[1].resolve({ ok: false, error: { message: '拒绝档位修改' } })
    })
    assert.equal(slider.getAttribute('aria-valuetext'), 'max')
    assert.equal(document.querySelector('.rong-effort-title').textContent, 'max')
    assert.equal(document.querySelectorAll('[data-test-toast]').length, 1)
    await act(async () => {
      reset.focus()
      reset.click()
    })
    assert.equal(requests[2].selection.reasoningEffort, 'medium')
    assert.equal(slider.getAttribute('aria-valuetext'), 'medium', 'Reset 与滑杆共用待确认投影')
    assert.equal(document.querySelector('.rong-effort-title').textContent, 'medium')
    assert.equal(document.activeElement, reset, 'Reset 保存期间保留焦点')
    await act(async () => document.querySelector('.rong-model-trigger').click())
    await act(async () => document.querySelector('.rong-model-trigger').click())
    assert.equal(modelReads, 1, '保存期间重开不额外加载目录或改写操作错误的归属')
    assert.equal(
      document.querySelector('[role="slider"]').getAttribute('aria-valuetext'),
      'medium',
      '重开面板仍显示同一操作',
    )
    await act(async () => {
      update({ current: requests[2].selection, pending: null })
      requests[2].resolve({ ok: true })
    })
    assert.equal(document.querySelector('[role="slider"]').getAttribute('aria-valuetext'), 'medium')
  } finally {
    await act(async () => root.unmount())
  }
  assert.equal(frames.size, 0)
})

test('外部 pending 不冒充已选档位；切换路由与会话隔离预览和迟到拒绝', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ mode: 'fast', modes: ['standard', 'fast'] }),
  )
  let state = {
    current: { provider: 'p', model: 'first', reasoningEffort: 'medium' },
    groups: [{ id: 'p', name: 'Provider', models }],
    failures: [],
    pending: null,
    status: 'ready',
    error: null,
  }
  const subscribers = new Set()
  const update = (patch) => {
    state = { ...state, ...patch }
    for (const notify of subscribers) notify()
  }
  const request = Promise.withResolvers()
  let selections = 0
  const props = {
    sessionId: 'old',
    available: true,
    locked: false,
    directory: {
      getSnapshot: () => state,
      subscribe: (notify) => {
        subscribers.add(notify)
        return () => subscribers.delete(notify)
      },
    },
    load() {},
    select(selection) {
      selections++
      update({ pending: selection })
      return request.promise
    },
  }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(ModelSelector, props)))
    await act(async () => document.querySelector('.rong-model-trigger').click())
    let slider = document.querySelector('[role="slider"]')
    await act(async () =>
      update({ pending: { provider: 'p', model: 'second', reasoningEffort: 'high' } }),
    )
    assert.equal(slider.getAttribute('aria-valuetext'), 'medium')
    assert.match(document.querySelector('.rong-model-trigger').textContent, /First/)
    await act(async () =>
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
    )
    assert.equal(selections, 0)
    await act(async () => update({ pending: null }))
    slider.getBoundingClientRect = () => ({ left: 0, width: 260 })
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 245, button: 0 })
    Object.defineProperty(down, 'pointerId', { value: 1 })
    await act(async () => slider.dispatchEvent(down))
    assert.equal(slider.getAttribute('aria-valuetext'), 'max')
    await act(async () =>
      update({ current: { provider: 'p', model: 'second', reasoningEffort: 'low' } }),
    )
    slider = document.querySelector('[role="slider"]')
    assert.equal(slider.getAttribute('aria-valuetext'), 'low')
    assert.equal(document.querySelector('.rong-effort-title').textContent, 'low')
    await act(async () =>
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
    )
    assert.equal(selections, 1)
    await act(async () => {
      update({ pending: null })
      root.render(React.createElement(ModelSelector, { ...props, sessionId: 'new' }))
    })
    await act(async () => document.querySelector('.rong-model-trigger').click())
    await act(async () => request.resolve({ ok: false, error: { message: '旧会话拒绝' } }))
    assert.equal(document.querySelector('[data-test-toast]'), null)
    assert.equal(document.querySelector('[role="slider"]').getAttribute('aria-valuetext'), 'low')
    assert.equal(document.querySelector('.rong-fast').getAttribute('aria-busy'), null)
  } finally {
    await act(async () => root.unmount())
  }
})

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
    assert.equal(requests[2].method, 'PUT')
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
    if (init.method === 'PUT') {
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

test('系统减少动态效果开启时仍完成主弹层与 Fast 退场，快速重开保留同一面板', async () => {
  const originalMatchMedia = window.matchMedia
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  globalThis.fetch = async () => Response.json({ mode: 'standard', modes: ['standard', 'fast'] })
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

  const click = async (element) => act(async () => element.click())

  const finish = async (element) =>
    act(async () => {
      const event = new window.Event('transitionend', { bubbles: true })
      Object.defineProperty(event, 'propertyName', { value: 'transform' })
      element.dispatchEvent(event)
    })

  try {
    await act(async () =>
      root.render(
        React.createElement(ModelSelector, {
          available: true,
          locked: false,
          sessionId: 'menu-motion',
          directory: { getSnapshot: () => state, subscribe: () => () => {} },
          load() {},
          select() {},
        }),
      ),
    )
    await click(document.querySelector('.rong-model-trigger'))
    const fast = document.querySelector('.rong-fast')
    await click(fast)
    const menu = document.querySelector('[data-rong-speed-menu]')
    assert.equal(document.activeElement.getAttribute('aria-checked'), 'true')
    await click(fast)
    assert.equal(menu.dataset.open, 'false')
    assert.equal(menu.getAttribute('aria-hidden'), 'true')
    assert.equal(document.querySelector('[role="menu"]'), null)
    assert.ok([...menu.querySelectorAll('button')].every((item) => item.disabled))
    await click(fast)
    assert.equal(document.querySelector('[role="menu"]'), menu)
    assert.equal(menu.dataset.open, 'true')
    await finish(menu) // 上一次关闭的迟到事件不能移除重新打开的面板。
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.equal(document.querySelector('[role="menu"]'), menu)
    await click(fast)
    await finish(menu)
    assert.equal(document.querySelector('[data-rong-speed-menu]'), null)
    await click(fast)
    await click(fast)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.equal(document.querySelector('[data-rong-speed-menu]'), null)

    const trigger = document.querySelector('.rong-model-trigger')
    const popover = document.querySelector('.rong-model-popover')
    await click(trigger)
    assert.equal(popover.dataset.open, 'false')
    assert.equal(popover.getAttribute('aria-hidden'), 'true')
    await finish(popover.querySelector('.rong-model-content'))
    assert.equal(document.querySelector('.rong-model-popover'), popover, '忽略子层过渡事件')
    await click(trigger)
    await finish(popover)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.equal(document.querySelector('.rong-model-popover'), popover, '重开取消旧清理')
    assert.equal(popover.dataset.open, 'true')
    await click(trigger)
    await finish(popover)
    assert.equal(document.querySelector('.rong-model-popover'), null)
    await click(trigger)
    await click(trigger)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.equal(document.querySelector('.rong-model-popover'), null, '没有结束事件也会清理')
  } finally {
    await act(async () => root.unmount())
    window.matchMedia = originalMatchMedia
  }
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

test('系统减少动态效果开启时滑块与粒子仍连续绘制；目录订阅稳定、卸载取消动画', async (t) => {
  const { advanceMotion } = await import('../src/components/model-selector/shared/slider-motion.ts')
  const { particlesFor, energyFor } =
    await import('../src/components/model-selector/shared/particle-motion.ts')
  let time = 0
  let sequence = 0
  let commits = 0
  let subscriptions = 0
  let activeSubscriptions = 0
  const frames = new Map()
  t.mock.method(globalThis.performance, 'now', () => time)
  t.mock.method(globalThis, 'requestAnimationFrame', (callback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  t.mock.method(globalThis, 'cancelAnimationFrame', (id) => frames.delete(id))
  t.mock.method(window, 'matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }))
  t.mock.method(globalThis, 'fetch', async () => Response.json({ mode: 'standard', modes: [] }))
  const state = {
    current: { provider: 'p', model: 'first', reasoningEffort: 'off' },
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
        React.createElement(
          React.Profiler,
          {
            id: 'selector',
            onRender() {
              commits++
            },
          },
          React.createElement(ModelSelector, {
            sessionId: 'animation',
            available: true,
            locked: false,
            directory: {
              getSnapshot: () => state,
              subscribe() {
                subscriptions++
                activeSubscriptions++
                return () => {
                  activeSubscriptions--
                }
              },
            },
            load() {},
            select() {
              throw new Error('拖动预览不能提交')
            },
          }),
        ),
      ),
    )
    await act(async () => document.querySelector('.rong-model-trigger').click())
    const slider = document.querySelector('[role="slider"]')
    slider.getBoundingClientRect = () => ({ left: 0, width: 260 })
    const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 245, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    await act(async () => slider.dispatchEvent(event))
    const before = commits
    let expected = { position: 0, velocity: 0 }
    for (let frame = 0; frame < 30; frame++) {
      const previous = time
      time += 1000 / 60
      expected = advanceMotion(expected, 1, (time - previous) / 1000)
      const callbacks = [...frames.values()]
      frames.clear()
      await act(async () => callbacks.forEach((callback) => callback(time)))
      assert.equal(Number(slider.style.getPropertyValue('--rong-position')), expected.position)
      assert.equal(
        Number(slider.querySelector('.rong-effort-sparkles').style.opacity),
        0.6 + 0.4 * energyFor(expected.position),
      )
      const stars = [...slider.querySelectorAll('.rong-effort-star')]
      const particles = particlesFor(expected.position)
      assert.equal(stars.length, particles.length)
      particles.forEach((particle, index) => {
        const star = stars[index]
        assert.equal(Number.parseFloat(star.style.top), particle.y)
        assert.equal(star.style.animationDuration, `${particle.duration.toFixed(3)}s`)
        assert.equal(star.style.animationDelay, `${particle.delay.toFixed(3)}s`)
        assert.equal(Number(star.firstChild.style.opacity), particle.brightness)
        assert.equal(star.firstChild.style.transform, `scale(${particle.brightness.toFixed(3)})`)
      })
      const ticks = [...slider.querySelectorAll('.rong-effort-ticks i')]
      ticks.forEach((tick, index) =>
        assert.equal(tick.hasAttribute('data-passed'), index / 4 <= expected.position),
      )
    }
    assert.equal(expected.position, 1)
    assert.equal(commits, before, 'RAF 不应触发 React 提交')
    assert.equal(subscriptions, 1)
    assert.equal(Object.isFrozen(state.groups), false, '不能冻结 DSH 目录')
    assert.equal(Object.isFrozen(models[0]), false)
    await act(async () => window.dispatchEvent(new window.Event('blur')))
    assert.ok(frames.size > 0, '取消手势启动回退动画')
  } finally {
    await act(async () => root.unmount())
  }
  assert.equal(frames.size, 0)
  assert.equal(activeSubscriptions, 0)
})

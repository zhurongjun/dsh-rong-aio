/** 模型与档位选择的 DOM 交互、焦点、预览和保存。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot, ModelSelector, models } from '../helpers/dom.mjs'

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

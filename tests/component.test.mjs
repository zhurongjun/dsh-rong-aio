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
      const Icon = () => null;
      export { Icon as IconCheckOutlineRegular, Icon as IconChevronDownOutlineRegular, Icon as IconChevronLeftOutlineRegular, Icon as IconChevronRightOutlineRegular, Icon as IconDataOutlineRegular, Icon as IconRefreshOutlineRegular, Icon as IconSearchOutlineRegular };
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
  assert.match(document.querySelector('[role="alert"]').textContent, /测试保存失败/)
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
  assert.match(document.querySelector('[role="alert"]').textContent, /速度保存失败/)
  assert.equal(fast.getAttribute('aria-label'), '速度：超快')
  assert.ok(document.querySelector('.rong-trigger-fast'))
  fail = false
  await click(fast)
  await click(document.querySelector('[role="menuitemradio"]'))
  assert.equal(document.querySelector('.rong-trigger-fast'), null)
  await act(async () => root.unmount())
  assert.equal(document.querySelector('[role="menu"]'), null)
})

test('主弹层与 Fast 退场：结束后卸载；快速重开保留同一面板并取消旧清理', async () => {
  const originalMatchMedia = window.matchMedia
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
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

test('动画帧直接绘制且不触发 React 提交；目录订阅稳定、卸载取消动画', async (t) => {
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
    matches: false,
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

/** 系统设置、快速开合和卸载时的滑块、粒子与浮层动画。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot, ModelSelector, models, levels } from '../helpers/dom.mjs'

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
    const menu = document.querySelector('[data-rong-option-menu]')
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
    assert.equal(document.querySelector('[data-rong-option-menu]'), null)
    await click(fast)
    await click(fast)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.equal(document.querySelector('[data-rong-option-menu]'), null)

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

test('系统减少动态效果开启时滑块与粒子仍连续绘制；目录订阅稳定、卸载取消动画', async (t) => {
  const { advanceMotion } =
    await import('../../../../src/components/model-selector/shared/slider-motion.ts')
  const { particlesFor, energyFor } =
    await import('../../../../src/components/model-selector/shared/particle-motion.ts')
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

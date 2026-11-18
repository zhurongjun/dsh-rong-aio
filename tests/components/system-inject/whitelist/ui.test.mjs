/** 白名单路由的增删、键盘操作及定位。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import React, { act } from 'react'

import { createRoot, document, dom } from '../helpers/settings-dom.mjs'

await mkdir('agent_temp/tests', { recursive: true })

await build({
  entryPoints: ['src/components/system-inject/client/Whitelist.tsx'],
  outfile: 'agent_temp/tests/inject-whitelist.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom'],
  plugins: [
    {
      name: 'whitelist-primitives',
      setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
          path: 'primitives',
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'tsx',
          contents: `
          import {forwardRef, useLayoutEffect} from 'react'
          export const IconPlusOutlineRegular = () => <svg />
          export const IconSearchOutlineRegular = () => <svg />
          export const IconTrashOutlineRegular = () => <svg />
          export const IconCheckOutlineRegular = () => <svg />
          export const IconChevronLeftOutlineRegular = () => <svg />
          export const Button = forwardRef(({icon, size, variant, ...props}, ref) => <button {...props} ref={ref} />)
          export const Input = forwardRef(({icon, ...props}, ref) => <input {...props} ref={ref} />)
          export const MenuSurface = forwardRef((props, ref) => <div {...props} ref={ref} />)
          export const useDismissOnOutsidePointer = () => {}
          // 仅模拟挂载焦点；原生弹层定位、Tab/Escape 所有权另在实际 DSH 验证。
          export const useModalLayer = (ref, open) => useLayoutEffect(() => {
            if (!open) return
            const previous = document.activeElement
            if (ref.current?.style.visibility !== 'hidden')
              ref.current?.querySelector('[data-modal-autofocus]')?.focus()
            return () => previous?.focus()
          }, [ref, open])
        `,
        }))
      },
    },
  ],
})

const { Whitelist } = await import('../../../../agent_temp/tests/inject-whitelist.mjs')

// jsdom 没有布局，普通业务测试忽略滚动；定位测试显式提供尺寸。
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

test('白名单菜单保留并禁用已添加项，键盘跳过授权项，同名不同路由精确增删', async () => {
  document.body.innerHTML = '<div id="whitelist"></div>'
  const root = createRoot(document.getElementById('whitelist'))
  const routes = [
    { provider: 'p1', model: 'same', providerName: '提供商一', modelName: '同名模型' },
    { provider: 'p1', model: 'next', providerName: '提供商一', modelName: '另一个模型' },
    { provider: 'p2', model: 'same', providerName: '提供商二', modelName: '同名模型' },
  ]
  let whitelist = [
    { provider: 'p1', model: 'same' },
    { provider: 'gone', model: 'old' },
  ]
  let disabled = false
  const operations = []

  const render = () =>
    root.render(
      React.createElement(Whitelist, {
        whitelist,
        routes,
        catalogErrors: [],
        disabled,
        onAdd: (route) => operations.push(['add', route]),
        onRemove: (route) => operations.push(['remove', route]),
      }),
    )

  const addButton = () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '新增')

  const options = () => [...document.querySelectorAll('[role="option"]')]

  const key = (value, composing = false) =>
    document.activeElement.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: value,
        isComposing: composing,
        bubbles: true,
        cancelable: true,
      }),
    )

  try {
    await act(async () => render())
    assert.equal(document.querySelectorAll('.rong-inject-whitelist-card').length, 2)
    assert.ok(document.body.textContent.includes('提供商一'))
    assert.ok(document.body.textContent.includes('old'))
    await act(async () => document.querySelector('.rong-inject-whitelist-remove').click())
    assert.deepEqual(operations.pop(), ['remove', { provider: 'p1', model: 'same' }])

    // 保留原始白名单直到服务端确认，不能由点击乐观删除。
    assert.equal(document.querySelectorAll('.rong-inject-whitelist-card').length, 2)
    await act(async () => {
      addButton().focus()
      addButton().click()
    })
    assert.equal(document.activeElement.getAttribute('role'), 'combobox')
    assert.deepEqual(
      options().map((option) => option.disabled),
      [true, false, false],
    )
    await act(async () => options()[0].click())
    assert.deepEqual(operations, [])
    await act(async () => key('Enter', true))
    assert.deepEqual(operations, [])
    await act(async () => key('ArrowDown'))
    assert.equal(document.activeElement.getAttribute('aria-activedescendant'), options()[2].id)
    await act(async () => key('Enter'))
    assert.deepEqual(operations.pop(), ['add', { provider: 'p2', model: 'same' }])
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(document.activeElement, addButton())
    whitelist = [...whitelist, { provider: 'p2', model: 'same' }]
    await act(async () => render())
    await act(async () => addButton().click())
    assert.deepEqual(
      options().map((option) => option.disabled),
      [true, false, true],
    )
    await act(async () => key('ArrowUp'))
    assert.equal(document.activeElement.getAttribute('aria-activedescendant'), options()[1].id)
    await act(async () => document.querySelector('[aria-label="返回模型白名单"]').click())
    disabled = true
    await act(async () => render())
    assert.equal(addButton().disabled, true)
    assert.ok(
      [...document.querySelectorAll('.rong-inject-whitelist-remove')].every(
        (button) => button.disabled,
      ),
    )
  } finally {
    await act(async () => root.unmount())
  }
})

test('白名单定位适配：窄视口向上展开，锚点滚出视口仍可见，卸载断开尺寸观察', async () => {
  const { window } = dom
  document.body.innerHTML = '<div id="position"></div>'
  const root = createRoot(document.getElementById('position'))
  const Observer = globalThis.ResizeObserver
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  let observing = 0
  globalThis.ResizeObserver = class {
    observe() {
      observing++
    }
    disconnect() {
      observing = 0
    }
  }
  window.innerWidth = 320
  window.innerHeight = 450
  try {
    await act(async () =>
      root.render(
        React.createElement(Whitelist, {
          whitelist: [],
          routes: [{ provider: 'p', model: 'm' }],
          catalogErrors: [],
          disabled: false,
          onAdd() {},
          onRemove() {},
        }),
      ),
    )
    const add = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === '新增',
    )
    let rect = { top: 400, bottom: 428, right: 340 }
    add.getBoundingClientRect = () => rect
    await act(async () => add.click())
    const panel = document.querySelector('[role="dialog"]')
    Object.defineProperties(panel, { offsetWidth: { value: 256 }, scrollHeight: { value: 500 } })
    await act(async () => window.dispatchEvent(new dom.window.Event('resize')))
    assert.equal(panel.style.top, '')
    assert.ok(Number.parseFloat(panel.style.bottom) >= 12)
    assert.ok(Number.parseFloat(panel.style.left) + panel.offsetWidth <= window.innerWidth - 12)
    assert.ok(Number.parseFloat(panel.style.maxHeight) <= rect.top - 12)
    rect = { top: -80, bottom: -52, right: 300 }
    await act(async () => window.dispatchEvent(new dom.window.Event('scroll')))
    assert.equal(panel.style.bottom, '')
    assert.equal(panel.style.top, '12px')
    rect = { top: 530, bottom: 558, right: 300 }
    await act(async () => window.dispatchEvent(new dom.window.Event('scroll')))
    assert.equal(panel.style.top, '')
    assert.equal(panel.style.bottom, '12px')
    assert.equal(observing, 2)
  } finally {
    await act(async () => root.unmount())
    assert.equal(observing, 0)
    globalThis.ResizeObserver = Observer
    window.innerWidth = viewport.width
    window.innerHeight = viewport.height
  }
})

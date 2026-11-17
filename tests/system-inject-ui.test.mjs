/** 设置视图 DOM 回归：模板分组、白名单卡片、菜单键盘与定位边界。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const dom = new JSDOM('<!doctype html><html><body></body></html>')

const { document } = dom.window

for (const name of ['window', 'document', 'HTMLElement', 'MutationObserver'])
  globalThis[name] = dom.window[name]

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')

await mkdir('agent_temp/tests', { recursive: true })

globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}

// 隔离宿主弹层实现，只验证业务分组、范围与操作分发；材质和键盘由原生 DSH 验证。
await build({
  entryPoints: ['src/components/system-inject/client/TemplateLibrary.tsx'],
  outfile: 'agent_temp/tests/inject-template-library.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['react'],
  plugins: [
    {
      name: 'library-primitives',
      setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
          path: 'primitives',
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'tsx',
          contents: `
            export const IconChevronDownOutlineRegular = () => <svg />
            export const IconEllipsisOutlineRegular = () => <svg />
            export const Tag = ({children}) => <span>{children}</span>
            export const Button = ({icon, size, ...props}) => <button {...props} />
            export const Menu = ({anchor, open, items, onSelect, className}) =>
              <span className={className}>{anchor}{open && <div role="menu">{items.map(item =>
                <button key={item.id} role="menuitem" onClick={() => onSelect(item.id)}>{item.label}</button>
              )}</div>}</span>
          `,
        }))
      },
    },
  ],
})

const { TemplateLibrary } = await import('../agent_temp/tests/inject-template-library.mjs')

test('模板卡片按入口范围分组，独立折叠、筛选与操作不会跨来源', async () => {
  document.body.innerHTML = '<div id="library"></div>'
  const root = createRoot(document.getElementById('library'))
  const templates = [
    { name: 'global-name', display_name: '全局词', description: '全局简介', scope: 'user' },
    { name: 'project-name', display_name: '工程词', description: '工程简介', scope: 'workspace' },
    { name: 'conflict', display_name: '冲突词', description: '', scope: 'user', conflict: true },
  ].map((prompt) => ({
    body: '正文不应在列表展示',
    revision: 'r1',
    file: `${prompt.scope}/${prompt.name}.md`,
    ...prompt,
  }))
  let view = { query: '', expanded: { user: true, workspace: true } }
  let workspace = '/project'
  let disabled = false
  const operations = []

  const render = () =>
    root.render(
      React.createElement(TemplateLibrary, {
        templates,
        workspace,
        view,
        disabled,
        onViewChange: (next) => {
          view = next
          render()
        },
        onEdit: (prompt) => operations.push(['edit', prompt.file]),
        onExport: (prompt) => operations.push(['export', prompt.file]),
        onDelete: (prompt) => operations.push(['delete', prompt.file]),
      }),
    )

  const buttons = () => [...document.querySelectorAll('button')]

  const group = (index) => document.querySelectorAll('.rong-inject-library-toggle')[index]

  const body = (index) => document.getElementById(group(index).getAttribute('aria-controls'))

  try {
    await act(async () => render())
    assert.equal(document.querySelectorAll('section').length, 2)
    assert.equal(document.querySelectorAll('[aria-label="全局破甲词"] li').length, 2)
    assert.equal(document.querySelectorAll('[aria-label="工程破甲词"] li').length, 1)
    assert.ok(document.body.textContent.includes('名称冲突'))
    assert.ok(!document.body.textContent.includes('正文不应在列表展示'))
    await act(async () => group(0).click())
    assert.equal(body(0).hidden, true)
    assert.equal(body(1).hidden, false)
    await act(async () =>
      buttons()
        .find((button) => button.getAttribute('aria-label') === '编辑工程词（project-name）')
        .click(),
    )
    assert.deepEqual(operations.pop(), ['edit', 'workspace/project-name.md'])
    await act(async () =>
      buttons()
        .find((button) => button.getAttribute('aria-label') === '工程词的操作')
        .click(),
    )
    await act(async () =>
      buttons()
        .find((button) => button.textContent === '导出 Markdown')
        .click(),
    )
    assert.deepEqual(operations.pop(), ['export', 'workspace/project-name.md'])
    assert.equal(document.querySelector('[role="menu"]'), null)
    view = { query: ' PROJECT-NAME ', expanded: { user: true, workspace: true } }
    await act(async () => render())
    assert.equal(document.querySelectorAll('.rong-inject-template-card').length, 1)
    assert.ok(body(0).textContent.includes('没有匹配的破甲词'))
    assert.ok(group(0).textContent.includes('0 / 2'))
    workspace = ''
    view = { query: '', expanded: { user: true, workspace: true } }
    await act(async () => render())
    assert.equal(document.querySelectorAll('section').length, 1)
    assert.ok(!document.body.textContent.includes('工程词'))
    disabled = true
    await act(async () => render())
    assert.ok(
      [...document.querySelectorAll('.rong-inject-template-card button')].every(
        (button) => button.disabled,
      ),
    )
    assert.equal(group(0).disabled, false)
  } finally {
    await act(async () => root.unmount())
  }
})

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

const { Whitelist } = await import('../agent_temp/tests/inject-whitelist.mjs')

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

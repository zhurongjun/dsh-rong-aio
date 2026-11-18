/** 模板卡片按来源分组并分发编辑操作。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import React, { act } from 'react'

import { createRoot, document } from '../helpers/settings-dom.mjs'

await mkdir('agent_temp/tests', { recursive: true })

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

const { TemplateLibrary } = await import('../../../../agent_temp/tests/inject-template-library.mjs')

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

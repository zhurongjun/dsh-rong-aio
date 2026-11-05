/** 输入框集成回归：真实破甲宿主配合客户端入口，验证选择、拒绝通知和资源清理。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { hostFixture } from './helpers/system-inject-host.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})

const { document } = dom.window

for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node'])
  globalThis[name] = dom.window[name]

globalThis.IS_REACT_ACT_ENVIRONMENT = true

globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)

globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)

const { createRoot } = await import('react-dom/client')

await mkdir('agent_temp/tests', { recursive: true })

await build({
  entryPoints: ['src/components/system-inject/client/index.ts'],
  outfile: 'agent_temp/tests/inject-client.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  external: ['react', 'react-dom'],
  plugins: [
    {
      name: 'inject-client-host-ui',
      setup(builder) {
        // 不加载模型选择器；保留破甲入口、Composer、通知 store 与 Dialog 的实际实现。
        builder.onResolve({ filter: /^\.\/Settings\.tsx$/ }, () => ({
          path: 'settings',
          namespace: 'fixture',
        }))
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
          path: 'primitives',
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          loader: 'tsx',
          contents:
            path === 'settings'
              ? 'export const Settings = () => null'
              : `
                import {forwardRef, useLayoutEffect, useRef} from 'react'
                export const Button = forwardRef(({icon, size, variant, ...props}, ref) => <button {...props} ref={ref} />)
                export const Menu = ({anchor, open, children}) => <>{anchor}{open && <div role="menu">{children}</div>}</>
                export const MenuItemButton = ({children, onSelect, disabled}) => <button disabled={disabled} onClick={onSelect}>{children}</button>
                export const Modal = ({open, title, children, className}) => {
                  const ref = useRef(null)
                  useLayoutEffect(() => { if (open) ref.current?.querySelector('button')?.focus() }, [open])
                  return open ? <div role="dialog" aria-label={title} className={className} ref={ref}>{children}</div> : null
                }
                export const Toast = ({text, onDone}) => <div role="status" data-test-toast>{text}<button data-test-dismiss onClick={onDone}>dismiss</button></div>
                export const IconWarningOutlineRegular = () => null
                export const IconChevronDownOutlineRegular = () => null
                export const IconCheckOutlineRegular = () => null
                export const IconCloseOutlineRegular = () => null
                export const IconShieldOutlineRegular = () => null
                export const writeClipboard = async () => {}
              `,
        }))
      },
    },
  ],
})

const client = await import('../agent_temp/tests/inject-client.mjs')

test('仅启用破甲组件：切换破甲只用 toast，选模拒绝交调用者呈现，停用释放护栏', async (t) => {
  const f = await hostFixture(t)
  const cleanups = []
  let registration
  let composer
  let reads = 0
  globalThis.fetch = (url, options) => {
    if (!options?.method) reads++
    return f.endpoint().fetch(new Request(new URL(url, 'http://fixture/'), options))
  }
  client.apply({
    effect: (effect) => cleanups.push(effect()),
    slots: {
      inject: (_slot, register) => register(),
      register: (options, component) => {
        if (options.name === 'conversation.input.left') {
          registration = options
          composer = component
        }
      },
    },
    sessions: { subagentAddress: () => undefined },
    conversation: { blocks: { set() {} } },
  })
  const props = { sessionId: f.agent.id, ...registration.inject(f.agent.id) }
  const root = createRoot(document.getElementById('root'))

  const select = (model) =>
    f.ctx.sessionController.selectModel({
      sessionId: f.agent.id,
      provider: 'fixture',
      model,
    })

  const settled = async (condition) => {
    for (let attempt = 0; attempt < 30 && !condition(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5))
    assert.ok(condition(), '通知确认应及时完成')
  }

  const dialog = () => document.querySelector('[role="dialog"]')

  try {
    await act(async () => root.render(React.createElement(composer, props)))
    await act(async () => props.store.refresh())
    assert.equal(dialog(), null)
    await act(async () => select('denied'))
    assert.equal(f.selection.current.model, 'denied')
    assert.equal(dialog(), null)
    assert.equal((await f.api()).session.error, undefined)

    const choosePrompt = () =>
      props.store.execute({
        type: 'select',
        sessionId: f.agent.id,
        state: { name: f.prompt.name },
      })

    const focused = document.activeElement
    await act(choosePrompt)
    assert.equal(dialog(), null)
    assert.equal(document.querySelectorAll('[data-test-toast]').length, 1)
    assert.match(document.querySelector('[data-test-toast]').textContent, /denied/)
    assert.equal(document.activeElement, focused)
    assert.equal(props.store.getState().data.session.resolved.status, 'off')
    assert.equal(props.store.getState().verified, true)

    // toast 可见期间仍允许重新打开选择菜单；不建立新的焦点层。
    await act(async () => document.querySelector('.rong-inject-trigger').click())
    assert.ok(document.querySelector('[role="menu"]'))
    await act(async () => {
      document.querySelector('[data-test-dismiss]').click()
      await settled(() => !props.store.getState().data?.session?.error)
    })
    assert.equal(document.querySelector('[data-test-toast]'), null)
    await act(choosePrompt)
    assert.equal(document.querySelectorAll('[data-test-toast]').length, 1)
    await act(async () => {
      document.querySelector('[data-test-dismiss]').click()
      await settled(() => !props.store.getState().data?.session?.error)
    })
    await act(async () => select('allowed'))
    await act(choosePrompt)
    const before = f.modelCommits()
    await assert.rejects(select('denied'), /未获破甲模式授权/)
    await act(async () => props.store.refresh())
    assert.equal(f.modelCommits(), before)
    assert.equal(f.selection.current.model, 'allowed')
    assert.equal(props.store.getState().data.session.resolved.status, 'on')
    assert.equal(props.store.getState().data.session.error, undefined)
    assert.equal(dialog(), null)
    assert.equal(
      document.querySelector('[data-test-toast]'),
      null,
      '选模错误由调用者呈现，不重复通知',
    )
    await act(async () => root.unmount())
    for (const cleanup of cleanups) cleanup()
    assert.equal(document.querySelector('[data-plugin="dsh-rong-aio-system-inject"]'), null)
    await f.fiber.dispose()
    const after = reads
    await f.ctx.sessionController.selectModel({
      sessionId: f.agent.id,
      provider: 'fixture',
      model: 'denied',
    })
    assert.equal(f.selection.current.model, 'denied')
    assert.equal(reads, after)
  } finally {
    await act(async () => root.unmount())
    for (const cleanup of cleanups) cleanup()
  }
})

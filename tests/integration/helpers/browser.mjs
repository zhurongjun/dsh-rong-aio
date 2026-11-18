/** 在 JSDOM 中加载宿主发布的客户端工厂，按 DSH 插槽约定挂载 React 视图。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import * as primitives from './primitives.mjs'

export const { window } = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
  pretendToBeVisual: true,
  url: 'http://fixture/',
})
export const { document } = window
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'Element',
  'Node',
  'MouseEvent',
  'KeyboardEvent',
  'MutationObserver',
])
  globalThis[key] = window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.HTMLElement.prototype.setPointerCapture = () => {}
window.HTMLElement.prototype.releasePointerCapture = () => {}
window.HTMLElement.prototype.scrollIntoView = () => {}
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
const { createRoot } = await import('react-dom/client')
const require = createRequire(import.meta.url)

export async function mountClient(host, name, services) {
  const slots = new Map()
  const cleanups = []
  const id = 'dsh-rong-aio-' + name
  let client
  window.__ModuleLoader__ = {
    load(module) {
      if (module.id === id)
        client = module.factory((dep) =>
          dep === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(dep),
        )
    },
  }
  await import(pathToFileURL(host.ctx.clientModules.clientPath(id)).href)
  const context = {
    ...services,
    slots: {
      inject: (_name, register) => register(),
      register: (options, component) => slots.set(options.name, { options, component }),
    },
    effect: (setup) => cleanups.push(setup()),
    inject: (names, callback) => {
      if (names.every((name) => name.split('.').reduce((service, key) => service?.[key], context)))
        callback(context)
    },
  }
  client.apply(context)
  const root = createRoot(document.querySelector('main'))
  host.ctx.effect(() => async () => {
    await act(async () => root.unmount())
    for (const cleanup of cleanups.reverse()) cleanup?.()
    delete window.__ModuleLoader__
  })
  return (name, props = {}) =>
    act(async () => {
      const slot = slots.get(name)
      assert.ok(slot, '未注册插槽 ' + name)
      root.render(
        React.createElement(slot.component, {
          ...slot.options.inject?.(props.sessionId),
          ...props,
        }),
      )
    })
}

export const click = (element) => act(async () => element.click())
export const byText = (selector, text) =>
  [...document.querySelectorAll(selector)].find((el) => el.textContent.trim() === text)
export const key = (element, key) =>
  act(async () =>
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })),
  )

export async function waitFor(condition, description) {
  const deadline = Date.now() + 3000
  while (!condition() && Date.now() < deadline)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  assert.ok(condition(), description)
}

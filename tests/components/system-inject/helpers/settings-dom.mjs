/** 设置视图的 JSDOM 环境，提供挂载节点与尺寸观察替身。 */

import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')

const { document } = dom.window

for (const name of ['window', 'document', 'HTMLElement', 'MutationObserver'])
  globalThis[name] = dom.window[name]

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')

globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}

export { dom, document, createRoot }

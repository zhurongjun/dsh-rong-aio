/** 模型选择器 DOM 夹具：挂载真实组件，以可控的 DSH 视觉组件驱动事件。 */

import { build } from 'esbuild'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { after } from 'node:test'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

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

// 功能测试在独立进程并行执行，各自构建并清理模块。
const directory = await mkdtemp(resolve('agent_temp/tests/selector-dom-'))
after(() => rm(directory, { recursive: true, force: true }))

// 只替换 DSH 的视觉原子；被测组件、状态逻辑、React 与事件处理均使用实际实现。
const buildOptions = {
  entryPoints: ['src/components/model-selector/client/model-selector/ModelSelector.tsx'],
  outfile: join(directory, 'selector.mjs'),
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
      import React, {useLayoutEffect, useRef} from 'react';
      export const MenuSurface = React.forwardRef(({compact: _compact, ...props}, ref) => React.createElement('div', {...props, ref}));
      export const Button = ({variant: _variant, ...props}) => React.createElement('button', props);
      export const Modal = ({open, title, children, footer, onClose}) => {
        const ref = useRef(null);
        useLayoutEffect(() => {
          if (!open) return;
          const previous = document.activeElement;
          ref.current?.querySelector('button')?.focus();
          return () => previous?.focus();
        }, [open]);
        return open ? React.createElement('div', {ref, role:'dialog', 'aria-label':title, 'data-test-modal':'', onKeyDown:e=>{if(e.key==='Escape')onClose()}},children,footer) : null;
      };
      export const Toast = ({text, onDone}) => React.createElement('div', {'data-test-toast': '', role: 'status'}, text, React.createElement('button', {'data-test-dismiss': '', onClick: onDone}, 'dismiss'));
      export const isBehindModal = (anchor) => {
        const modal = document.querySelector('[data-test-modal]');
        return !!anchor && !!modal && !modal.contains(anchor);
      };
      const Icon = () => null;
      export { Icon as IconUsersOutlineRegular, Icon as IconCheckOutlineRegular, Icon as IconChevronDownOutlineRegular, Icon as IconChevronLeftOutlineRegular, Icon as IconChevronRightOutlineRegular, Icon as IconDataOutlineRegular, Icon as IconRefreshOutlineRegular, Icon as IconSearchOutlineRegular, Icon as IconWarningOutlineRegular };
    `,
        }))
      },
    },
  ],
}

await build(buildOptions)

const { ModelSelector } = await import(pathToFileURL(buildOptions.outfile).href)

/** 需要验证原生插槽时构建并加载客户端入口。 */
export async function loadModelClient() {
  const outfile = join(directory, 'model-client.mjs')
  await build({
    ...buildOptions,
    entryPoints: ['src/components/model-selector/client/index.ts'],
    outfile,
    loader: { '.css': 'text' },
  })
  return import(pathToFileURL(outfile).href)
}

const levels = ['off', 'low', 'medium', 'high', 'max'].map((id) => ({ id, name: id }))

const models = [
  { id: 'first', name: 'First', reasoning: { efforts: levels } },
  { id: 'second', name: 'Second', reasoning: { efforts: levels, defaultEffort: 'high' } },
  { id: 'plain', name: 'Plain' },
]

export { createRoot, ModelSelector, models, levels }

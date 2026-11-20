import { always } from '@antithesishq/bombadil'
import { actions, extract, registerCustomAction } from '@antithesishq/bombadil/browser'
import { clicks } from '@antithesishq/bombadil/browser/defaults/actions'
export {
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from '@antithesishq/bombadil/browser/defaults/properties'
import { controls } from './dom.mjs'
import { openSlider, models, speedAndTeam, settings } from './conversation.mjs'
import { workspaces, operations } from './sessions.mjs'

const scenarios = { openSlider, models, speedAndTeam, settings, workspaces, operations }
const names = Object.keys(scenarios)
const run = registerCustomAction('check workflow', async (document, window, name) => {
  try {
    await scenarios[name](controls(document, window))
    await window.fetch('/report', { method: 'POST', body: JSON.stringify({ name }) })
    document.documentElement.dataset.completed = name
    if (name === 'operations') {
      let count = 0
      const observe = (event) => {
        if (!event.isTrusted || ++count < 8) return
        document.removeEventListener('click', observe, true)
        void window.fetch('/report', {
          method: 'POST',
          body: JSON.stringify({ name: 'exploration' }),
        })
      }
      document.addEventListener('click', observe, true)
    }
  } catch (error) {
    document.documentElement.dataset.violation = String(error)
    await window.fetch('/report', {
      method: 'POST',
      body: JSON.stringify({ name, error: String(error) }),
    })
  }
})
const completed = extract(({ document }) => document.documentElement.dataset.completed ?? '')
const ready = extract(({ document }) => !!document.querySelector('nav'))
const error = extract(({ document }) => document.documentElement.dataset.violation ?? '')
export const workflowsSucceed = always(() => error.current === '')
const track = extract(({ document }) => {
  const el = document.querySelector('[role=slider]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    x: r.left + 15,
    y: r.top + r.height / 2,
    end: r.right - 14,
    done: el.getAttribute('aria-valuetext') === 'high',
  }
})
export const checks = actions(() => {
  if (!ready.current || error.current) return ['Wait']
  if (completed.current === 'openSlider' && !track.current?.done) {
    const r = track.current
    return r
      ? [
          {
            MouseDrag: {
              from: { x: r.x, y: r.y },
              to: { x: r.end, y: r.y },
              steps: 8,
              delayMillis: 18,
            },
          },
        ]
      : ['Wait']
  }
  const next = names[names.indexOf(completed.current) + 1]
  return next ? [run(next)] : []
})
// After the mandatory scenarios, vary tab, workspace, row and checkbox interactions.
export const explore = clicks
  .filter((action) => {
    if (typeof action !== 'object' || !('Click' in action)) return false
    const { role, inputType, accessibleName, textContent } = action.Click.fingerprint
    return (
      role === 'tab' ||
      role === 'checkbox' ||
      inputType === 'checkbox' ||
      textContent === '研发' ||
      /^(选择「|全选|已选 )/.test(accessibleName ?? '')
    )
  })
  .when(() => completed.current === 'operations')
const validSelection = extract(({ document }) => {
  const remove = document.querySelector('button[aria-label="删除所选会话"]')
  if (!remove) return true
  const selected = [...document.querySelectorAll('li button[aria-pressed=true]')]
  const occupied = selected.some((button) => button.closest('li').innerText.includes('DSH 占用中'))
  const count = document.querySelector('[role=tabpanel] label')?.textContent
  return !(occupied || count === '全选') || remove.disabled
})
export const deletionRequiresEligibleSelection = always(() => validSelection.current)
const groupsConsistent = extract(({ document }) => {
  const panel = document.querySelector('section[aria-label="会话管理"] [role=tabpanel]')
  if (!panel) return true
  const headers = [...panel.querySelectorAll('button[aria-expanded][aria-controls]')]
  let selectedCount = 0
  for (const header of headers) {
    const list = document.getElementById(header.getAttribute('aria-controls'))
    if (!list || list.hidden !== (header.getAttribute('aria-expanded') === 'false')) return false
    if (list.hidden) continue
    const rows = list.querySelectorAll('button[aria-pressed]')
    const selected = list.querySelectorAll('button[aria-pressed=true]').length
    const toggle = header.parentElement.querySelector('input[type=checkbox]')
    if (
      !toggle ||
      toggle.checked !== (selected === rows.length) ||
      toggle.indeterminate !== (selected > 0 && selected < rows.length)
    )
      return false
    selectedCount += selected
  }
  if (headers.some((h) => h.getAttribute('aria-expanded') === 'false')) return true
  return (
    panel.querySelector('label')?.textContent ===
    (selectedCount ? '已选 ' + selectedCount + ' 项' : '全选')
  )
})
export const workspaceAndToolbarMatchRows = always(() => groupsConsistent.current)
const validRange = extract(({ document }) => {
  const el = document.querySelector('[role=slider]')
  if (!el) return true
  const n = Number(el.getAttribute('aria-valuenow'))
  return (
    n >= Number(el.getAttribute('aria-valuemin')) && n <= Number(el.getAttribute('aria-valuemax'))
  )
})
export const sliderStaysWithinCatalog = always(() => validRange.current)

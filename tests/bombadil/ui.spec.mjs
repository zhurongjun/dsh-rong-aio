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

async function sideChat(u) {
  await u.button('native-loop')
  const editor = () => u.label('侧聊消息')
  const current = () => u.label('当前侧聊')?.textContent
  const tabs = () => u.all('[aria-label=侧聊标签] [role=tab]')
  const menu = () => u.action('侧聊列表')
  const pick = (name) => u.click(() => u.text('[role=menuitem]', name), name)
  const header = await u.until(() => u.label('主会话标题行'), '进入主会话标题行')
  u.check(
    header.contains(u.label('侧聊列表')) &&
      u.label('侧聊列表').compareDocumentPosition(u.label('更多')) & 4,
    '管理入口在标题行更多按钮左侧',
  )
  await u.button('右侧栏开始页')
  await u.click(() => u.one('[data-sidebar-right-guide-entry=rong-side]'), '开始页创建第一个标签')
  await u.until(editor, '出现首条草稿')
  u.check(!!u.text('h2', '侧聊') && !u.label('侧聊历史'), '空白页显示中央说明')
  await u.action('侧聊权限：只读')
  await pick('跟随主会话')
  await u.button('取消')
  u.type(editor(), '第一条侧聊')
  await u.button('输入 /side 并回车')
  await u.until(() => tabs().length === 2 && editor()?.value === '', '第二个标签有独立草稿')
  u.type(editor(), '第二条侧聊')
  await menu()
  await u.until(
    () => u.label('删除 第一条侧聊') && u.label('删除 第二条侧聊'),
    '弹层中列出两个未发送草稿',
  )
  u.type(editor(), '第二条侧聊修改中')
  await u.until(() => u.label('删除 第二条侧聊修改中'), '已展开的列表能跟随草稿首行更新')
  u.type(editor(), '第二条侧聊')
  await u.until(() => u.label('删除 第二条侧聊'), '草稿标题恢复，另一项仍在原位')
  const firstRow = u.text('[role=menuitem]', '第一条侧聊草稿')
  const trash = u.label('删除 第一条侧聊')
  const box = firstRow.getBoundingClientRect()
  const icon = trash.getBoundingClientRect()
  u.check(
    trash.querySelector('svg use')?.getAttribute('href') === '#dsw-icon-trash-outline-regular' &&
      icon.left > box.left &&
      icon.right <= box.right &&
      icon.top >= box.top &&
      icon.bottom <= box.bottom &&
      !u.text('[role=menuitem]', '跟随主会话'),
    '删除图标嵌在对应列表行的右端，权限由侧聊输入框管理',
  )
  await menu()
  await u.action('侧聊权限：只读')
  await pick('跟随主会话')
  await u.click(() => u.text('[role=dialog] button', '跟随主会话'), '确认第二条草稿的权限')
  await u.click(() => tabs()[0], '返回第一个草稿')
  await u.until(() => editor()?.value === '第一条侧聊', '切换标签保留各自的文本')
  u.check(!!u.label('侧聊权限：只读'), '另一份草稿继续使用只读权限')
  const position = (el) => {
    const rect = el.getBoundingClientRect()
    const panel = u.label('侧聊面板').getBoundingClientRect()
    return [rect.x - panel.x, panel.bottom - rect.bottom, rect.width, rect.height]
  }
  const before = position(u.label('发送侧聊消息'))
  const fieldBefore = position(editor())
  await u.action('发送侧聊消息')
  await u.until(
    () =>
      u.label('发送侧聊消息')?.getAttribute('aria-busy') === 'true' &&
      editor()?.value === '第一条侧聊',
    '等待原生会话时保留首发输入框',
  )
  const first = await u.until(current, '首条发送进入原生会话')
  const after = position(u.label('会话发送'))
  const fieldAfter = position(u.label('会话输入'))
  u.check(
    before.every((n, i) => Math.abs(n - after[i]) <= 1) &&
      Math.abs(fieldBefore[0] - fieldAfter[0]) <= 1,
    '切换时发送键的左右/底部位置和尺寸应一致 ' +
      JSON.stringify({ before, after, fieldBefore, fieldAfter }),
  )
  await u.click(() => tabs()[1], '第二个标签')
  await u.until(() => editor()?.value === '第二条侧聊', '第二个草稿完整保留')
  u.check(!!u.label('侧聊权限：跟随主会话'), '草稿保留自己的权限')
  await u.action('发送侧聊消息')
  const second = await u.until(current, '第二个标签独立发送')
  u.check(first !== second, '每个标签对应独立会话')
  u.check(
    !!u.label('侧聊权限：跟随主会话') && !u.label('宿主权限预设').getClientRects().length,
    '已发送侧聊内显示自己的权限入口',
  )
  await menu()
  await pick('第一条侧聊')
  await u.until(() => current() === first && tabs().length === 2, '历史点击聚焦原标签')
  await u.action('侧聊权限：只读')
  await pick('跟随主会话')
  await u.click(() => u.text('[role=dialog] button', '跟随主会话'), '修改已发送侧聊的权限')
  await u.until(() => u.label('侧聊权限：跟随主会话'), '已保存权限')
  await u.button('关闭侧聊面板')
  await u.until(() => current() === second && tabs().length === 1, '关闭第一条后仍显示第二条')
  await menu()
  await pick('第一条侧聊')
  await u.until(() => current() === first && tabs().length === 2, '关闭后从列表恢复原会话')
  u.check(!!u.label('侧聊权限：跟随主会话'), '重新打开已有侧聊沿用保存的权限')
  await u.action('侧聊权限：跟随主会话')
  await pick('只读')
  await u.until(() => u.label('侧聊权限：只读'), '当前侧聊可以恢复只读')
  await menu()
  await u.action('删除 第一条侧聊')
  await u.button('永久删除')
  await u.until(() => tabs().length === 1 && current() === second, '删除只关闭对应标签')
  u.check(!!u.label('侧聊权限：跟随主会话'), '其它侧聊保持自己的权限')
  if (u.label('侧聊列表').getAttribute('aria-expanded') === 'true') await menu()
  await u.button('打开命令菜单')
  const item = await u.until(() => u.label('/side'), '命令菜单包含 /side')
  u.check(item.textContent.trim() === '侧聊 /side', '英文命令名与本地化标题一同展示')
  u.check(
    item.querySelector('svg use')?.getAttribute('href') === '#dsw-icon-branch-outline-regular',
    '命令行显示原生分叉图标',
  )
  const language = u.label('界面语言')
  language.value = 'en'
  language.dispatchEvent(new u.window.Event('change', { bubbles: true }))
  await u.button('打开命令菜单')
  await u.until(() => u.text('button', 'Side chat /side'), '切换英文后显示 Side chat 与 /side')
  language.value = 'zh'
  language.dispatchEvent(new u.window.Event('change', { bubbles: true }))
  u.type(u.label('搜索命令'), '侧聊')
  await u.button('打开命令菜单')
  await u.until(() => u.text('button', '侧聊 /side'), '按中文标题能搜到原命令')
  await u.action('/side')
  const unsent = '未发送的长标题'.repeat(12)
  u.type(await u.until(editor, '菜单直接打开侧聊草稿'), unsent)
  await u.button('输入 /side 并回车')
  await u.until(() => editor()?.value === '', '回车执行命令新建独立空草稿')
  await u.button('关闭侧聊面板')
  await u.until(() => editor()?.value === unsent, '关闭新标签后前一份草稿仍在')
  await menu()
  const discard = await u.until(() => u.label('删除 ' + unsent), '找到长标题草稿的行内删除图标')
  const popup = discard.closest('[role=menu]')
  u.check(
    popup.getBoundingClientRect().width <= 240 &&
      popup.scrollWidth <= popup.clientWidth &&
      discard.getBoundingClientRect().right <= popup.getBoundingClientRect().right,
    '长标题不会撑宽弹层或挤出垃圾桶',
  )
  await u.action('删除 ' + unsent)
  await u.button('取消')
  u.check(editor()?.value === unsent, '取消丢弃会保留草稿')
  if (u.label('侧聊列表').getAttribute('aria-expanded') !== 'true') await menu()
  await u.action('删除 ' + unsent)
  await u.button('丢弃草稿')
  await u.until(() => current() === second, '丢弃草稿只关闭该标签')
  if (u.label('侧聊列表').getAttribute('aria-expanded') === 'true') await menu()
  await u.button('team-child')
  await u.until(() => u.label('team-child'), '切换到子会话视图')
  await u.button('右侧栏开始页')
  await u.click(() => u.one('[data-sidebar-right-guide-entry=rong-side]'), '子会话视图点侧聊')
  await u.until(editor, '子会话入口找到所属主会话')
  u.type(editor(), '子视图也归属主会话')
  await u.button('native-loop')
  await u.until(() => u.label('侧聊列表'), '返回主会话管理子视图草稿')
  await menu()
  await u.click(
    () => u.text('[role=menuitem]', '子视图也归属主会话草稿'),
    '由主会话列表聚焦子视图的原草稿',
  )
  await u.until(() => editor()?.value === '子视图也归属主会话', '原标签与草稿都被保留')
  await u.action('发送侧聊消息')
  await u.until(current, '子视图首发成功')
  await u.button('native-loop')
  await menu()
  await u.until(
    () => u.label('删除 子视图也归属主会话') && !u.label('删除 ' + unsent),
    '已发送记录归属主会话',
  )
  await menu()
}
const scenarios = { openSlider, models, speedAndTeam, settings, sideChat, workspaces, operations }
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

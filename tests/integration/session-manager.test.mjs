import assert from 'node:assert/strict'
import { test } from 'node:test'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runtime } from './helpers/runtime.mjs'
import { mountClient, document, window, byText, click, waitFor, key } from './helpers/browser.mjs'
import { act } from 'react'

async function storedSession(f, id, workspace = f.ctx.workspaceRegistry.list()[0]) {
  const handle = await f.ctx.agents.create({
    sessionId: id,
    meta: { cwd: workspace.path },
    agentOptions: f.route,
  })
  await f.ctx.sessions.flush(handle.agent.session)
  const { location, header } = await f.ctx.sessionPersistence.stat(id)
  await workspace.attachSession(id)
  await handle.dispose()
  return { directory: dirname(location.path), target: { id, createdAt: header.createdAt } }
}

test('设置页批量归档和复原；取消删除保留文件，确认删除仅清理所选会话', async (t) => {
  const f = await runtime(t)
  const one = await storedSession(f, 'first-session')
  const two = await storedSession(f, 'second-session')
  const other = await storedSession(f, 'another-session')
  const speedIdentity = (id) => ({ sessionId: id, ...f.route })
  const readSpeed = async (id) =>
    (await (await f.request('rong-aio.speed?' + new URLSearchParams(speedIdentity(id)))).json())
      .mode
  for (const { target } of [one, other]) {
    const saved = await f.request('rong-aio.speed', { ...speedIdentity(target.id), mode: 'fast' })
    assert.equal((await saved.json()).mode, 'fast')
  }
  for (const item of [one, two, other])
    await writeFile(join(item.directory, 'system_inject.json'), 'snapshot')
  // 模拟已打开的侧栏仍持有旧版本删除的会话摘要，刷新走宿主的真实会话清单。
  let sidebarIds = ['previously-deleted']
  const sessions = {
    async refresh() {
      sidebarIds = (await f.ctx.sessionQuery.listSessions()).map(({ header }) => header.id)
    },
  }
  const render = await mountClient(f, 'session-manager', { sessions })
  await render('settings.section')
  const rowButton = (id) =>
    document.querySelector('button[aria-label="选择「未命名会话」 ' + id + '"]')
  const action = (name) => document.querySelector('button[aria-label="' + name + '"]')
  await waitFor(() => byText('[role="status"]', '暂无已归档会话'))
  await waitFor(
    () => !sidebarIds.includes('previously-deleted') && sidebarIds.includes(one.target.id),
  )
  assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent, '已归档')
  assert.equal(rowButton(one.target.id), null)
  await click(byText('[role="tab"]', '未归档'))
  await waitFor(() => rowButton(one.target.id), '应列出落盘会话')
  assert.equal(document.querySelectorAll('li input[type="checkbox"]').length, 0)
  const workspaceTitle = f.ctx.workspaceRegistry.list()[0].title
  const groupCheck = byText('label', '全选工作区「' + workspaceTitle + '」').querySelector('input')
  await click(rowButton(one.target.id))
  assert.equal(rowButton(one.target.id).getAttribute('aria-pressed'), 'true')
  assert.equal(groupCheck.indeterminate, true)
  assert.equal(action('删除所选会话').disabled, false)
  await click(rowButton(f.agent.id))
  assert.equal(action('删除所选会话').disabled, true)
  await click(action('删除所选会话'))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  await click(rowButton(f.agent.id))
  assert.equal(action('删除所选会话').disabled, false)
  await click(rowButton(one.target.id))
  assert.equal(rowButton(one.target.id).getAttribute('aria-pressed'), 'false')
  assert.equal(groupCheck.indeterminate, false)
  await click(rowButton(one.target.id))
  await click(rowButton(two.target.id))
  await click(action('归档所选会话'))
  await waitFor(() => !rowButton(one.target.id))
  await click(byText('[role="tab"]', '已归档'))
  await waitFor(() => rowButton(one.target.id))
  assert.equal(rowButton(other.target.id), null)
  assert.deepEqual(
    new Set(f.ctx.workspaceRegistry.archivedSessionIds),
    new Set([one.target.id, two.target.id]),
  )
  await click(byText('label', '全选').querySelector('input'))
  await click(action('复原所选会话'))
  await waitFor(() => !rowButton(two.target.id))
  await click(byText('[role="tab"]', '未归档'))
  await click(
    rowButton(one.target.id).closest('li').querySelector('button[aria-label="删除「未命名会话」"]'),
  )
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes(one.target.id))
  await click(byText('button', '取消'))
  assert.equal(rowButton(one.target.id).getAttribute('aria-pressed'), 'false')
  assert.equal(await readFile(join(one.directory, 'system_inject.json'), 'utf8'), 'snapshot')
  await click(rowButton(one.target.id))
  await click(rowButton(two.target.id))
  await click(action('删除所选会话'))
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes(two.target.id))
  await click(byText('button', '永久删除'))
  await waitFor(() => document.body.textContent.includes('已删除 2 个会话'))
  await waitFor(() => !action('刷新会话').disabled && !rowButton(two.target.id))
  await click(action('关闭通知'))
  assert.ok(!document.body.textContent.includes('已删除 2 个会话'))
  await waitFor(() => !sidebarIds.includes(one.target.id) && !sidebarIds.includes(two.target.id))
  assert.ok(sidebarIds.includes(other.target.id))
  for (const item of [one, two]) {
    await assert.rejects(access(item.directory), { code: 'ENOENT' })
    assert.equal(await f.ctx.sessionPersistence.stat(item.target.id), undefined)
  }
  assert.equal(await readFile(join(other.directory, 'system_inject.json'), 'utf8'), 'snapshot')
  assert.equal(await readSpeed(one.target.id), 'standard')
  assert.equal(await readSpeed(other.target.id), 'fast')
  assert.deepEqual(
    f.ctx.workspaceRegistry.list()[0].sessionIds.filter((id) => id !== f.agent.id),
    [other.target.id],
  )
})

test('缺少删除确认时拒绝请求；批量删除隔离占用和过期目标', async (t) => {
  const f = await runtime(t)
  const one = await storedSession(f, 'old')
  const eligible = await storedSession(f, 'eligible')
  const live = { id: f.agent.id, createdAt: f.agent.session.header.createdAt }
  const path = 'rong-aio.session-manager'
  const removed = []
  f.ctx.on('api-session/removed', (id) => {
    removed.push(id)
  })
  assert.equal((await f.request(path, { action: 'delete', targets: [one.target] })).status, 400)
  const response = await f.request(path, {
    action: 'delete',
    confirmed: true,
    targets: [live, { ...one.target, createdAt: one.target.createdAt + 1 }, eligible.target],
  })
  const { outcomes } = await response.json()
  assert.match(outcomes[0].error, /占用/)
  assert.match(outcomes[1].error, /已变更/)
  assert.deepEqual(outcomes[2], { id: eligible.target.id })
  await access(one.directory)
  await assert.rejects(access(eligible.directory), { code: 'ENOENT' })
  assert.deepEqual(removed, [eligible.target.id], '已连接的原生侧栏应只收到成功删除的会话')
  const writer = await f.ctx.sessionPersistence.open(one.target.id, 'write')
  const remove = async () =>
    (await f.request(path, { action: 'delete', confirmed: true, targets: [one.target] })).json()
  try {
    assert.match((await remove()).outcomes[0].error, /占用/)
    await access(one.directory)
  } finally {
    await writer.close()
  }
  assert.deepEqual(await remove(), { outcomes: [{ id: one.target.id }] })
  await assert.rejects(access(one.directory), { code: 'ENOENT' })
  assert.deepEqual(removed, [eligible.target.id, one.target.id])
})

test('同名工作区各自分组，悬停和菜单使用所点会话的实际路径与 ID', async (t) => {
  const f = await runtime(t)
  const first = f.ctx.workspaceRegistry.list()[0]
  const anotherPath = join(f.root, 'other', 'project')
  await mkdir(anotherPath, { recursive: true })
  const second = await f.ctx.workspaceRegistry.create(anotherPath)
  await first.setTitle('研发')
  await second.setTitle('研发')
  const one = await storedSession(f, 'alpha', first)
  const two = await storedSession(f, 'beta', second)
  await f.ctx.workspaceRegistry.archiveSession(one.target.id)
  await f.ctx.workspaceRegistry.archiveSession(two.target.id)
  let copied
  t.mock.getter(globalThis, 'navigator', () => ({
    clipboard: {
      writeText: async (value) => {
        copied = value
      },
    },
  }))
  const render = await mountClient(f, 'session-manager', { sessions: { async refresh() {} } })
  await render('settings.section')
  await waitFor(() => byText('small', two.target.id))
  assert.ok(!byText('small', f.agent.id))
  const groups = [...document.querySelectorAll('ul[aria-label="研发"]')]
  assert.equal(groups.length, 2)
  const workspaceOrder = f.ctx.workspaceRegistry.list().map((w) => w.id)
  assert.ok(groups[workspaceOrder.indexOf(first.id)].textContent.includes(one.target.id))
  assert.ok(groups[workspaceOrder.indexOf(second.id)].textContent.includes(two.target.id))
  const firstList = groups[workspaceOrder.indexOf(first.id)]
  const header = document.querySelector('button[aria-controls="' + firstList.id + '"]')
  const groupCheck = header.parentElement.querySelector('input[type="checkbox"]')
  await click(header)
  assert.equal(header.getAttribute('aria-expanded'), 'false')
  await click(groupCheck)
  assert.equal(groupCheck.checked, true)
  assert.equal(header.getAttribute('aria-expanded'), 'false')
  await click(header)
  assert.equal(firstList.querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'true')
  const row = byText('small', two.target.id).closest('li')
  assert.equal(row.querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false')
  assert.ok(!row.textContent.includes(anotherPath))
  await act(async () => row.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })))
  await waitFor(() =>
    document.querySelector('[role="tooltip"]')?.textContent.includes(two.directory),
  )
  assert.ok(document.querySelector('[role="tooltip"]').textContent.includes(anotherPath))
  const invoke = async (label) => {
    await act(async () =>
      row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true })),
    )
    await click(byText('[role="menuitem"]', label))
  }
  await invoke('复制会话 ID')
  assert.equal(copied, 'beta')
  await invoke('复制存档路径')
  assert.equal(copied, two.directory)
  await key(row, 'ContextMenu')
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent),
    ['复制存档路径', '复制会话 ID', '在文件管理器中打开'],
  )
  await click(byText('[role="menuitem"]', '在文件管理器中打开'))
  await waitFor(() => f.openedDirectories.length === 1)
  assert.deepEqual(f.openedDirectories, [two.directory])
  assert.equal(row.querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false')
  // 筛选应展开匹配组、清除上次选择；清空搜索后，同名工作区仍然独立。
  await click(header)
  const search = document.querySelector('input[aria-label="搜索会话"]')
  const typeQuery = (value) =>
    act(async () => {
      const input = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      input.set.call(search, value)
      search.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  await typeQuery(one.target.id)
  assert.equal(
    document.querySelector('button[aria-expanded]').getAttribute('aria-expanded'),
    'true',
  )
  assert.equal(document.querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false')
  assert.ok(!byText('small', two.target.id))
  await typeQuery('')
  assert.ok(byText('small', two.target.id))
})

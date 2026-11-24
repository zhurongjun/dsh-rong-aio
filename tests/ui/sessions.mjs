const row = (u, id) => u.one('button[aria-pressed][aria-label$=" ' + id + '"]')
const select = (u, id) => u.click(() => row(u, id), id)
const checked = (el) => el?.getAttribute('aria-pressed') === 'true'

export async function workspaces(u) {
  await u.button('会话管理')
  await u.until(() => u.text('[role=status]', '暂无已归档会话'), '初次打开显示归档空态')
  u.check(
    u.one('[role=tab][aria-selected=true]').textContent === '已归档' && !row(u, 'native-loop'),
    '归档分栏',
  )
  await u.until(
    () =>
      u.label('宿主侧栏').textContent.includes('first-session') &&
      !u.label('宿主侧栏').textContent.includes('previously-deleted'),
    '打开时同步侧栏',
  )

  u.press(u.text('[role=tab]', '已归档'), 'ArrowRight')
  await u.until(
    () => u.document.activeElement === u.text('[role=tab]', '未归档'),
    '键盘切换分栏时焦点跟随',
  )

  await select(u, 'alpha')
  await select(u, 'beta')
  await u.action('归档所选会话')
  await u.until(() => !row(u, 'alpha') && !row(u, 'beta'), '跨工作区归档完成')

  await u.tab('已归档')
  await u.until(() => row(u, 'alpha') && row(u, 'beta'), '两个归档工作区均可见')

  const groups = u.all('ul[aria-label="研发"]')
  const list = row(u, 'alpha').closest('ul')
  u.check(groups.length === 2 && !list.contains(row(u, 'beta')), '同名工作区独立')

  const header = u.one('[aria-controls="' + list.id + '"]')
  const checkbox = header.parentElement.querySelector('input[type=checkbox]')
  header.click()
  await u.until(() => header.getAttribute('aria-expanded') === 'false', '折叠工作区')
  checkbox.click()
  await u.until(
    () => checkbox.checked && header.getAttribute('aria-expanded') === 'false',
    '折叠时全选不展开',
  )
  header.click()
  await u.until(() => checked(row(u, 'alpha')) && !checked(row(u, 'beta')), '全选只影响本组')

  const beta = row(u, 'beta').closest('li')
  u.press(u.document.activeElement, 'Tab')
  row(u, 'beta').focus()
  const tooltip = await u.until(
    () => u.one('[role=tooltip]')?.textContent.includes('beta') && u.one('[role=tooltip]'),
    '聚焦显示会话详情',
  )
  const details = tooltip.textContent

  const context = () => u.press(row(u, 'beta'), 'ContextMenu')
  const item = async (name) => u.click(() => u.text('[role=menuitem]', name), name)

  context()
  await item('复制会话 ID')
  await u.until(() => u.label('测试剪贴板').textContent === 'beta', '复制所点会话 ID')

  context()
  await item('复制存档路径')
  const directory = await u.until(() => {
    const path = u.label('测试剪贴板').textContent
    return path !== 'beta' && path
  }, '复制存档路径')

  u.check(
    details.split('\n').includes('会话存档：' + directory) &&
      details
        .split('\n')
        .some((line) => line.startsWith('工作区路径：') && /[\\/]other[\\/]project$/.test(line)) &&
      !beta.innerText.includes(directory),
    '仅在详情展示存档路径',
  )

  context()
  await item('在文件管理器中打开')
  u.check(!checked(row(u, 'beta')), '菜单不切换选择')

  header.click()
  const search = u.label('搜索会话')
  u.type(search, 'ALPHA')
  await u.until(
    () => row(u, 'alpha') && !row(u, 'beta') && !checked(row(u, 'alpha')),
    '筛选展开命中组并清除选择',
  )
  u.type(search, 'absent')
  await u.until(
    () => u.text('[role=status]', '没有匹配的会话') && u.label('删除所选会话').disabled,
    '空筛选禁止删除',
  )
  u.type(search, '')
  await u.until(() => row(u, 'beta'), '清空筛选')
}

export async function operations(u) {
  await u.tab('未归档')
  await u.until(() => row(u, 'native-loop'), '显示活动会话')
  await select(u, 'first-session')

  const list = row(u, 'first-session').closest('ul')
  const group = u.one('[aria-controls="' + list.id + '"]').parentElement.querySelector('input')
  await u.until(() => group.indeterminate && !u.label('删除所选会话').disabled, '部分选中工作区')

  await select(u, 'native-loop')
  await u.until(() => u.label('删除所选会话').disabled, '占用项阻止整批删除')
  u.label('删除所选会话').click()
  u.check(!u.one('[role=dialog]'), '禁用的删除操作不能弹出确认')

  await select(u, 'native-loop')
  await select(u, 'second-session')
  await u.action('归档所选会话')
  await u.until(() => !row(u, 'first-session') && !row(u, 'second-session'), '两项离开未归档列表')

  await u.tab('已归档')
  const search = u.label('搜索会话')
  u.type(search, '-session')
  await u.until(
    () => row(u, 'first-session') && row(u, 'second-session') && !row(u, 'alpha'),
    '归档后的两项可筛选',
  )
  await u.click(() => u.text('label', '全选')?.querySelector('input'), '全选筛选结果')
  await u.action('复原所选会话')
  await u.until(() => !row(u, 'second-session'), '复原离开归档列表')

  u.type(search, '')
  await u.tab('未归档')
  const single = await u.until(() => row(u, 'first-session'), '复原后可见')
  single.closest('li').querySelector('button[aria-label^="删除"]').click()
  await u.until(() => u.one('[role=dialog]')?.textContent.includes('first-session'), '单项删除确认')
  await u.until(() => u.document.activeElement.textContent === '取消', '默认焦点在取消')
  await u.button('取消')
  await u.until(
    () => !u.one('[role=dialog]') && row(u, 'first-session') && !checked(row(u, 'first-session')),
    '取消保留会话及选择',
  )

  await select(u, 'first-session')
  await select(u, 'second-session')
  await u.action('删除所选会话')
  const confirmation = await u.until(() => u.one('[role=dialog]'), '批量删除确认')
  u.check(
    ['first-session', 'second-session'].every((id) => confirmation.textContent.includes(id)) &&
      !confirmation.textContent.includes('native-loop'),
    '确认列表仅包含所选会话',
  )

  await u.button('永久删除')
  await u.until(() => u.text('[role=alert]', '已删除 2 个会话'), '原生删除 Toast')
  await u.until(
    () =>
      !row(u, 'first-session') &&
      !row(u, 'second-session') &&
      !u.label('宿主侧栏').textContent.includes('second-session'),
    '列表和侧栏同步删除',
  )
  u.check(
    row(u, 'native-loop') && !u.label('会话管理').textContent.includes('已删除 2 个会话'),
    '非目标保留且页面无内联成功提示',
  )
}

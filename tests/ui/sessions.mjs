const row = (u, id) => u.one('button[aria-pressed][aria-label$=" ' + id + '"]')
const subrow = (u, id) => u.one('[aria-label^="子会话「"][aria-label$=" ' + id + '"]')
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
  const nativeTree = row(u, 'native-loop').closest('.rong-session-tree-item')
  const teamChild = await u.until(() => subrow(u, 'team-child'), '主会话展示嵌套子会话')
  const teamGroup = nativeTree.querySelector('ul[role=group]')
  u.check(
    teamGroup &&
      teamGroup.contains(teamChild) &&
      teamChild.textContent.includes('子会话') &&
      teamChild.textContent.includes('DSH 占用中') &&
      !teamChild.querySelector('button[aria-pressed]') &&
      !teamGroup.querySelector('button[aria-label^="删除"]') &&
      row(u, 'native-loop').textContent.includes('1 个子会话') &&
      row(u, 'native-loop').textContent.includes('DSH 占用中'),
    '主会话展示子会话个数，子会话展示子会话与占用标签且无选框与独立删除按钮',
  )
  const firstTree = row(u, 'first-session').closest('.rong-session-tree-item')
  const firstGroup = firstTree.querySelector('ul[role=group]')
  const firstSubItem = subrow(u, 'first-sub').closest('.rong-session-tree-item')
  const firstGrand = subrow(u, 'first-grand')
  const missingRoot = row(u, 'removed-main')
  const missingGroup = missingRoot
    .closest('.rong-session-tree-item')
    .querySelector('ul[role=group]')
  u.check(
    firstGroup?.contains(subrow(u, 'first-sub')) &&
      firstSubItem.querySelector('ul[role=group]')?.contains(firstGrand) &&
      row(u, 'first-session').textContent.includes('2 个子会话') &&
      subrow(u, 'first-sub').textContent.includes('1 个子会话') &&
      missingRoot.textContent.includes('主会话缺失') &&
      missingRoot.textContent.includes('1 个子会话') &&
      missingGroup?.contains(subrow(u, 'orphan-sub')) &&
      !subrow(u, 'orphan-sub').querySelector('button[aria-pressed]'),
    '主会话展示多级嵌套子会话与层级计数，缺失主会话汇聚孤立子会话',
  )

  const toggleSub = () =>
    subrow(u, 'first-sub').closest('.rong-session-row').querySelector('button[aria-expanded]')
  await u.click(toggleSub, '折叠中间层子会话')
  await u.until(
    () =>
      toggleSub().getAttribute('aria-expanded') === 'false' &&
      row(u, 'first-session') &&
      subrow(u, 'first-sub') &&
      !subrow(u, 'first-grand'),
    '折叠中间子会话仅隐藏其下级',
  )
  await u.click(toggleSub, '展开中间层子会话')
  await u.until(
    () => toggleSub().getAttribute('aria-expanded') === 'true' && subrow(u, 'first-grand'),
    '展开中间子会话恢复下级',
  )

  await u.click(() => u.label('折叠全部子会话'), '折叠全部子会话')
  await u.until(
    () =>
      !subrow(u, 'team-child') &&
      !subrow(u, 'first-sub') &&
      !subrow(u, 'first-grand') &&
      !subrow(u, 'orphan-sub'),
    '一键折叠所有层级子会话',
  )
  await u.click(() => u.label('展开全部子会话'), '展开全部子会话')
  await u.until(
    () =>
      subrow(u, 'team-child') &&
      subrow(u, 'first-sub') &&
      subrow(u, 'first-grand') &&
      subrow(u, 'orphan-sub'),
    '一键展开所有层级子会话',
  )

  await select(u, 'first-session')

  const list = row(u, 'first-session').closest('.rong-session-group ul')
  const group = u.one('[aria-controls="' + list.id + '"]').parentElement.querySelector('input')
  await u.until(() => group.indeterminate && !u.label('删除所选会话').disabled, '部分选中工作区')

  await select(u, 'native-loop')
  await u.until(() => u.label('删除所选会话').disabled, '占用项阻止整批删除')
  u.label('删除所选会话').click()
  u.check(!u.one('[role=dialog]'), '禁用的删除操作不能弹出确认')

  await select(u, 'native-loop')
  await select(u, 'second-session')
  await u.action('归档所选会话')
  await u.until(
    () =>
      !row(u, 'first-session') &&
      !subrow(u, 'first-sub') &&
      !subrow(u, 'first-grand') &&
      !row(u, 'second-session'),
    '两项及多级子会话离开未归档列表',
  )

  await u.tab('已归档')
  const search = u.label('搜索会话')
  u.type(search, 'first-grand')
  await u.until(
    () =>
      row(u, 'first-session') &&
      subrow(u, 'first-sub') &&
      subrow(u, 'first-grand') &&
      !row(u, 'second-session'),
    '搜索深层子会话保留完整祖先层级',
  )

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
  u.check(Boolean(subrow(u, 'first-sub') && subrow(u, 'first-grand')), '多级子会话随主会话一同复原')

  u.press(subrow(u, 'first-sub'), 'ContextMenu')
  await u.click(() => u.text('[role=menuitem]', '复制会话 ID'), '子会话右键复制 ID')
  await u.until(() => u.label('测试剪贴板').textContent === 'first-sub', '子会话保留上下文菜单')

  single.closest('.rong-session-row').querySelector('button[aria-label^="删除"]').click()
  await u.until(
    () =>
      u.one('[role=dialog]')?.textContent.includes('first-session') &&
      u.one('[role=dialog]')?.textContent.includes('first-sub') &&
      u.one('[role=dialog]')?.textContent.includes('first-grand'),
    '单项删除确认树状列出主会话及多级子会话',
  )
  await u.until(() => u.document.activeElement.textContent === '取消', '默认焦点在取消')
  await u.button('取消')
  await u.until(
    () => !u.one('[role=dialog]') && row(u, 'first-session') && !checked(row(u, 'first-session')),
    '取消保留会话及选择',
  )

  await select(u, 'first-session')
  await select(u, 'second-session')
  await select(u, 'removed-main')
  await u.action('删除所选会话')
  const confirmation = await u.until(() => u.one('[role=dialog]'), '批量删除确认')
  u.check(
    [
      'first-session',
      'first-sub',
      'first-grand',
      'second-session',
      'removed-main',
      'orphan-sub',
    ].every((id) => confirmation.textContent.includes(id)) &&
      confirmation.textContent.includes('3 个子会话') &&
      !confirmation.textContent.includes('native-loop'),
    '确认列表包含所选主会话、多级子会话与孤立子会话',
  )

  await u.button('永久删除')
  await u.until(() => u.text('[role=alert]', '已删除 3 个会话'), '原生删除 Toast')
  await u.until(
    () =>
      !row(u, 'first-session') &&
      !subrow(u, 'first-sub') &&
      !subrow(u, 'first-grand') &&
      !row(u, 'removed-main') &&
      !subrow(u, 'orphan-sub') &&
      !row(u, 'second-session') &&
      !u.label('宿主侧栏').textContent.includes('first-grand') &&
      !u.label('宿主侧栏').textContent.includes('orphan-sub') &&
      !u.label('宿主侧栏').textContent.includes('second-session'),
    '列表和侧栏同步删除主会话、多级子会话及孤立子会话',
  )
  u.check(
    row(u, 'native-loop') && !u.label('会话管理').textContent.includes('已删除 3 个会话'),
    '非目标保留且页面无内联成功提示',
  )
}

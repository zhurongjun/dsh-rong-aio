const trigger = (u) => u.one('button[aria-label^="选择模型与推理强度"]')
const armor = (u) => u.one('button[aria-label^="破甲模式："]')
const speed = (u) => u.one('button[aria-label^="速度："]')
const team = (u) => u.one('button[aria-label^="Agent Team："]')
const slider = (u) => u.one('[role=slider]')

async function panel(u) {
  if (trigger(u)?.getAttribute('aria-expanded') !== 'true') {
    await u.click(() => trigger(u), '模型入口')
  }
  await u.until(() => u.label('模型与推理强度'), '模型面板')
}

async function closePanel(u) {
  if (trigger(u)?.getAttribute('aria-expanded') === 'true') {
    await u.click(() => trigger(u), '收起模型')
  }
  await u.until(() => trigger(u)?.getAttribute('aria-expanded') === 'false', '收起模型后释放焦点')
}

async function selectTemplate(u, name) {
  await u.click(() => armor(u), '破甲入口')
  await u.click(() => u.all('[role=menuitem]').find((el) => el.textContent.startsWith(name)), name)
}

async function modelList(u, name) {
  await panel(u)
  if (!u.one('[role=combobox]')) {
    await u.click(
      () => u.all('[role=dialog] button').find((el) => el.textContent.includes(name)),
      '模型列表 ' + name,
    )
  }
  return u.until(() => u.one('[role=combobox]'), '搜索模型')
}

export async function models(u) {
  await panel(u)
  await u.until(() => slider(u)?.getAttribute('aria-valuetext') === '尚未选择强度', '初始强度为空')

  u.press(slider(u), 'End')
  await u.until(
    () =>
      slider(u)?.getAttribute('aria-valuetext') === 'high' &&
      slider(u)?.getAttribute('aria-busy') !== 'true' &&
      trigger(u)?.textContent.includes('high') &&
      u.label('宿主选模记录').textContent === 'high',
    'End 键提交 high',
  )

  u.press(slider(u), 'ArrowLeft')
  await u.until(
    () =>
      slider(u)?.getAttribute('aria-valuetext') === 'medium' &&
      slider(u)?.getAttribute('aria-busy') !== 'true' &&
      trigger(u)?.textContent.includes('medium'),
    '左键回退到 medium',
  )

  u.press(slider(u), 'ArrowRight')
  await u.until(
    () =>
      slider(u)?.getAttribute('aria-valuetext') === 'high' &&
      slider(u)?.getAttribute('aria-busy') !== 'true' &&
      trigger(u)?.textContent.includes('high'),
    '右键前进到 high',
  )

  await u.action('重置当前模型的推理强度')
  await u.until(() => trigger(u)?.textContent.includes('medium'), '重置后为 medium')
  await closePanel(u)

  await selectTemplate(u, '破甲词')
  await u.until(() => armor(u)?.textContent.includes('破甲词'), '模板已选择')

  const search = await modelList(u, 'gpt-6-astra')
  u.type(search, 'missing-model')
  await u.until(() => !u.one('[role=option]'), '无匹配选项')
  u.type(search, 'denied')
  await u.click(() => u.text('[role=option]', 'denied'), '拒绝模型')
  await u.until(
    () => u.all('[role=alert]').some((el) => el.textContent.includes('未获破甲模式授权')),
    '拒绝提示',
  )
  u.check(trigger(u).textContent.includes('gpt-6-astra'), '拒绝后原模型应保留')
  await closePanel(u)

  await selectTemplate(u, '关闭')
  await u.until(() => armor(u)?.textContent.includes('未破甲'), '关闭模板')

  const box = await modelList(u, 'gpt-6-astra')
  u.type(box, 'denied')
  u.press(box, 'ArrowDown')
  await u.until(
    () =>
      u.document.getElementById(box.getAttribute('aria-activedescendant'))?.textContent ===
      'denied',
    '键盘高亮',
  )
  u.press(box, 'Enter')
  await u.until(
    () => trigger(u)?.textContent.includes('denied') && !slider(u),
    '键盘切换非推理模型',
  )
  await closePanel(u)

  const earlierAlerts = new Set(u.all('[role=alert]'))
  await selectTemplate(u, '破甲词')
  await u.until(
    () =>
      u
        .all('[role=alert]')
        .some((el) => !earlierAlerts.has(el) && el.textContent.includes('denied')),
    '未授权模型拒绝模板',
  )
  u.check(
    armor(u).textContent.includes('未破甲') && !u.one('[role=dialog]'),
    '拒绝不覆盖选择或打开对话框',
  )
}

export async function speedAndTeam(u) {
  await u.button('another')
  await u.until(() => u.label('another'), '切换新会话')
  await panel(u)
  await u.click(() => speed(u)?.getAttribute('aria-busy') !== 'true' && speed(u), '速度菜单')
  await u.until(() => u.one('[role=menuitemradio]'), '速度选项')
  u.press(u.document.activeElement, 'End')
  await u.until(() => u.document.activeElement.textContent === '超快', 'End 聚焦超快')
  u.document.activeElement.click()
  await u.until(() => trigger(u)?.getAttribute('aria-label').includes('超快模式'), '新速度已确认')

  const choose = async (label) => {
    await panel(u)
    await u.click(() => team(u), '团队菜单')
    await u.click(() => u.text('[role=menuitemradio]', label), label)
  }

  await choose('开启')
  await u.until(() => team(u)?.getAttribute('aria-label').includes('开启'), '团队已开启')
  await closePanel(u)

  await selectTemplate(u, '破甲词')
  await u.until(() => armor(u)?.textContent.includes('破甲词'), '已选模板')
  await u.button('发送测试消息')
  await u.until(() => armor(u)?.getAttribute('aria-haspopup') === 'dialog', '首次请求冻结模板')
  await u.click(() => armor(u), '打开快照')

  const body = await u.until(() => u.label('破甲模式正文快照'), '冻结快照')
  u.check(body.readOnly && body.value === '\nLITERAL {{keep}}\n', '快照应为只读原文')
  u.press(body, 'Escape')
  await u.until(() => !u.label('破甲模式正文快照'), 'Escape 关闭快照')

  await choose('关闭')
  await u.button('取消')
  await panel(u)
  await u.until(() => team(u)?.getAttribute('aria-label').includes('开启'), '取消停用应保留团队')

  await choose('关闭')
  await u.button('确认停用')
  await panel(u)
  await u.until(() => team(u)?.getAttribute('aria-label').includes('关闭'), '团队已停用')

  await u.button('team-child')
  await u.until(() => u.label('team-child'), '子会话加载')
  await panel(u)
  await u.until(() => speed(u) && speed(u).getAttribute('aria-busy') !== 'true', '子会话速度可用')
  u.check(
    !team(u) && !trigger(u).getAttribute('aria-label').includes('超快模式'),
    '子会话无团队入口且使用独立速度',
  )

  await u.button('another')
  await u.until(
    () => trigger(u)?.getAttribute('aria-label').includes('超快模式'),
    '切回原会话应保留速度',
  )
}

export async function settings(u) {
  const field = (name) =>
    u
      .all('label')
      .find((el) => el.textContent.includes(name))
      ?.querySelector('input, textarea')

  await u.button('破甲设置')
  await u.click(() => u.one('button[aria-label^="编辑破甲词"]'), '编辑模板')
  await u.until(() => u.one('textarea')?.value === '\nLITERAL {{keep}}\n', '编辑器加载原文')
  await u.action('返回模板库')

  await u.button('新建')
  u.type(await u.until(() => field('短标识'), '短标识输入'), 'temp-rule')
  u.type(field('显示名称'), '临时规则')
  u.type(field('正文'), '临时正文')
  await u.button('保存')
  await u.until(() => u.label('编辑临时规则（temp-rule）'), '新建模板保存成功')

  await u.action('编辑临时规则（temp-rule）')
  u.type(await u.until(() => field('正文'), '编辑已有正文'), '更新后的正文')
  await u.button('保存')
  await u.until(() => u.label('编辑临时规则（temp-rule）'), '编辑模板返回列表')
  await u.action('编辑临时规则（temp-rule）')
  await u.until(() => field('正文')?.value === '更新后的正文', '重新打开确认修改已持久化')
  await u.action('返回模板库')

  await u.action('临时规则的操作')
  await u.click(() => u.text('[role=menuitem]', '删除'), '删除模板')
  await u.button('确认删除')
  await u.until(() => !u.label('编辑临时规则（temp-rule）'), '模板已移除')

  await u.tab('模型白名单')
  await u.button('新增')
  const existing = await u.until(
    () => u.all('[role=option]').find((el) => el.textContent.includes('gpt-6-astra')),
    '已授权模型',
  )
  u.check(existing.disabled, '已授权模型禁止重复添加')
  await u.click(
    () => u.all('[role=option]').find((el) => el.textContent.includes('denied')),
    '新增授权',
  )
  await u.click(() => u.one('button[aria-label^="删除 denied"]'), '删除授权')
  await u.until(() => !u.one('button[aria-label^="删除 denied"]'), '列表移除授权')
}

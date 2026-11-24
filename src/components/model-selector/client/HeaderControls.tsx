/** 面板顶栏开关与确认：整合 Fast 速度选项、Agent Team 开关与停用确认弹窗。 */

import clsx from 'clsx'
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmModal } from '../../../client/ConfirmModal.tsx'
import { SPEED_LABELS } from '../shared/speed.ts'
import { FastIcon } from './SelectorIcons.tsx'
import { OptionControl } from './OptionControl.tsx'
import { useSpeedSelection, type SpeedStore } from './speed-store.ts'
import type { TeamSelection, TeamInteraction } from './selector-session.ts'

/** 路由变化重建菜单，速度显示始终来自宿主确认值。 */
export function SpeedControl({
  store,
  identityKey,
  open,
  disabled,
  busy,
}: {
  store: SpeedStore
  identityKey: string
  open: boolean
  disabled: boolean
  busy: boolean
}) {
  const { state, loading, saving, select } = useSpeedSelection(store, identityKey)
  return (
    <OptionControl
      key={identityKey}
      value={state.mode}
      items={state.modes.map((value) => ({ value, label: SPEED_LABELS[value] }))}
      label={
        state.modes.length > 1
          ? `速度：${SPEED_LABELS[state.mode]}`
          : `Fast 不可用：${state.reason ?? (loading ? '正在读取速度设置' : '此模型不在支持规则内')}`
      }
      menuLabel="速度模式"
      icon={<FastIcon active={state.mode !== 'standard' && state.modes.length > 1} />}
      className="rong-fast"
      open={open}
      disabled={disabled || state.modes.length < 2}
      busy={busy || loading || saving}
      onSelect={(mode) => void select(mode)}
    />
  )
}

/** 开关入口位于 Fast 右侧；hover 只改变背景，开启色来自官方语义 token。 */
export function TeamControl({
  team,
  interaction,
  open,
  locked,
  busy,
}: {
  team: TeamSelection
  interaction: TeamInteraction
  open: boolean
  locked: boolean
  busy: boolean
}) {
  return (
    <OptionControl
      value={team.enabled ? 'on' : 'off'}
      items={[
        { value: 'off', label: '关闭' },
        { value: 'on', label: '开启' },
      ]}
      label={`Agent Team：${team.enabled ? '开启' : '关闭'}`}
      menuLabel="Agent Team 模式"
      icon={<IconUsersOutlineRegular size={16} />}
      className={clsx('rong-team', team.enabled && 'rong-team-enabled')}
      open={open}
      disabled={locked || !team.ready}
      busy={busy || interaction.pending}
      onSelect={(value) => interaction.select(value === 'on')}
    />
  )
}

/** 位于主菜单外；取消不发送请求，失败允许重试，不受菜单退场卸载影响。 */
export function TeamDisableDialog({
  interaction,
  disabled,
}: {
  interaction: TeamInteraction
  disabled: boolean
}) {
  return (
    <ConfirmModal
      open={interaction.confirming}
      tone="warning"
      title="确认停用 Agent Team？"
      closeLabel="取消"
      confirmLabel="确认停用"
      busy={interaction.pending}
      confirmDisabled={disabled}
      onCancel={interaction.cancel}
      onConfirm={interaction.confirm}
    >
      <p>停用后，后续步骤将不再使用共享任务工具和团队协调指令，已有任务与子智能体会保留。</p>
      <p>这可能影响缓存复用，增加后续 token 用量与开销，并影响当前任务的协作效果。</p>
    </ConfirmModal>
  )
}

/** Fast 业务适配：只订阅速度能力与确认值，菜单交互使用共享 OptionControl。 */

import { memo } from 'react'
import { SPEED_LABELS } from '../../shared/speed.ts'
import { FastIcon } from './SelectorIcons.tsx'
import { useSpeedSelection } from './useSpeedSelection.ts'
import type { SpeedStore } from './speed-store.ts'
import { OptionControl } from './OptionControl.tsx'

interface Props {
  /** 速度状态与会话/provider/model 身份，由外层托管生命周期。 */
  store: SpeedStore
  identityKey: string
  /** 主面板状态；保存中保留图标，锁定时禁止交互。 */
  open: boolean
  disabled: boolean
  busy: boolean
}

/** 路由变化重建菜单，速度显示始终来自宿主确认值。 */
export const SpeedControl = memo(function SpeedControl({
  store,
  identityKey,
  open,
  disabled,
  busy,
}: Props) {
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
})

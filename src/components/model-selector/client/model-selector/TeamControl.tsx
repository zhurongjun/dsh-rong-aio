/** Agent Team 图标菜单与关闭确认：共享 Fast 控件，保留原生会话级授权与确认语义。 */

import { Button, Modal, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { OptionControl } from './OptionControl.tsx'
import type { TeamSelection, TeamInteraction } from './team-store.ts'

interface Props {
  /** 原生投影及仅属于当前会话的交互事务。 */
  team: TeamSelection
  interaction: TeamInteraction
  open: boolean
  locked: boolean
  busy: boolean
}

/** 开关入口位于 Fast 右侧；hover 只改变背景，开启色来自官方语义 token。 */
export function TeamControl({ team, interaction, open, locked, busy }: Props) {
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
      className={`rong-team${team.enabled ? ' rong-team-enabled' : ''}`}
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
    <Modal
      open={interaction.confirming}
      tone="warning"
      title="确认停用 Agent Team？"
      closeLabel="取消"
      onClose={interaction.cancel}
      footer={
        <>
          <Button
            variant="outline"
            disabled={interaction.pending}
            data-modal-autofocus
            onClick={interaction.cancel}
          >
            取消
          </Button>
          <Button
            variant="primary"
            disabled={disabled || interaction.pending}
            onClick={interaction.confirm}
          >
            确认停用
          </Button>
        </>
      }
    >
      <p>停用后，后续步骤将不再使用共享任务工具和团队协调指令，已有任务与子智能体会保留。</p>
      <p>这可能影响缓存复用，增加后续 token 用量与开销，并影响当前任务的协作效果。</p>
    </Modal>
  )
}

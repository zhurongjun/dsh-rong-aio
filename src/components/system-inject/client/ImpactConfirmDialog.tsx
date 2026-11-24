/** 改名与删除的引用影响确认弹窗：以可辨识联合替代多处条件三元分支。 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { Dialog } from './Dialog.tsx'

export type ImpactTarget =
  | { kind: 'rename'; references: string[] }
  | { kind: 'delete'; displayName: string; references: string[] }

export function ImpactConfirmDialog({
  target,
  saving,
  onCancel,
  onConfirm,
}: {
  target: ImpactTarget | null
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const isRename = target?.kind === 'rename'
  const references = target?.references ?? []

  return (
    <Dialog
      open={target !== null}
      onClose={onCancel}
      title={isRename ? '修改引用名称？' : '删除破甲词？'}
      actions={
        <>
          <Button size="sm" disabled={saving} onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" variant="primary" disabled={saving} onClick={onConfirm}>
            {isRename ? '确认改名' : '确认删除'}
          </Button>
        </>
      }
    >
      <p>
        {isRename
          ? '原名称的引用不会自动更新。'
          : `删除“${target?.kind === 'delete' ? target.displayName : ''}”？`}
        已冻结会话继续使用原快照。
      </p>
      {!!references.length && (
        <div className="rong-inject-impact">
          <strong>以下 {references.length} 处引用将失效</strong>
          <ul>
            {references.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="rong-inject-muted">范围限于当前宿主的未发送会话。</p>
    </Dialog>
  )
}

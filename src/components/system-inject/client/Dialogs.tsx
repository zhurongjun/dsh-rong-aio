import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmModal } from '../../../client/ConfirmModal.tsx'
import type { SessionView } from '../shared/protocol.ts'
import { SOURCE_LABELS } from '../shared/state.ts'

export function SettingsModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      closeLabel="关闭"
      className="rong-inject-modal"
      contentClassName="rong-inject-modal-scroll"
    >
      {children}
    </Modal>
  )
}

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
    <ConfirmModal
      open={target !== null}
      title={isRename ? '修改引用名称？' : '删除破甲词？'}
      confirmLabel={isRename ? '确认改名' : '确认删除'}
      destructive={target?.kind === 'delete'}
      busy={saving}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <div className="rong-inject-impact-body">
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
      </div>
    </ConfirmModal>
  )
}

export function SnapshotDialog({
  open,
  onClose,
  view,
  statusLabel,
}: {
  open: boolean
  onClose: () => void
  view?: SessionView
  statusLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const body = view?.resolved.state.snapshot?.body ?? ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="破甲模式快照"
      closeLabel="关闭"
      className={clsx(body && 'rong-inject-modal')}
      contentClassName={clsx(body && 'rong-inject-modal-scroll')}
      footer={
        body ? (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await writeClipboard(body)
                setCopied(true)
                setCopyError('')
              } catch {
                setCopyError('复制失败，请手动选中正文复制')
              }
            }}
          >
            {copied ? '已复制' : '复制正文'}
          </Button>
        ) : undefined
      }
    >
      {view && (
        <div className="rong-inject-snapshot">
          <div className="rong-inject-summary">
            <strong>{statusLabel}</strong>
            <small>{SOURCE_LABELS[view.resolved.source]} · 只读</small>
          </div>
          {view.resolved.message && <p className="rong-inject-error">{view.resolved.message}</p>}
          {view.inheritedFrom && (
            <small className="rong-truncate" title={view.inheritedFrom}>
              父会话：{view.inheritedFrom}
            </small>
          )}
          {body ? (
            <>
              <textarea readOnly aria-label="破甲模式正文快照" value={body} />
              {copyError && <small role="alert">{copyError}</small>}
            </>
          ) : view.resolved.status === 'off' ? (
            <p className="rong-inject-muted">此会话未启用破甲模式。</p>
          ) : null}
        </div>
      )}
    </Modal>
  )
}

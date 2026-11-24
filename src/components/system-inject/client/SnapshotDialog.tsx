/** 已冻结会话的只读破甲快照弹窗；独立管理剪贴板复制反馈。 */

import { useState } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionView } from '../shared/protocol.ts'
import { SOURCE_LABELS } from '../shared/state.ts'
import { Dialog } from './Dialog.tsx'

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
    <Dialog
      open={open}
      onClose={onClose}
      title="破甲模式快照"
      size={body ? 'content' : 'notice'}
      headerActions={
        body && (
          <Button
            size="sm"
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
        )
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
            <small className="rong-inject-truncate" title={view.inheritedFrom}>
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
    </Dialog>
  )
}

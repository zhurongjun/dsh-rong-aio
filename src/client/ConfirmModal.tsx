import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

export interface ConfirmModalProps {
  open: boolean
  title: string
  description?: string
  tone?: 'warning'
  closeLabel?: string
  cancelLabel?: string
  confirmLabel: string
  confirmIcon?: ReactNode
  destructive?: boolean
  busy?: boolean
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}

export function ConfirmModal({
  open,
  title,
  description,
  tone,
  closeLabel = '关闭',
  cancelLabel = '取消',
  confirmLabel,
  confirmIcon,
  destructive = false,
  busy = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      tone={tone}
      closeLabel={closeLabel}
      description={description}
      footer={
        <>
          <Button variant="outline" data-modal-autofocus disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'outline' : 'primary'}
            className={clsx(destructive && 'rong-danger-button rong-danger-confirm')}
            icon={confirmIcon}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

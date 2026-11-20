import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

export function SideError({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null
  return (
    <div role="alert" className="rong-side-error">
      {message}
      {retry && (
        <Button size="sm" onClick={retry}>
          重试
        </Button>
      )}
    </div>
  )
}

interface ConfirmProps {
  title: string
  description: string
  action: string
  destructive?: boolean
  close: () => void
  confirm: () => void
}

export function ConfirmDialog({
  title,
  description,
  action,
  destructive,
  close,
  confirm,
}: ConfirmProps) {
  return (
    <Modal
      open
      closeLabel="关闭"
      title={title}
      description={description}
      onClose={close}
      footer={
        <>
          <Button data-modal-autofocus onClick={close}>
            取消
          </Button>
          <Button
            variant="outline"
            className={destructive ? 'rong-side-delete' : undefined}
            onClick={() => {
              close()
              confirm()
            }}
          >
            {action}
          </Button>
        </>
      }
    />
  )
}

import { useStore } from 'zustand'
import {
  Button,
  InlineEditor,
  IconLoadingOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { PermissionControl } from './PermissionControl.tsx'
import type { SideClient } from './store.ts'

export function DraftComposer({ store }: { store: SideClient }) {
  const draft = useStore(store.view, (s) => (s.phase.kind === 'draft' ? s.phase.draft : undefined))
  const busy = useStore(store.view, (s) => s.busy)
  const creating = useStore(
    store.view,
    (s) => s.phase.kind === 'draft' && !!s.phase.creatingSessionId,
  )
  const sending = !!draft && busy

  return (
    <div className="rong-side-draft">
      <div className="rong-side-draft-card">
        <div className="rong-side-draft-field">
          {draft && (
            <InlineEditor
              key={draft.key}
              label="侧聊消息"
              value={draft.text}
              onChange={(text) => store.edit(text)}
              onSave={() => void store.send()}
              onCancel={() => {
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
              }}
            />
          )}
          {!draft?.text && (
            <span className="rong-side-placeholder" aria-hidden="true">
              发送侧聊消息…
            </span>
          )}
        </div>
        <div className="rong-side-draft-actions">
          <PermissionControl store={store} />
          <Button
            className="rong-side-send"
            aria-busy={sending}
            aria-label="发送侧聊消息"
            title={sending ? '正在发送' : '发送'}
            disabled={busy || creating || !draft?.text.trim()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void store.send()}
            icon={
              sending ? (
                <IconLoadingOutlineRegular size={16} className="rong-side-spin" />
              ) : (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path
                    d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"
                    fill="currentColor"
                  />
                </svg>
              )
            }
          />
        </div>
      </div>
      <div className="rong-side-status-space" aria-hidden="true" />
    </div>
  )
}

/** 模板编辑表单：独立持有未保存草稿、脏检查与改名/放弃确认。 */

import { useState } from 'react'
import { Button, Input, IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Command, ConfigView } from '../shared/protocol.ts'
import { validatePromptInput, type Prompt, type Scope } from '../shared/state.ts'
import { Dialog } from './Dialog.tsx'
import { ImpactConfirmDialog } from './ImpactConfirmDialog.tsx'
import { ScopeChoice } from './ScopeChoice.tsx'

export function PromptEditor({
  initial,
  initialScope,
  file,
  revision,
  workspace,
  paths,
  saving,
  references,
  onSave,
  onClose,
  onError,
}: {
  initial: Prompt
  initialScope: Scope
  file?: string
  revision: string
  workspace: string
  paths: ConfigView['paths']
  saving: boolean
  references: Record<string, string[]>
  onSave: (command: Extract<Command, { type: 'save-template' }>) => Promise<boolean>
  onClose: () => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState<Prompt>(() => ({ ...initial }))
  const [scope, setScope] = useState<Scope>(initialScope)
  const [discarding, setDiscarding] = useState(false)
  const [confirmRename, setConfirmRename] = useState(false)

  const dirty =
    scope !== initialScope ||
    draft.name !== initial.name ||
    draft.display_name !== initial.display_name ||
    draft.description !== initial.description ||
    draft.body !== initial.body

  const back = () => {
    if (dirty) setDiscarding(true)
    else onClose()
  }

  const save = async (confirmed = false) => {
    const parsed = validatePromptInput(draft)
    if (!parsed) {
      onError('请检查短标识和正文；name 仅允许字母、数字、点、连字符和下划线，最多 120 字符')
      return
    }
    const affected = references[initial.name] ?? []
    if (!confirmed && file && initial.name !== draft.name && affected.length) {
      setConfirmRename(true)
      return
    }
    if (
      await onSave({
        type: 'save-template',
        revision,
        scope,
        file,
        template: parsed,
        confirmed,
      })
    ) {
      onClose()
    } else {
      setConfirmRename(false)
    }
  }

  return (
    <>
      <div className="rong-inject-editor-header">
        <Button
          size="sm"
          icon={<IconChevronLeftOutlineRegular />}
          aria-label="返回模板库"
          title="返回模板库"
          disabled={saving}
          onClick={back}
        />
        <strong className="rong-inject-editor-title">{file ? '编辑破甲词' : '新建破甲词'}</strong>
        <Button
          size="sm"
          variant="primary"
          disabled={saving || !draft.name || !draft.body.trim()}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
      <div className="rong-inject-editor-layout">
        <div className="rong-inject-editor-meta">
          <ScopeChoice
            disabled={saving || !!file}
            value={scope}
            workspace={workspace}
            onChange={setScope}
            path={file ?? paths[scope] ?? ''}
          />
          <label className="rong-inject-field">
            短标识（name）
            <Input
              value={draft.name}
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <small>用于引用。修改后原名称的引用不会自动更新。</small>
          </label>
          <label className="rong-inject-field">
            显示名称（可选）
            <Input
              value={draft.display_name}
              placeholder={draft.name}
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, display_name: event.target.value })}
            />
          </label>
          <label className="rong-inject-field">
            简介（可选）
            <Input
              value={draft.description}
              maxLength={500}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
        </div>
        <label className="rong-inject-field rong-inject-body-field">
          <span className="rong-inject-body-heading">正文</span>
          <textarea
            className="rong-inject-body"
            value={draft.body}
            maxLength={200000}
            spellCheck={false}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        </label>
      </div>
      <Dialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="放弃未保存的修改？"
        actions={
          <>
            <Button size="sm" onClick={() => setDiscarding(false)}>
              继续编辑
            </Button>
            <Button size="sm" variant="primary" onClick={onClose}>
              放弃修改
            </Button>
          </>
        }
      >
        <p>返回模板库后，本次未保存的修改将不会保留。</p>
      </Dialog>
      <ImpactConfirmDialog
        target={
          confirmRename ? { kind: 'rename', references: references[initial.name] ?? [] } : null
        }
        saving={saving}
        onCancel={() => setConfirmRename(false)}
        onConfirm={() => void save(true)}
      />
    </>
  )
}

import { useId, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  Button,
  Input,
  SegmentedTabs,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { errorMessage } from '../../../shared/error.ts'
import type { Route } from '../shared/protocol.ts'
import type { CatalogPrompt, Prompt, Scope } from '../shared/state.ts'
import { ImpactConfirmDialog } from './Dialogs.tsx'
import { PromptEditor } from './PromptEditor.tsx'
import type { InjectStore } from './store.ts'
import { TemplateLibrary, type LibraryView } from './TemplateLibrary.tsx'
import { routeKey, Whitelist } from './Whitelist.tsx'

interface EditingSession {
  key: number
  prompt: Prompt
  scope: Scope
  file?: string
  revision: string
}

export function Settings({ store }: { store: InjectStore }) {
  const data = useStore(store, (state) => state.data)
  const error = useStore(store, (state) => state.error)
  const saving = useStore(store, (state) => state.saving)
  const verified = useStore(store, (state) => state.verified)

  const [tab, setTab] = useState<'templates' | 'whitelist'>('templates')
  const [library, setLibrary] = useState<LibraryView>({
    query: '',
    expanded: { user: true, workspace: true },
  })
  const [editing, setEditing] = useState<EditingSession>()
  const [nextEditKey, setNextEditKey] = useState(1)
  const [localError, setLocalError] = useState('')
  const [deleting, setDeleting] = useState<{ template: CatalogPrompt; revision: string }>()
  const fileRef = useRef<HTMLInputElement>(null)
  const uid = useId()

  const config = data?.config

  const updateWhitelist = (route: Route, adding: boolean) => {
    const current = store.getState()
    const latest = current.data?.config
    if (!latest || current.saving || !current.verified) return

    const exists = latest.whitelist.some((item) => routeKey(item) === routeKey(route))
    if (exists === adding) return

    void store.execute({
      type: 'whitelist',
      revision: latest.revision,
      routes: adding
        ? [...latest.whitelist, route]
        : latest.whitelist.filter((item) => routeKey(item) !== routeKey(route)),
    })
  }

  const openEditor = (prompt: Prompt, file?: CatalogPrompt) => {
    if (!config) return
    setEditing({
      key: nextEditKey,
      prompt: {
        name: prompt.name,
        display_name: prompt.display_name,
        description: prompt.description,
        body: prompt.body,
      },
      scope: file?.scope ?? 'user',
      file: file?.file,
      revision: config.revision,
    })
    setNextEditKey((current) => current + 1)
    setLocalError('')
  }

  const closeEditor = () => {
    setEditing(undefined)
    setLocalError('')
  }

  const download = async (template: Prompt) => {
    try {
      const markdown = await store.formatMarkdown(template)
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${template.name}.md`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (failure) {
      setLocalError(errorMessage(failure, '导出失败'))
    }
  }

  const importFile = async (file?: File) => {
    if (!file) return
    if (file.size > 840_000) {
      setLocalError('Markdown 文件过大')
      return
    }
    try {
      openEditor(await store.parseMarkdown(await file.text()))
    } catch (failure) {
      setLocalError(errorMessage(failure, '导入失败'))
    }
  }

  if (!config || !data) {
    return (
      <div className="rong-inject-settings">
        <p role="status">{error ?? '正在读取破甲模式设置…'}</p>
        <Button onClick={() => void store.refresh()}>重试</Button>
      </div>
    )
  }

  const disabled = saving || !verified

  return (
    <div className="rong-inject-settings">
      {(error || localError || config.errors.length > 0) && (
        <div role="alert" className="rong-inject-error">
          {localError || error || config.errors.join('；')}
          <Button
            size="sm"
            onClick={() => {
              setLocalError('')
              void store.refresh()
            }}
          >
            刷新
          </Button>
        </div>
      )}
      {editing ? (
        <PromptEditor
          key={editing.key}
          initial={editing.prompt}
          initialScope={editing.scope}
          file={editing.file}
          revision={editing.revision}
          workspace={config.workspace}
          paths={config.paths}
          saving={saving}
          references={data.references}
          onSave={(command) => store.execute(command)}
          onClose={closeEditor}
          onError={setLocalError}
        />
      ) : (
        <>
          <SegmentedTabs
            label="破甲模式设置"
            value={tab}
            onChange={setTab}
            items={[
              {
                value: 'templates',
                label: '模板库',
                id: uid + 'templates',
                panelId: uid + 'panel',
              },
              {
                value: 'whitelist',
                label: '模型白名单',
                id: uid + 'whitelist',
                panelId: uid + 'panel',
              },
            ]}
          />
          <section
            role="tabpanel"
            id={uid + 'panel'}
            aria-labelledby={uid + tab}
            className="rong-inject-panel"
          >
            {tab === 'templates' && (
              <>
                <div className="rong-inject-toolbar">
                  <Input
                    aria-label="搜索破甲词"
                    icon={<IconSearchOutlineRegular />}
                    placeholder="搜索破甲词"
                    type="search"
                    value={library.query}
                    onChange={(event) =>
                      setLibrary({
                        query: event.target.value,
                        expanded: { user: true, workspace: true },
                      })
                    }
                  />
                  <Button size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
                    导入
                  </Button>
                  <Button
                    size="sm"
                    disabled={disabled}
                    variant="primary"
                    icon={<IconPlusOutlineRegular />}
                    onClick={() =>
                      openEditor({ name: '', display_name: '', description: '', body: '' })
                    }
                  >
                    新建
                  </Button>
                </div>
                <input
                  hidden
                  ref={fileRef}
                  type="file"
                  accept=".md,text/markdown"
                  onChange={(event) => {
                    void importFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                <TemplateLibrary
                  templates={config.templates}
                  workspace={config.workspace}
                  view={library}
                  onViewChange={setLibrary}
                  disabled={disabled}
                  onEdit={(template) => openEditor(template, template)}
                  onExport={(template) => void download(template)}
                  onDelete={(template) => setDeleting({ template, revision: config.revision })}
                />
              </>
            )}
            {tab === 'whitelist' && (
              <Whitelist
                whitelist={config.whitelist}
                routes={data.routes}
                catalogErrors={data.catalogErrors}
                disabled={disabled}
                onAdd={(route) => updateWhitelist(route, true)}
                onRemove={(route) => updateWhitelist(route, false)}
              />
            )}
          </section>
        </>
      )}
      <ImpactConfirmDialog
        target={
          deleting
            ? {
                kind: 'delete',
                displayName: deleting.template.display_name,
                references: data.references[deleting.template.name] ?? [],
              }
            : null
        }
        saving={saving}
        onCancel={() => setDeleting(undefined)}
        onConfirm={async () => {
          if (
            deleting &&
            (await store.execute({
              type: 'delete-template',
              revision: deleting.revision,
              file: deleting.template.file,
              confirmed: true,
            }))
          ) {
            setDeleting(undefined)
          }
        }}
      />
    </div>
  )
}

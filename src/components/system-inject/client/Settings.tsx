/** 设置编排：组织模板编辑、引用确认和白名单保存；范围由传入 store 固定。 */

import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  Button,
  Input,
  SegmentedTabs,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  IconChevronLeftOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { exportMarkdown, importMarkdown } from '../shared/markdown.ts'
import { promptSchema, type CatalogPrompt, type Prompt, type Scope } from '../shared/state.ts'
import type { InjectStore } from './store.ts'
import { Dialog } from './Dialog.tsx'
import { ScopeChoice } from './ScopeChoice.tsx'
import { TemplateLibrary, type LibraryView } from './TemplateLibrary.tsx'
import { Whitelist } from './Whitelist.tsx'
import { routeKey } from './whitelist-models.ts'
import type { Route } from '../shared/protocol.ts'

/** 编辑草稿与打开时的内容版本；显式保存前不写磁盘，已有文件保持原保存范围。 */
interface Editor {
  /** 可编辑的破甲词正文和元信息副本。 */
  prompt: Prompt

  /** 新建文件的目标范围；已有文件不允许更改。 */
  scope: Scope

  /** 已有文件的绝对路径，缺省表示新建/导入草稿。 */
  file?: string

  /** 开始编辑时的设置组合指纹，防止外部修改被覆盖。 */
  revision: string
}

/**
 * 模板库与白名单共用的管理界面。store 的范围不可变，页面只维护尚未保存的编辑草稿。
 * 保存结果以宿主响应为准；改名/删除引用确认、放弃编辑确认均不提前改变文件。
 */
export function Settings({ store }: { store: InjectStore }) {
  const data = useStore(store, (state) => state.data)
  const error = useStore(store, (state) => state.error)
  const saving = useStore(store, (state) => state.saving)
  const verified = useStore(store, (state) => state.verified)

  // 页面局部状态：标签页和库视图保留，编辑器及确认窗按一次编辑过程管理。
  const [tab, setTab] = useState<'templates' | 'whitelist'>('templates')
  const [library, setLibrary] = useState<LibraryView>({
    query: '',
    expanded: { user: true, workspace: true },
  })
  const [editor, setEditor] = useState<Editor>()
  const original = useRef<Editor>()
  const [discarding, setDiscarding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [localError, setLocalError] = useState('')
  const [deleting, setDeleting] = useState<{ template: CatalogPrompt; revision: string }>()
  const fileRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  useEffect(() => store.retain(), [store])

  // 权威文件投影与编辑动作：操作使用响应版本，禁止用本地猜测补齐保存结果。
  const config = data?.config

  /** 读取最新权威版本后新增/移除精确路由，避免快速点击基于旧渲染覆盖新授权。 */
  const updateWhitelist = (route: Route, adding: boolean) => {
    // 从权威 store 取最新版本，阻止快速连点或迟到渲染覆盖已确认授权。
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

  /** 从模板投影创建独立编辑草稿，并记住原值供退出/改名检测。 */
  const edit = (prompt: Prompt, file?: CatalogPrompt) => {
    const value: Editor = {
      prompt: {
        name: prompt.name,
        display_name: prompt.display_name,
        description: prompt.description,
        body: prompt.body,
      },
      scope: file?.scope ?? 'user',
      file: file?.file,
      revision: config!.revision,
    }
    original.current = structuredClone(value)
    setEditor(value)
    setLocalError('')
  }

  /** 清理编辑器及相关确认窗；不重置模板库搜索和折叠状态。 */
  const closeEditor = () => {
    setEditor(undefined)
    setDiscarding(false)
    setRenaming(false)
    setLocalError('')
  }

  /** 仅在草稿相对原值发生变化时要求放弃确认，否则直接返回库。 */
  const back = () => {
    if (JSON.stringify(editor) !== JSON.stringify(original.current)) setDiscarding(true)
    else closeEditor()
  }

  /** 校验草稿，再对影响已知引用的改名请求确认；宿主保存成功后才关闭编辑器。 */
  const save = async (confirmed = false) => {
    if (!editor) return
    const parsed = promptSchema.safeParse(editor.prompt)
    if (!parsed.success) {
      setLocalError('请检查短标识和正文；name 仅允许字母、数字、点、连字符和下划线，最多 120 字符')
      return
    }
    const oldName = original.current?.prompt.name
    if (
      !confirmed &&
      editor.file &&
      oldName !== editor.prompt.name &&
      data?.references[oldName ?? '']?.length
    ) {
      setRenaming(true)
      return
    }
    if (
      await store.execute({
        type: 'save-template',
        revision: editor.revision,
        scope: editor.scope,
        file: editor.file,
        template: parsed.data,
        confirmed,
      })
    )
      closeEditor()
    else setRenaming(false)
  }

  /** 生成受支持的 Markdown 文件并触发浏览器下载；临时对象 URL 随后释放。 */
  const download = (template: Prompt) => {
    const url = URL.createObjectURL(
      new Blob([exportMarkdown(template)], { type: 'text/markdown;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = template.name + '.md'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /** 读取用户选择的 Markdown 并打开草稿；导入不会直接保存、授权或开启破甲。 */
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 840_000) throw new Error('Markdown 文件过大')
      edit(importMarkdown(await file.text()))
    } catch (failure) {
      setLocalError(failure instanceof Error ? failure.message : '导入失败')
    }
  }

  // 首次读取与诊断：未取得有效设置投影时只提供加载/重试，不显示可保存空配置。
  if (!config || !data)
    return (
      <div className="rong-inject-settings">
        <p role="status">{error ?? '正在读取破甲模式设置…'}</p>
        <Button onClick={() => void store.refresh()}>重试</Button>
      </div>
    )
  const disabled = saving || !verified
  const oldName = original.current?.prompt.name ?? ''
  const affected = renaming
    ? (data.references[oldName] ?? [])
    : deleting
      ? (data.references[deleting.template.name] ?? [])
      : []
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
      {editor ? (
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
            <strong className="rong-inject-editor-title">
              {editor.file ? '编辑破甲词' : '新建破甲词'}
            </strong>
            <Button
              size="sm"
              variant="primary"
              disabled={saving || !editor.prompt.name || !editor.prompt.body.trim()}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
          <div className="rong-inject-editor-layout">
            <div className="rong-inject-editor-meta">
              <ScopeChoice
                disabled={saving || !!editor.file}
                value={editor.scope}
                workspace={config.workspace}
                onChange={(scope) => setEditor({ ...editor, scope })}
                path={editor.file ?? config.paths[editor.scope] ?? ''}
              />
              <label className="rong-inject-field">
                短标识（name）
                <Input
                  value={editor.prompt.name}
                  maxLength={120}
                  onChange={(event) =>
                    setEditor({ ...editor, prompt: { ...editor.prompt, name: event.target.value } })
                  }
                />
                <small>用于引用。修改后原名称的引用不会自动更新。</small>
              </label>
              <label className="rong-inject-field">
                显示名称（可选）
                <Input
                  value={editor.prompt.display_name}
                  placeholder={editor.prompt.name}
                  maxLength={120}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      prompt: { ...editor.prompt, display_name: event.target.value },
                    })
                  }
                />
              </label>
              <label className="rong-inject-field">
                简介（可选）
                <Input
                  value={editor.prompt.description}
                  maxLength={500}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      prompt: { ...editor.prompt, description: event.target.value },
                    })
                  }
                />
              </label>
            </div>
            <label className="rong-inject-field rong-inject-body-field">
              <span className="rong-inject-body-heading">正文</span>
              <textarea
                className="rong-inject-body"
                value={editor.prompt.body}
                maxLength={200000}
                spellCheck={false}
                onChange={(event) =>
                  setEditor({ ...editor, prompt: { ...editor.prompt, body: event.target.value } })
                }
              />
            </label>
          </div>
        </>
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
                    onClick={() => edit({ name: '', display_name: '', description: '', body: '' })}
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
                  onEdit={(template) => edit(template, template)}
                  onExport={download}
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
      <Dialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="放弃未保存的修改？"
        actions={
          <>
            <Button size="sm" onClick={() => setDiscarding(false)}>
              继续编辑
            </Button>
            <Button size="sm" variant="primary" onClick={closeEditor}>
              放弃修改
            </Button>
          </>
        }
      >
        <p>返回模板库后，本次未保存的修改将不会保留。</p>
      </Dialog>
      <Dialog
        open={renaming || !!deleting}
        onClose={() => {
          setRenaming(false)
          setDeleting(undefined)
        }}
        title={renaming ? '修改引用名称？' : '删除破甲词？'}
        actions={
          <>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => {
                setRenaming(false)
                setDeleting(undefined)
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={saving}
              onClick={async () => {
                if (renaming) await save(true)
                else if (
                  deleting &&
                  (await store.execute({
                    type: 'delete-template',
                    revision: deleting.revision,
                    file: deleting.template.file,
                    confirmed: true,
                  }))
                )
                  setDeleting(undefined)
              }}
            >
              {renaming ? '确认改名' : '确认删除'}
            </Button>
          </>
        }
      >
        <p>
          {renaming
            ? '原名称的引用不会自动更新。'
            : `删除“${deleting?.template.display_name ?? ''}”？`}
          已冻结会话继续使用原快照。
        </p>
        {!!affected.length && (
          <div className="rong-inject-impact">
            <strong>以下 {affected.length} 处引用将失效</strong>
            <ul>
              {affected.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="rong-inject-muted">范围限于当前宿主的未发送会话。</p>
      </Dialog>
    </div>
  )
}

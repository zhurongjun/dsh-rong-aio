/** 模板库视图：全局/工程分组、搜索和卡片操作；数据修改交给设置页。 */

import { useId, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconEllipsisOutlineRegular,
  Menu,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogPrompt, Scope } from '../shared/state.ts'

/** 由设置页持有的库视图状态，进入编辑器再返回时保持搜索和折叠位置。 */
export interface LibraryView {
  /** 本地搜索文本，同时匹配索引、显示名称和简介。 */
  query: string

  /** 全局和工程分组各自的展开状态。 */
  expanded: Record<Scope, boolean>
}

/** 仅组织展示，不解析注入状态。范围来自入口，搜索和折叠状态由设置页保留到编辑返回。 */
export function TemplateLibrary({
  templates,
  workspace,
  view,
  onViewChange,
  disabled,
  onEdit,
  onExport,
  onDelete,
}: {
  /** 宿主扫描所得文件投影，包含冲突和来源。 */
  templates: CatalogPrompt[]

  /** 入口绑定工程；空字符串时只渲染全局组。 */
  workspace: string

  /** 设置页持有的查询与折叠状态。 */
  view: LibraryView

  /** 将视图变动写回设置页，不持久化到磁盘。 */
  onViewChange: (view: LibraryView) => void

  /** 保存中或读取未确认时禁用文件操作。 */
  disabled: boolean

  /** 打开选中模板的独立编辑草稿。 */
  onEdit: (template: CatalogPrompt) => void

  /** 导出指定模板，不修改会话或授权。 */
  onExport: (template: CatalogPrompt) => void

  /** 交给设置页确认引用影响后再删除。 */
  onDelete: (template: CatalogPrompt) => void
}) {
  const id = useId()
  const [menu, setMenu] = useState('')
  const query = view.query.trim().toLocaleLowerCase()
  const scopes: Scope[] = workspace ? ['user', 'workspace'] : ['user']
  return (
    <div className="rong-inject-library">
      {scopes.map((scope) => {
        const label = scope === 'user' ? '全局' : '工程'
        const all = templates.filter((template) => template.scope === scope)
        const matches = all.filter((template) =>
          [template.name, template.display_name, template.description].some((value) =>
            value.toLocaleLowerCase().includes(query),
          ),
        )
        const open = view.expanded[scope]
        const groupId = `${id}-${scope}`
        return (
          <section className="rong-inject-library-group" key={scope} aria-labelledby={groupId}>
            <h3 className="rong-inject-library-heading">
              <Button
                className="rong-inject-library-toggle"
                id={groupId}
                aria-expanded={open}
                aria-controls={`${groupId}-body`}
                onClick={() => {
                  setMenu('')
                  onViewChange({ ...view, expanded: { ...view.expanded, [scope]: !open } })
                }}
              >
                <IconChevronDownOutlineRegular size={12} />
                <span>{label}</span>
                <small>{query ? `${matches.length} / ${all.length}` : all.length}</small>
              </Button>
            </h3>
            <div id={`${groupId}-body`} hidden={!open}>
              {matches.length ? (
                <ul className="rong-inject-template-grid" aria-label={`${label}破甲词`}>
                  {matches.map((template) => (
                    <li className="rong-inject-template-card" key={template.file}>
                      <Button
                        className="rong-inject-template-content"
                        disabled={disabled}
                        aria-label={`编辑${template.display_name}（${template.name}）`}
                        onClick={() => onEdit(template)}
                      >
                        <strong
                          className="rong-inject-template-title"
                          title={template.display_name}
                        >
                          {template.display_name}
                        </strong>
                        {template.description && (
                          <span
                            className="rong-inject-template-description"
                            title={template.description}
                          >
                            {template.description}
                          </span>
                        )}
                        <span className="rong-inject-template-meta">
                          <code className="rong-inject-template-identity" title={template.name}>
                            {template.name}
                          </code>
                          {template.conflict && <Tag tone="danger">名称冲突</Tag>}
                        </span>
                      </Button>
                      <Menu
                        open={menu === template.file && open}
                        onClose={() => setMenu('')}
                        portal
                        align="end"
                        compact
                        className="rong-inject-template-actions"
                        anchor={
                          <Button
                            size="sm"
                            disabled={disabled}
                            icon={<IconEllipsisOutlineRegular />}
                            aria-label={`${template.display_name}的操作`}
                            aria-haspopup="menu"
                            aria-expanded={menu === template.file && open}
                            onClick={() => setMenu(menu === template.file ? '' : template.file)}
                          />
                        }
                        items={[
                          { id: 'edit', label: '编辑' },
                          { id: 'export', label: '导出 Markdown' },
                          { id: 'delete', label: '删除', danger: true },
                        ]}
                        onSelect={(action) => {
                          setMenu('')
                          if (action === 'edit') onEdit(template)
                          else if (action === 'export') onExport(template)
                          else onDelete(template)
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rong-inject-library-empty" role="status">
                  {query ? '没有匹配的破甲词' : `暂无${label}破甲词，可新建或导入 Markdown。`}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

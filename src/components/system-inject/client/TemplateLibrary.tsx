import { useId, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconEllipsisOutlineRegular,
  Menu,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogPrompt, Scope } from '../shared/state.ts'

export interface LibraryView {
  query: string
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
  templates: CatalogPrompt[]
  workspace: string
  view: LibraryView
  onViewChange: (view: LibraryView) => void
  disabled: boolean
  onEdit: (template: CatalogPrompt) => void
  onExport: (template: CatalogPrompt) => void
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

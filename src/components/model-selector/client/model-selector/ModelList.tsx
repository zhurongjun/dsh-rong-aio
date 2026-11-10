/** 模型列表视图：按提供商分组，用扁平索引统一键盘高亮与滚动定位。 */

import { forwardRef, memo, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import {
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelCatalogModel,
  ModelProviderGroup,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SelectorStore } from './selector-store.ts'
import { SelectionButton } from './SelectionButton.tsx'

/** 本视图所需的输入契约；数据保存与宿主副作用由外层负责。 */
interface Props {
  /** 选择器瞬时 store，列表只订阅高亮位置。 */
  store: SelectorStore

  /** 过滤后的提供商组及在扁平列表中的起始偏移。 */
  groups: { group: ModelProviderGroup; offset: number }[]

  /** 过滤后的模型总行数，用于空态及 aria 索引。 */
  rowCount: number

  /** 外层搜索值；本组件把修改委托给 store。 */
  query: string

  /** 宿主已接受的精确模型选择，用于勾选。 */
  current: ModelSelection | null

  /** 保存期间阻止选行，保留目录与勾选的视觉状态。 */
  busy: boolean

  /** 宿主会话锁，属于真正不可用状态。 */
  locked: boolean

  /** 当前是否有可返回的强度面板。 */
  hasModel: boolean

  /** 宿主模型目录加载阶段，区分加载与空目录。 */
  status: ModelDirectoryState['status']

  /** 同一个弹层的稳定可访问性 ID 前缀。 */
  id: string

  /** 向外层提交模型；本列表不直接写入宿主。 */
  chooseModel(provider: string, model: ModelCatalogModel): Promise<void>
}

/** 分组模型列表；ref 指向搜索框，焦点和整体键盘移动由外层选择器协调。 */
export const ModelList = memo(
  forwardRef<HTMLInputElement, Props>(function ModelList(
    { store, groups, rowCount, query, current, busy, locked, hasModel, status, id, chooseModel },
    ref,
  ) {
    const highlight = useStore(store, (state) => state.highlight)
    const actions = store.getState().actions
    const list = useRef<HTMLDivElement>(null)
    useEffect(() => {
      list.current
        ?.querySelector(`[data-model-index="${highlight}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }, [highlight])
    return (
      <div className="rong-models-pane" key="models">
        <div className="rong-models-toolbar">
          <button
            className="rong-icon-button rong-models-back"
            type="button"
            aria-label="返回强度选择"
            disabled={!hasModel}
            onClick={() => actions.setPane('effort')}
          >
            <IconChevronLeftOutlineRegular size={18} />
          </button>
          <div className="rong-search">
            <IconSearchOutlineRegular size={16} />
            <input
              ref={ref}
              placeholder="搜索模型…"
              aria-label="搜索模型"
              value={query}
              onChange={(event) => {
                actions.search(event.target.value)
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={highlight < rowCount ? `${id}-option-${highlight}` : undefined}
            />
          </div>
        </div>
        <div
          ref={list}
          className="rong-model-list"
          role="listbox"
          id={`${id}-list`}
          aria-label="模型"
        >
          {groups.map(({ group, offset }) => (
            <div key={group.id} role="group" aria-label={group.name}>
              <div className="rong-provider-name">{group.name}</div>
              {group.models.map((entry, modelIndex) => {
                const rowIndex = offset + modelIndex
                const selected = current?.provider === group.id && current.model === entry.id
                return (
                  <SelectionButton
                    role="option"
                    key={entry.id}
                    id={`${id}-option-${rowIndex}`}
                    tabIndex={-1}
                    data-model-index={rowIndex}
                    data-highlighted={rowIndex === highlight || undefined}
                    aria-selected={selected}
                    disabled={locked}
                    busy={busy}
                    className="rong-model-option"
                    onPointerMove={() => actions.highlight(rowIndex)}
                    onClick={() => void chooseModel(group.id, entry)}
                  >
                    <span title={entry.name}>{entry.name}</span>
                    {selected && <IconCheckOutlineRegular size={18} />}
                  </SelectionButton>
                )
              })}
            </div>
          ))}
          {!rowCount && (
            <p className="rong-empty">
              {status === 'loading' ? '正在加载模型…' : query ? '没有匹配的模型' : '暂无可用模型'}
            </p>
          )}
        </div>
      </div>
    )
  }),
)

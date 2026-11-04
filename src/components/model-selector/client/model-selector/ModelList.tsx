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

interface Props {
  store: SelectorStore
  groups: { group: ModelProviderGroup; offset: number }[]
  rowCount: number
  query: string
  current: ModelSelection | null
  busy: boolean
  hasModel: boolean
  status: ModelDirectoryState['status']
  id: string
  chooseModel(provider: string, model: ModelCatalogModel): Promise<void>
}

export const ModelList = memo(
  forwardRef<HTMLInputElement, Props>(function ModelList(
    { store, groups, rowCount, query, current, busy, hasModel, status, id, chooseModel },
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
                  <button
                    type="button"
                    role="option"
                    key={entry.id}
                    id={`${id}-option-${rowIndex}`}
                    tabIndex={-1}
                    data-model-index={rowIndex}
                    data-highlighted={rowIndex === highlight || undefined}
                    aria-selected={selected}
                    disabled={busy}
                    className="rong-model-option"
                    onPointerMove={() => actions.highlight(rowIndex)}
                    onClick={() => void chooseModel(group.id, entry)}
                  >
                    <span title={entry.name}>{entry.name}</span>
                    {selected && <IconCheckOutlineRegular size={18} />}
                  </button>
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

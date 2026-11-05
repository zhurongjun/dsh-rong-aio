/** 输入框模型入口：显示已确认模型、effort 和 Fast 标记；不发起持久化请求。 */

import { forwardRef, memo } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  IconDataOutlineRegular,
  IconChevronDownOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { FastIcon } from './SelectorIcons.tsx'
import { SPEED_LABELS } from '../../shared/speed.ts'
import type { SelectorStore } from './selector-store.ts'
import type { SpeedStore } from './speed-store.ts'

/** 本视图所需的输入契约；数据保存与宿主副作用由外层负责。 */
interface Props {
  /** 读取主弹层开关与拖动预览。 */
  store: SelectorStore

  /** 读取宿主已确认速度，避免加载状态引起无关渲染。 */
  speedStore: SpeedStore

  /** 当前模型的完整速度身份，用于屏蔽前一路由快照。 */
  speedKey: string

  /** 输入框中展示的当前模型名称。 */
  modelName: string

  /** 预览 ID 对应的明确档位目录。 */
  efforts: readonly ModelReasoningEffort[]

  /** 宿主确认的强度，未明确设置时允许缺省。 */
  selected: ModelReasoningEffort | undefined

  /** 原生会话锁，锁定时禁止打开选择器。 */
  locked: boolean

  /** 主弹层 ID，用于 aria-controls 关联。 */
  id: string

  /** 切换主弹层，由外层处理加载和焦点恢复。 */
  onToggle(): void
}

/** 输入框入口的窄订阅视图；Fast 图标只显示当前路由已经确认的速度。 */
export const SelectorTrigger = memo(
  forwardRef<HTMLButtonElement, Props>(function SelectorTrigger(
    { store, speedStore, speedKey, modelName, efforts, selected, locked, id, onToggle },
    ref,
  ) {
    const { open, preview } = useStore(
      store,
      useShallow((state) => ({ open: state.open, preview: state.preview })),
    )

    // 输入框只关心确认过的速度，不因 GET/PUT 的 loading 状态重新渲染。
    const mode = useStore(speedStore, (state) =>
      state.key === speedKey && state.value.modes.includes(state.value.mode)
        ? state.value.mode
        : 'standard',
    )
    const fastActive = mode !== 'standard'
    const effort = efforts.find((entry) => entry.id === preview) ?? selected
    return (
      <button
        ref={ref}
        type="button"
        className="rong-model-trigger"
        disabled={locked}
        aria-label={`选择模型与推理强度：${modelName}${effort ? `，${effort.name}` : ''}${fastActive ? `，${SPEED_LABELS[mode]}模式` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={onToggle}
      >
        {fastActive ? (
          <span
            className="rong-trigger-fast"
            aria-hidden="true"
            title={`${SPEED_LABELS[mode]}模式`}
          >
            <FastIcon active />
          </span>
        ) : (
          <IconDataOutlineRegular size={16} className="rong-trigger-icon" />
        )}
        <span className="rong-trigger-name">{modelName}</span>
        <span className="rong-trigger-effort">{effort?.name}</span>
        <IconChevronDownOutlineRegular
          size={12}
          className={open ? 'rong-chevron rong-open' : 'rong-chevron'}
        />
      </button>
    )
  }),
)

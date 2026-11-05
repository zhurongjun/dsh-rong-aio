/** 强度标题与模型入口：拖动时展示预览，结束后回到宿主已确认的档位。 */

import { forwardRef, memo } from 'react'
import { useStore } from 'zustand'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SelectorStore } from './selector-store.ts'

/** 本视图所需的输入契约；数据保存与宿主副作用由外层负责。 */
interface Props {
  /** 只订阅拖动预览的选择器 store。 */
  store: SelectorStore

  /** 用于将预览 ID 转换为用户可读名称的明确档位列表。 */
  efforts: readonly ModelReasoningEffort[]

  /** 没有预览时回退到的宿主已确认档位。 */
  selected: ModelReasoningEffort | undefined

  /** 目录展示名或原始模型 ID。 */
  modelName: string

  /** 保存/锁定时禁止进入模型列表。 */
  disabled: boolean

  /** 进入同一弹层内的模型列表。 */
  onClick(): void
}

/** 以预览优先、已选其次的顺序显示强度；模型名入口保持同一按钮与键盘焦点。 */
export const EffortHeading = memo(
  forwardRef<HTMLButtonElement, Props>(function EffortHeading(
    { store, efforts, selected, modelName, disabled, onClick },
    ref,
  ) {
    const preview = useStore(store, (state) => state.preview)
    const effort = efforts.find((entry) => entry.id === preview) ?? selected
    const title = effort?.name ?? (efforts.length ? '请选择强度' : '推理强度')
    return (
      <button
        ref={ref}
        className="rong-model-heading"
        type="button"
        onClick={onClick}
        disabled={disabled}
      >
        <span className="rong-effort-title">{title}</span>
        <span className="rong-model-label">
          <span className="rong-model-name" title={modelName}>
            {modelName}
          </span>
          <IconChevronRightOutlineRegular size={10} />
        </span>
      </button>
    )
  }),
)

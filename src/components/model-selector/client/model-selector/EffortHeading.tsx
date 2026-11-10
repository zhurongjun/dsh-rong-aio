/** 强度标题与模型入口：只展示面板传入的统一档位投影，不维护请求或预览副本。 */

import { forwardRef, memo } from 'react'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { SelectionButton } from './SelectionButton.tsx'

/** 本视图所需的输入契约；数据保存与宿主副作用由外层负责。 */
interface Props {
  /** 用于将预览 ID 转换为用户可读名称的明确档位列表。 */
  efforts: readonly ModelReasoningEffort[]

  /** 面板统一投影后的显示档位，包含手势和待确认预览。 */
  selected: ModelReasoningEffort | undefined

  /** 目录展示名或原始模型 ID。 */
  modelName: string

  /** 宿主锁定属于真正不可用。 */
  disabled: boolean

  /** 主面板退场时保留外观并停止交互。 */
  inactive: boolean

  /** 保存中保留外观和焦点，仅阻止进入模型列表。 */
  busy: boolean

  /** 进入同一弹层内的模型列表。 */
  onClick(): void
}

/** 纯标题视图；短暂忙碌不置灰，模型名入口保持同一按钮与键盘焦点。 */
export const EffortHeading = memo(
  forwardRef<HTMLButtonElement, Props>(function EffortHeading(
    { efforts, selected, modelName, disabled, inactive, busy, onClick },
    ref,
  ) {
    const title = selected?.name ?? (efforts.length ? '请选择强度' : '推理强度')
    return (
      <SelectionButton
        ref={ref}
        className="rong-model-heading"
        onClick={onClick}
        disabled={disabled}
        inactive={inactive}
        busy={busy}
      >
        <span className="rong-effort-title">{title}</span>
        <span className="rong-model-label">
          <span className="rong-model-name" title={modelName}>
            {modelName}
          </span>
          <IconChevronRightOutlineRegular size={10} />
        </span>
      </SelectionButton>
    )
  }),
)

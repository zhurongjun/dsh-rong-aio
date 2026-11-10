/** 强度面板：组合三个工具栏控件和受控滑杆，所有档位文字及运动目标共享同一投影。 */

import { forwardRef, memo } from 'react'
import type {
  ModelCatalogModel,
  ModelReasoningEffort,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { defaultEffortOf } from '../../shared/model-selection.ts'
import type { SelectorStore } from './selector-store.ts'
import type { SpeedStore } from './speed-store.ts'
import { useEffortPreview } from './useEffortPreview.ts'
import { EffortHeading } from './EffortHeading.tsx'
import { EffortSlider } from './EffortSlider.tsx'
import { SpeedControl } from './SpeedControl.tsx'
import { SelectionButton } from './SelectionButton.tsx'
import { ResetIcon } from './SelectorIcons.tsx'

interface Props {
  /** 会话交互和速度 store；仅订阅本面板使用的投影。 */
  store: SelectorStore
  speedStore: SpeedStore
  /** 档位目录与速度各自的路由身份；effort 不属于速度身份。 */
  routeKey: string
  speedRoute: string
  /** 下列数据只来自宿主已确认选择。 */
  model: ModelCatalogModel | undefined
  modelName: string
  efforts: readonly ModelReasoningEffort[]
  selected: ModelReasoningEffort | undefined
  /** 关闭只停止交互；宿主锁表示不可用，提交中只阻止操作而不改变图标外观。 */
  open: boolean
  locked: boolean
  selecting: boolean
  onPreview(effort: string | undefined): void
  chooseEffort(effort: string, kind?: 'effort' | 'reset'): Promise<boolean>
  showModels(): void
}

/** ref 指向标题供外层恢复焦点；只有路由变化重建滑杆手势与运动实例。 */
export const EffortPanel = memo(
  forwardRef<HTMLButtonElement, Props>(function EffortPanel(
    {
      store,
      speedStore,
      routeKey,
      speedRoute,
      model,
      modelName,
      efforts,
      selected,
      open,
      locked,
      selecting,
      onPreview,
      chooseEffort,
      showModels,
    },
    ref,
  ) {
    const effortId = useEffortPreview(store, routeKey, selected?.id)
    const displayed = efforts.find((entry) => entry.id === effortId) ?? selected
    const resetEffort = model ? defaultEffortOf(model) : undefined

    return (
      <div className="rong-effort-pane">
        <div className="rong-effort-header">
          <SpeedControl
            store={speedStore}
            identityKey={speedRoute}
            open={open}
            disabled={locked}
            busy={selecting}
          />
          <EffortHeading
            ref={ref}
            efforts={efforts}
            selected={displayed}
            modelName={modelName}
            disabled={locked}
            inactive={!open}
            busy={selecting}
            onClick={showModels}
          />
          <SelectionButton
            className="rong-icon-button rong-header-action"
            aria-label="重置当前模型的推理强度"
            title="重置强度"
            disabled={locked || !resetEffort}
            inactive={!open}
            busy={selecting}
            onClick={() => {
              if (resetEffort) void chooseEffort(resetEffort, 'reset')
            }}
          >
            <ResetIcon />
          </SelectionButton>
        </div>
        {efforts.length ? (
          <EffortSlider
            key={routeKey}
            efforts={efforts}
            selected={displayed?.id}
            disabled={locked || !open}
            busy={selecting}
            onPreview={onPreview}
            onCommit={chooseEffort}
          />
        ) : (
          <p className="rong-empty">
            {model ? '此模型未提供可选推理强度' : '当前模型不可用，请重新选择'}
          </p>
        )}
      </div>
    )
  }),
)

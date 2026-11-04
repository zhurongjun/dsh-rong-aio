/** 破甲组件内部的拒绝通知协议；模型选择 UI 无须识别该错误码。 */
export const INJECT_SELECTION_ERROR = 'rong-aio/inject-selection-rejected'

export function isInjectSelectionError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === INJECT_SELECTION_ERROR
  )
}

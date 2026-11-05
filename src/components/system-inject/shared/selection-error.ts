/** 组件内部的结构化拒绝标识，用于区分未提交的选择与结果未知的通信失败。 */

/** 破甲组件内部的拒绝通知协议；模型选择 UI 无须识别该错误码。 */
export const INJECT_SELECTION_ERROR = 'rong-aio/inject-selection-rejected'

/** 仅识别结构化对象上的组件拒绝码；不从普通文本、选模目录错误或网络错误猜测。 */
export function isInjectSelectionError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === INJECT_SELECTION_ERROR
  )
}

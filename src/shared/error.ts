/** 将未知异常归一化为面向用户的可读文本，避免暴露 Raw Error 前缀。 */
export function errorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof Error) return error.message || fallback
  return typeof error === 'string' && error ? error : fallback
}

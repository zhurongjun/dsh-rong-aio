export function errorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof Error) return error.message || fallback
  return typeof error === 'string' && error ? error : fallback
}

/** 串行异步任务队列：失败不会阻塞后续任务，关闭时拒绝新任务并等待队尾完成。 */
export function createSerialQueue(closedMessage = '服务已停用') {
  let tail: Promise<unknown> = Promise.resolve()
  let active = true

  return {
    get active() {
      return active
    },

    /** 排队执行异步任务；单个任务拒绝不影响后续任务继续执行。 */
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(() => {
        if (!active) throw new Error(closedMessage)
        return task()
      })
      tail = next.catch(() => {})
      return next
    },

    /** 停止接收新任务并等待已开始的任务完成。 */
    async close(): Promise<void> {
      active = false
      await tail
    },
  }
}

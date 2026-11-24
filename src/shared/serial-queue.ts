export function createSerialQueue(closedMessage = '服务已停用') {
  let tail: Promise<unknown> = Promise.resolve()
  let active = true

  return {
    get active() {
      return active
    },

    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(() => {
        if (!active) throw new Error(closedMessage)
        return task()
      })
      tail = next.catch(() => {})
      return next
    },

    async close(): Promise<void> {
      active = false
      await tail
    },
  }
}

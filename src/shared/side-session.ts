const prefix = 'rong-side-'

export const sideSessionId = (key: string) => prefix + key
export const isSideSession = (id: string) =>
  /^rong-side-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)

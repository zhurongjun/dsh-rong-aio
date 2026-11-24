/** 通用多词不区分大小写搜索：查询拆分为词项后，全部词项均命中目标文本即返回 true。 */
export function matchesQueryWords(text: string, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = text.toLocaleLowerCase()
  return words.every((word) => haystack.includes(word))
}

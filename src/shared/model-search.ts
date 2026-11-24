export function matchesQueryWords(text: string, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

  const haystack = text.toLocaleLowerCase()
  return words.every((word) => haystack.includes(word))
}

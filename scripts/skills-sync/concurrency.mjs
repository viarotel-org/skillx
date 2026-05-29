/**
 * @template Input
 * @template Output
 * @param {Input[]} items
 * @param {number} concurrency
 * @param {(item: Input, index: number) => Promise<Output>} mapper
 * @returns {Promise<Output[]>}
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = Array.from({ length: items.length })
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results
}

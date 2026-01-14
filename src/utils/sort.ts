/**
 * Сортирует ID задач численно по сегментам.
 *
 * @example
 * sortIds(["2", "1.10", "1.2", "10"]) // ["1.2", "1.10", "2", "10"]
 *
 * @param ids - Массив ID для сортировки
 * @returns Отсортированный массив ID
 */
export function sortIds(ids: string[]): string[] {
  return ids.sort((a, b) => {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    const maxLen = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLen; i++) {
      const valA = partsA[i] ?? 0;
      const valB = partsB[i] ?? 0;
      if (valA !== valB) return valA - valB;
    }
    return 0;
  });
}

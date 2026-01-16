/**
 * Данные задачи в индексе (статус и зависимости).
 */
export interface TaskIndexData {
  status: string;
  dependencies: string[];
}

/**
 * Индекс задач.
 * Ключ - ID задачи, значение - статус и зависимости.
 */
export interface IndexData {
  [taskId: string]: TaskIndexData;
}

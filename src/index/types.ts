/**
 * Индекс зависимостей задач.
 * Ключ - ID задачи, значение - массив ID зависимостей.
 */
export interface IndexData {
  [taskId: string]: string[];
}

/**
 * Зависимости одной задачи.
 */
export interface TaskDependencies {
  id: string;
  dependencies: string[];
}

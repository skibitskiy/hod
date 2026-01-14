import * as defaultFs from 'node:fs/promises';
import * as path from 'node:path';
import { sortIds } from '../utils/sort.js';
import { validateTaskId } from '../utils/validation.js';
import type { IndexData, TaskDependencies } from './types.js';
import {
  CircularDependencyError,
  IndexCorruptionError,
  IndexLoadError,
  IndexValidationError,
  IndexWriteError,
} from './errors.js';

type FsModule = typeof defaultFs;

interface NodeError extends Error {
  code?: string;
  cause?: unknown;
}

function isNodeError(e: unknown): e is NodeError {
  return e instanceof Error;
}

/**
 * Путь к директории .hod относительно tasksDir
 */
const HOD_DIR_NAME = '.hod';
const INDEX_FILE_NAME = 'index.json';

/**
 * Интерфейс сервиса управления индексом зависимостей.
 */
export interface IndexService {
  /**
   * Загружает индекс из файла.
   * @returns Объект индекса или пустой объект, если файл не существует
   * @throws {IndexCorruptionError} при невалидном JSON
   * @throws {IndexLoadError} при ошибках доступа
   */
  load(): Promise<IndexData>;

  /**
   * Обновляет зависимости задачи.
   * @param taskId - ID задачи
   * @param dependencies - Массив ID зависимостей
   * @throws {IndexValidationError} при невалидном ID
   * @throws {CircularDependencyError} при обнаружении цикла
   * @throws {IndexWriteError} при ошибке записи
   */
  update(taskId: string, dependencies: string[]): Promise<void>;

  /**
   * Удаляет задачу из индекса.
   * @param taskId - ID задачи для удаления
   */
  remove(taskId: string): Promise<void>;

  /**
   * Пересобирает индекс из списка задач.
   * @param tasks - Массив задач с зависимостями
   * @throws {IndexValidationError} при невалидных данных
   * @throws {CircularDependencyError} при обнаружении цикла
   * @throws {IndexWriteError} при ошибке записи
   */
  rebuild(tasks: TaskDependencies[]): Promise<void>;

  /**
   * Возвращает ID задач готовых к выполнению.
   * Примечание: кэш должен быть инициализирован через load/update/remove/rebuild.
   * @param allStatuses - Объект со статусами всех задач (taskId -> status)
   * @returns Отсортированный массив ID задач
   */
  getNextTasks(allStatuses: Record<string, string>): string[];
}

/**
 * Нормализует зависимости: trim и дедупликация.
 */
function normalizeDependencies(deps: string[]): string[] {
  return Array.from(new Set(deps.map((d) => d.trim())));
}

/**
 * Создаёт директорию .hod если она не существует.
 */
async function ensureHodDirectory(tasksDir: string, fs: FsModule): Promise<void> {
  const hodDir = path.join(tasksDir, HOD_DIR_NAME);
  try {
    await fs.mkdir(hodDir, { recursive: true });
  } catch (e) {
    if (isNodeError(e) && e.code === 'EEXIST') {
      return;
    }
    if (isNodeError(e) && (e.code === 'EACCES' || e.code === 'EROFS' || e.code === 'ENOTDIR')) {
      throw new IndexWriteError(`Нет прав на создание директории ${hodDir}`, e);
    }
    throw new IndexWriteError(`Не удалось создать директорию ${hodDir}`, e as Error);
  }
}

/**
 * DFS для обнаружения циклов.
 * Возвращает путь цикла если найден, иначе undefined.
 */
function detectCycle(
  taskId: string,
  currentDeps: string[],
  index: IndexData,
  visiting: Set<string>,
  visited: Set<string>,
  path: string[],
): string[] | undefined {
  // Добавляем текущую вершину в путь
  path.push(taskId);
  visiting.add(taskId);

  for (const dep of currentDeps) {
    if (!visited.has(dep)) {
      if (visiting.has(dep)) {
        // Нашли цикл - возвращаем путь от dep до текущей вершины
        const cycleStart = path.indexOf(dep);
        return [...path.slice(cycleStart), dep];
      }

      // Рекурсивно проверяем зависимость
      const deps = index[dep] || [];
      const cycle = detectCycle(dep, deps, index, visiting, visited, path);
      if (cycle) {
        return cycle;
      }
    }
  }

  visiting.delete(taskId);
  visited.add(taskId);
  path.pop();

  return undefined;
}

/**
 * Проверяет наличие циклических зависимостей.
 * @throws {CircularDependencyError} при обнаружении цикла
 */
function checkCircularDependencies(
  taskId: string,
  dependencies: string[],
  index: IndexData,
): void {
  // Self-dependency check
  if (dependencies.includes(taskId)) {
    throw new CircularDependencyError(`Задача ${taskId} зависит от самой себя`, [taskId, taskId]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  // Добавляем новую задачу во временный индекс для проверки
  const tempIndex: IndexData = { ...index, [taskId]: dependencies };

  for (const id of Object.keys(tempIndex)) {
    if (!visited.has(id)) {
      const cycle = detectCycle(id, tempIndex[id] || [], tempIndex, visiting, visited, path);
      if (cycle) {
        throw new CircularDependencyError(
          `Обнаружена циклическая зависимость: ${cycle.join(' -> ')}`,
          cycle,
        );
      }
    }
  }
}

/**
 * Проверяет все задачи на циклические зависимости.
 * Используется в rebuild().
 */
function checkAllCircularDependencies(tasks: TaskDependencies[]): void {
  const index: IndexData = {};
  for (const task of tasks) {
    index[task.id] = task.dependencies;
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      const cycle = detectCycle(task.id, task.dependencies, index, visiting, visited, []);
      if (cycle) {
        throw new CircularDependencyError(
          `Обнаружена циклическая зависимость: ${cycle.join(' -> ')}`,
          cycle,
        );
      }
    }
  }
}

/**
 * Атомарная запись индекса в файл.
 */
async function atomicWriteIndex(
  tasksDir: string,
  data: IndexData,
  fs: FsModule,
): Promise<void> {
  const hodDir = path.join(tasksDir, HOD_DIR_NAME);
  const indexPath = path.join(hodDir, INDEX_FILE_NAME);
  const tempPath = `${indexPath}.tmp`;

  // Удаляем старый .tmp если есть
  try {
    await fs.unlink(tempPath);
  } catch {
    // Ignore
  }

  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempPath, indexPath);
  } catch (e) {
    // Очищаем .tmp если был создан
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    if (isNodeError(e)) {
      if (e.code === 'EACCES' || e.code === 'EROFS') {
        throw new IndexWriteError(`Нет прав на запись индекса: ${indexPath}`, e);
      }
      if (e.code === 'ENOSPC') {
        throw new IndexWriteError(`Недостаточно места на диске: ${indexPath}`, e);
      }
    }
    throw new IndexWriteError(`Не удалось записать индекс: ${indexPath}`, e as Error);
  }
}

/**
 * Реализация сервиса индекса.
 */
class IndexServiceImpl implements IndexService {
  private readonly indexPath: string;
  private cachedIndex: IndexData | null = null;

  constructor(
    private readonly tasksDir: string,
    private readonly fs: FsModule = defaultFs,
  ) {
    this.indexPath = path.join(tasksDir, HOD_DIR_NAME, INDEX_FILE_NAME);
  }

  async load(): Promise<IndexData> {
    try {
      const content = await this.fs.readFile(this.indexPath, 'utf8');
      try {
        const data = JSON.parse(content) as unknown;

        // Валидация типа
        if (Array.isArray(data)) {
          // Пустой массив нормализуем в пустой объект
          const emptyIndex = {};
          this.cachedIndex = emptyIndex;
          return emptyIndex;
        }

        if (typeof data !== 'object' || data === null) {
          throw new IndexCorruptionError(
            `Невалидный формат индекса: ожидается объект, получено ${typeof data}`,
          );
        }

        // Проверяем что все значения - массивы
        const indexData = data as IndexData;
        for (const key in indexData) {
          if (!Array.isArray(indexData[key])) {
            throw new IndexCorruptionError(
              `Невалидный формат индекса: значение для ключа "${key}" не является массивом`,
            );
          }
        }

        // Обновляем кэш
        this.cachedIndex = indexData;
        return indexData;
      } catch (e) {
        if (e instanceof IndexCorruptionError) {
          throw e;
        }
        throw new IndexCorruptionError('Не удалось распарсить JSON индекса', e as Error);
      }
    } catch (e) {
      if (isNodeError(e) && e.code === 'ENOENT') {
        // Файл не существует - возвращаем пустой индекс
        const emptyIndex = {};
        this.cachedIndex = emptyIndex;
        return emptyIndex;
      }
      if (isNodeError(e) && e.code === 'EACCES') {
        throw new IndexLoadError(`Нет прав на чтение индекса: ${this.indexPath}`, e);
      }
      if (e instanceof IndexCorruptionError) {
        throw e;
      }
      throw new IndexLoadError(`Не удалось загрузить индекс: ${this.indexPath}`, e as Error);
    }
  }

  async update(taskId: string, dependencies: string[]): Promise<void> {
    // Валидация ID
    validateTaskId(taskId);

    // Нормализация зависимостей
    const normalizedDeps = normalizeDependencies(dependencies);

    // Валидация ID зависимостей
    for (const dep of normalizedDeps) {
      validateTaskId(dep);
    }

    // Загружаем текущий индекс
    const index = await this.load();

    // Проверяем циклические зависимости
    checkCircularDependencies(taskId, normalizedDeps, index);

    // Обновляем индекс
    index[taskId] = normalizedDeps;

    // Создаём директорию и пишем атомарно
    await ensureHodDirectory(this.tasksDir, this.fs);
    await atomicWriteIndex(this.tasksDir, index, this.fs);

    // Обновляем кэш
    this.cachedIndex = index;
  }

  async remove(taskId: string): Promise<void> {
    const index = await this.load();

    // No-op если задача не существует
    if (!(taskId in index)) {
      return;
    }

    delete index[taskId];

    // Пишем атомарно (директория должна существовать)
    await atomicWriteIndex(this.tasksDir, index, this.fs);

    // Обновляем кэш
    this.cachedIndex = index;
  }

  async rebuild(tasks: TaskDependencies[]): Promise<void> {
    // Пустой массив → пустой индекс
    if (tasks.length === 0) {
      await ensureHodDirectory(this.tasksDir, this.fs);
      await atomicWriteIndex(this.tasksDir, {}, this.fs);
      this.cachedIndex = {};
      return;
    }

    // Проверяем дубликаты ID
    const seenIds = new Set<string>();
    for (const task of tasks) {
      if (seenIds.has(task.id)) {
        throw new IndexValidationError(`Дубликат ID задачи: ${task.id}`);
      }
      seenIds.add(task.id);
    }

    // Валидация и нормализация
    const normalizedTasks: TaskDependencies[] = [];
    for (const task of tasks) {
      validateTaskId(task.id);
      const normalizedDeps = normalizeDependencies(task.dependencies);
      for (const dep of normalizedDeps) {
        validateTaskId(dep);
      }
      normalizedTasks.push({ id: task.id, dependencies: normalizedDeps });
    }

    // Проверяем циклические зависимости
    checkAllCircularDependencies(normalizedTasks);

    // Собираем индекс
    const index: IndexData = {};
    for (const task of normalizedTasks) {
      index[task.id] = task.dependencies;
    }

    // Создаём директорию и пишем атомарно
    await ensureHodDirectory(this.tasksDir, this.fs);
    await atomicWriteIndex(this.tasksDir, index, this.fs);

    // Обновляем кэш
    this.cachedIndex = index;
  }

  getNextTasks(allStatuses: Record<string, string>): string[] {
    // Если нет статусов - возвращаем пустой массив
    if (Object.keys(allStatuses).length === 0) {
      return [];
    }

    const readyTasks: string[] = [];

    // Проходим по всем задачам в статусах
    for (const taskId in allStatuses) {
      // Пропускаем выполненные задачи
      if (allStatuses[taskId] === 'completed') {
        continue;
      }

      // Получаем зависимости из индекса (если нет - считаем что нет зависимостей)
      const dependencies = this.getCachedDependencies(taskId);

      // Проверяем что все зависимости выполнены
      const allDepsCompleted = dependencies.every((depId) => {
        // Пропускаем если зависимости нет в статусах (orphaned reference)
        if (!(depId in allStatuses)) {
          return false;
        }
        return allStatuses[depId] === 'completed';
      });

      if (allDepsCompleted && dependencies.length > 0) {
        readyTasks.push(taskId);
      } else if (dependencies.length === 0 && allStatuses[taskId] !== 'completed') {
        // Задачи без зависимостей тоже готовы
        readyTasks.push(taskId);
      }
    }

    // Сортируем по ID
    return sortIds(readyTasks);
  }

  /**
   * Вспомогательный метод для получения зависимостей из кэша.
   * В кэше может быть устаревший индекс, но для getNextTasks это допустимо.
   */
  private getCachedDependencies(taskId: string): string[] {
    // Синхронно возвращаем зависимости из кэша или пустой массив
    return this.cachedIndex?.[taskId] || [];
  }

  /**
   * Сбрасывает кэш индекса.
   *
   * @internal Этот метод предназначен только для тестирования.
   * Не используется в production коде.
   *
   * @remarks
   * Метод не является частью публичного API `IndexService`,
   * но доступен на экземпляре класса для тестовых сценариев.
   */
  resetCache(): void {
    this.cachedIndex = null;
  }
}

/**
 * Фабрика для создания сервиса индекса.
 */
export function createIndexService(tasksDir: string, fs?: FsModule): IndexService {
  return new IndexServiceImpl(tasksDir, fs);
}

/**
 * Экспорт для тестов.
 */
export { IndexServiceImpl };

/**
 * Re-export типов для удобства.
 */
export type { IndexData, TaskDependencies };

/**
 * Re-export ошибок для удобства.
 */
export {
  CircularDependencyError,
  IndexCorruptionError,
  IndexLoadError,
  IndexValidationError,
  IndexWriteError,
};

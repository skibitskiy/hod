import * as defaultFs from 'node:fs/promises';
import * as path from 'node:path';
import { sortIds } from '../utils/sort.js';
import { validateTaskId } from '../utils/validation.js';
import type { IndexData, TaskIndexData } from './types.js';
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
 * Интерфейс сервиса управления индексом задач.
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
   * Обновляет статус и зависимости задачи.
   * @param taskId - ID задачи
   * @param data - Данные задачи (статус и зависимости)
   * @throws {IndexValidationError} при невалидном ID
   * @throws {CircularDependencyError} при обнаружении цикла
   * @throws {IndexWriteError} при ошибке записи
   */
  update(taskId: string, data: TaskIndexData): Promise<void>;

  /**
   * Удаляет задачу из индекса.
   * @param taskId - ID задачи для удаления
   */
  remove(taskId: string): Promise<void>;

  /**
   * Возвращает ID задач готовых к выполнению.
   * Загружает индекс из файла для получения актуальных статусов.
   * @param doneStatus - Статус(ы) считающиеся выполненными (по умолчанию 'completed')
   * @returns Отсортированный массив ID задач
   */
  getNextTasks(doneStatus?: string | string[]): Promise<string[]>;
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
      const depData = index[dep];
      const deps = depData?.dependencies || [];
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
function checkCircularDependencies(taskId: string, dependencies: string[], index: IndexData): void {
  // Self-dependency check
  if (dependencies.includes(taskId)) {
    throw new CircularDependencyError(`Задача ${taskId} зависит от самой себя`, [taskId, taskId]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  // Добавляем новую задачу во временный индекс для проверки
  const existingData = index[taskId];
  const tempIndex: IndexData = {
    ...index,
    [taskId]: { status: existingData?.status || 'pending', dependencies },
  };

  for (const id of Object.keys(tempIndex)) {
    if (!visited.has(id)) {
      const cycle = detectCycle(
        id,
        tempIndex[id]?.dependencies || [],
        tempIndex,
        visiting,
        visited,
        path,
      );
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
async function atomicWriteIndex(tasksDir: string, data: IndexData, fs: FsModule): Promise<void> {
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
          return {};
        }

        if (typeof data !== 'object' || data === null) {
          throw new IndexCorruptionError(
            `Невалидный формат индекса: ожидается объект, получено ${typeof data}`,
          );
        }

        // Проверяем что все значения - объекты с status и dependencies
        const indexData = data as IndexData;
        for (const key in indexData) {
          const value = indexData[key];
          if (typeof value !== 'object' || value === null) {
            throw new IndexCorruptionError(
              `Невалидный формат индекса: значение для ключа "${key}" не является объектом`,
            );
          }
          if (!('status' in value) || !('dependencies' in value)) {
            throw new IndexCorruptionError(
              `Невалидный формат индекса: значение для ключа "${key}" должно содержать status и dependencies`,
            );
          }
          if (!Array.isArray(value.dependencies)) {
            throw new IndexCorruptionError(
              `Невалидный формат индекса: dependencies для ключа "${key}" не является массивом`,
            );
          }
        }

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
        return {};
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

  async update(taskId: string, data: TaskIndexData): Promise<void> {
    // Валидация ID
    validateTaskId(taskId);

    // Валидация статуса (может быть любой строкой, но не пустой?)
    // Спека говорит "any string", так что принимаем любую
    const status = data.status || 'pending';

    // Нормализация зависимостей
    const normalizedDeps = normalizeDependencies(data.dependencies);

    // Валидация ID зависимостей
    for (const dep of normalizedDeps) {
      validateTaskId(dep);
    }

    // Загружаем текущий индекс
    const index = await this.load();

    // Проверяем циклические зависимости
    checkCircularDependencies(taskId, normalizedDeps, index);

    // Обновляем индекс
    index[taskId] = { status, dependencies: normalizedDeps };

    // Создаём директорию и пишем атомарно
    await ensureHodDirectory(this.tasksDir, this.fs);
    await atomicWriteIndex(this.tasksDir, index, this.fs);
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
  }

  async getNextTasks(doneStatus: string | string[] = 'completed'): Promise<string[]> {
    // Загружаем индекс для получения актуальных статусов
    const index = await this.load();

    if (Object.keys(index).length === 0) {
      return [];
    }

    // Нормализуем doneStatus в массив для удобства проверки
    const doneStatuses = Array.isArray(doneStatus) ? doneStatus : [doneStatus];

    const readyTasks: string[] = [];

    // Проходим по всем задачам в индексе
    for (const [taskId, taskData] of Object.entries(index)) {
      // Пропускаем выполненные задачи
      if (doneStatuses.includes(taskData.status)) {
        continue;
      }

      // Проверяем что все зависимости выполнены
      const allDepsCompleted = taskData.dependencies.every((depId) => {
        const depData = index[depId];
        // Если зависимости нет в индексе - считаем что не выполнена
        return depData?.status !== undefined && doneStatuses.includes(depData.status);
      });

      if (allDepsCompleted) {
        readyTasks.push(taskId);
      }
    }

    // Сортируем по ID
    return sortIds(readyTasks);
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
export type { IndexData, TaskIndexData };

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

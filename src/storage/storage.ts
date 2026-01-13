import * as defaultFs from 'node:fs/promises';
import * as path from 'node:path';
import {
  StorageAccessError,
  StorageAlreadyExistsError,
  StorageNotFoundError,
  StorageWriteError,
} from './errors.js';

type FsModule = typeof defaultFs;

interface NodeError extends Error {
  code?: string;
  cause?: unknown;
}

function isNodeError(e: unknown): e is NodeError {
  return e instanceof Error;
}

export interface Task {
  id: string;
  content: string;
}

export interface StorageService {
  create(id: string, content: string): Promise<void>;
  read(id: string): Promise<string>;
  update(id: string, content: string): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<Task[]>;
  exists(id: string): Promise<boolean>;
}

// Regex для валидации ID: число или числа через точку
const ID_REGEX = /^\d+(\.\d+)*$/;
const MAX_ID_LENGTH = 50;

function isValidId(id: string): boolean {
  if (id.length > MAX_ID_LENGTH) {
    return false;
  }
  return ID_REGEX.test(id);
}

function sortIds(ids: string[]): string[] {
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

function mapErrorToStorageError(e: unknown, context: string): never {
  if (isNodeError(e)) {
    switch (e.code) {
      case 'EACCES':
        throw new StorageAccessError(`Нет прав доступа: ${context}`, e);
      case 'EISDIR':
        throw new StorageAccessError(`Путь является директорией: ${context}`, e);
      case 'EROFS':
        throw new StorageAccessError(`Файловая система только для чтения: ${context}`, e);
      case 'ENOSPC':
        throw new StorageWriteError(`Недостаточно места на диске: ${context}`, e);
      default:
        throw new StorageWriteError(`Ошибка записи: ${context}`, e);
    }
  }
  throw new StorageWriteError(`Неизвестная ошибка: ${context}`, e as Error);
}

function mapCreateError(e: unknown, id: string): never {
  if (isNodeError(e)) {
    switch (e.code) {
      case 'EEXIST':
        throw new StorageAlreadyExistsError(id);
      case 'EACCES':
        throw new StorageAccessError(`Нет прав доступа: ${id}`, e);
      case 'EISDIR':
        throw new StorageAccessError(`Путь является директорией: ${id}`, e);
      case 'EROFS':
        throw new StorageAccessError(`Файловая система только для чтения: ${id}`, e);
      case 'ENOSPC':
        throw new StorageWriteError(`Недостаточно места на диске: ${id}`, e);
      default:
        throw new StorageWriteError(`Ошибка записи: ${id}`, e);
    }
  }
  throw new StorageWriteError(`Неизвестная ошибка: ${id}`, e as Error);
}

async function ensureDirectoryExists(tasksDir: string, fs: FsModule): Promise<void> {
  try {
    await fs.mkdir(tasksDir, { recursive: true });
  } catch (e) {
    if (isNodeError(e) && e.code === 'EEXIST') {
      return;
    }
    if (
      isNodeError(e) &&
      (e.code === 'EACCES' || e.code === 'EROFS' || e.code === 'EISDIR' || e.code === 'ENOTDIR')
    ) {
      throw new StorageAccessError(`Не удалось создать директорию задач: ${tasksDir}`, e);
    }
    throw new StorageWriteError(`Не удалось создать директорию задач: ${tasksDir}`, e as Error);
  }
}

class StorageServiceImpl implements StorageService {
  constructor(
    private readonly tasksDir: string,
    private readonly fs: FsModule = defaultFs,
  ) {}

  async create(id: string, content: string): Promise<void> {
    if (!isValidId(id)) {
      throw new StorageAccessError(`Невалидный ID задачи: ${id}`);
    }

    await ensureDirectoryExists(this.tasksDir, this.fs);

    const targetPath = path.join(this.tasksDir, `${id}.md`);
    const tempPath = `${targetPath}.tmp`;

    // Cleanup старый .tmp если есть
    try {
      await this.fs.unlink(tempPath);
    } catch {
      // Ignore if file doesn't exist
    }

    let tempFileCreated = false;

    try {
      await this.fs.writeFile(tempPath, content, 'utf8');
      tempFileCreated = true;
      await this.fs.rename(tempPath, targetPath);
    } catch (e) {
      // Очищаем .tmp файл если он был создан
      if (tempFileCreated) {
        try {
          await this.fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      throw mapCreateError(e, id);
    }
  }

  async read(id: string): Promise<string> {
    if (!isValidId(id)) {
      throw new StorageAccessError(`Невалидный ID задачи: ${id}`);
    }

    const filePath = path.join(this.tasksDir, `${id}.md`);

    try {
      return await this.fs.readFile(filePath, 'utf8');
    } catch (e) {
      if (isNodeError(e) && e.code === 'ENOENT') {
        throw new StorageNotFoundError(id, e);
      }
      if (isNodeError(e) && e.code === 'EACCES') {
        throw new StorageAccessError(`Нет прав на чтение задачи: ${id}`, e);
      }
      throw new StorageAccessError(`Ошибка чтения задачи: ${id}`, e as Error);
    }
  }

  async update(id: string, content: string): Promise<void> {
    if (!isValidId(id)) {
      throw new StorageAccessError(`Невалидный ID задачи: ${id}`);
    }

    const targetPath = path.join(this.tasksDir, `${id}.md`);
    const tempPath = `${targetPath}.tmp`;

    // Cleanup старый .tmp если есть
    try {
      await this.fs.unlink(tempPath);
    } catch {
      // Ignore if file doesn't exist
    }

    let tempFileCreated = false;

    try {
      await this.fs.writeFile(tempPath, content, 'utf8');
      tempFileCreated = true;
      await this.fs.rename(tempPath, targetPath);
    } catch (e) {
      // Очищаем .tmp файл если он был создан
      if (tempFileCreated) {
        try {
          await this.fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      if (isNodeError(e) && e.code === 'ENOENT') {
        throw new StorageNotFoundError(id, e);
      }
      throw mapErrorToStorageError(e, `update(${id})`);
    }
  }

  async delete(id: string): Promise<void> {
    if (!isValidId(id)) {
      // No-op для невалидных ID (идемпотентно)
      return;
    }

    const filePath = path.join(this.tasksDir, `${id}.md`);

    try {
      await this.fs.unlink(filePath);
    } catch (e) {
      if (isNodeError(e) && e.code === 'ENOENT') {
        // No-op если файл не существует (идемпотентно)
        return;
      }
      if (isNodeError(e) && e.code === 'EACCES') {
        throw new StorageAccessError(`Нет прав на удаление задачи: ${id}`, e);
      }
      if (isNodeError(e) && e.code === 'EROFS') {
        throw new StorageAccessError(`Файловая система только для чтения: ${id}`, e);
      }
      throw new StorageAccessError(`Ошибка удаления задачи: ${id}`, e as Error);
    }
  }

  async list(): Promise<Task[]> {
    let entries: string[] = [];

    try {
      entries = await this.fs.readdir(this.tasksDir);
    } catch (e) {
      if (isNodeError(e) && e.code === 'ENOENT') {
        // Директория не существует → пустой список
        return [];
      }
      if (isNodeError(e) && e.code === 'EACCES') {
        throw new StorageAccessError(`Нет прав на чтение директории задач`, e);
      }
      if (isNodeError(e) && e.code === 'ENOTDIR') {
        throw new StorageAccessError(`Путь задач не является директорией`, e);
      }
      throw new StorageAccessError(`Ошибка чтения директории задач`, e as Error);
    }

    const tasks: Task[] = [];
    const validIds: string[] = [];

    for (const entry of entries) {
      // Игнорируем .hod директорию
      if (entry === '.hod') {
        continue;
      }

      // Только .md файлы
      if (!entry.endsWith('.md')) {
        continue;
      }

      // Извлекаем ID без расширения
      const id = entry.slice(0, -3);

      // Пропускаем файлы с невалидным ID
      if (!isValidId(id)) {
        continue;
      }

      const filePath = path.join(this.tasksDir, entry);

      try {
        const content = await this.fs.readFile(filePath, 'utf8');
        validIds.push(id);
        tasks.push({ id, content });
      } catch {
        // Graceful degradation - пропускаем недоступные файлы
        continue;
      }
    }

    // Сортируем по ID
    const sortedIds = sortIds(validIds);
    const sortedTasks: Task[] = [];

    for (const id of sortedIds) {
      const task = tasks.find((t) => t.id === id);
      if (task) {
        sortedTasks.push(task);
      }
    }

    return sortedTasks;
  }

  async exists(id: string): Promise<boolean> {
    // Сначала валидируем regex - возвращаем false для невалидных ID без filesystem access
    if (!isValidId(id)) {
      return false;
    }

    const filePath = path.join(this.tasksDir, `${id}.md`);

    try {
      await this.fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export function createStorageService(tasksDir: string, fs?: FsModule): StorageService {
  return new StorageServiceImpl(tasksDir, fs);
}

// Экспорт для тестов
export { StorageServiceImpl };

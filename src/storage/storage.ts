import * as defaultFs from 'node:fs/promises';
import * as path from 'node:path';
import {
  StorageAccessError,
  StorageAlreadyExistsError,
  StorageNotFoundError,
  StorageWriteError,
  StorageParseError,
} from './errors.js';
import { sortIds } from '../utils/sort.js';
import { ID_REGEX, MAX_ID_LENGTH } from '../utils/validation.js';

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

function isValidId(id: string): boolean {
  if (id.length > MAX_ID_LENGTH) {
    return false;
  }
  return ID_REGEX.test(id);
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

/**
 * Helper для извлечения ID из имени файла
 * Поддерживает .json, .json.tmp, .md расширения
 */
function extractId(filename: string): string | null {
  // Игнорируем .tmp файлы
  if (filename.endsWith('.tmp')) {
    return null;
  }

  if (filename.endsWith('.json')) {
    return filename.slice(0, -5);
  }

  if (filename.endsWith('.md')) {
    return filename.slice(0, -3);
  }

  return null;
}

class StorageServiceImpl implements StorageService {
  constructor(
    private readonly tasksDir: string,
    private readonly fs: FsModule = defaultFs,
  ) {}

  /**
   * Валидирует JSON строку
   * Проверяет syntax + object type
   * @throws StorageWriteError если JSON невалиден или не объект
   */
  private validateJson(content: string): void {
    try {
      const parsed = JSON.parse(content);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new StorageWriteError('JSON должен быть объектом');
      }
    } catch (e) {
      if (e instanceof StorageWriteError) {
        throw e;
      }
      if (e instanceof SyntaxError) {
        throw new StorageWriteError(`Невалидный JSON: ${e.message}`);
      }
      throw e;
    }
  }

  async create(id: string, content: string): Promise<void> {
    if (!isValidId(id)) {
      throw new StorageAccessError(`Невалидный ID задачи: ${id}`);
    }

    // Валидируем JSON
    this.validateJson(content);

    await ensureDirectoryExists(this.tasksDir, this.fs);

    const targetPath = path.join(this.tasksDir, `${id}.json`);
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

    const jsonPath = path.join(this.tasksDir, `${id}.json`);
    const mdPath = path.join(this.tasksDir, `${id}.md`);

    // Step 1: Try .json (priority, fail-fast для corrupted)
    try {
      const content = await this.fs.readFile(jsonPath, 'utf8');
      // Валидируем JSON syntax
      try {
        JSON.parse(content);
      } catch (e) {
        if (e instanceof SyntaxError) {
          const message = e.message;
          // Extract position if available.
          // V8 formats: "Unexpected token } in JSON at position 42"
          //             "Unexpected token } in JSON at line 1 column 43"
          // Try multiple patterns for robustness across Node.js versions
          let position: string | undefined;
          const posMatch = message.match(/at position (\d+)/);
          if (posMatch) {
            position = posMatch[1];
          } else {
            const colMatch = message.match(/at line \d+ column (\d+)/);
            if (colMatch) {
              position = colMatch[1];
            }
          }
          throw new StorageParseError(
            `Невалидный JSON в задаче ${id}`,
            id,
            message,
            position,
            e, // cause - original SyntaxError for debugging
          );
        }
        throw e;
      }
      return content;
    } catch (e) {
      if (e instanceof StorageParseError) {
        throw e;
      }
      if (isNodeError(e) && e.code === 'ENOENT') {
        // Step 2: Try .md (fallback)
      } else if (isNodeError(e) && e.code === 'EACCES') {
        throw new StorageAccessError(`Нет прав на чтение задачи: ${id}`, e);
      } else {
        throw new StorageAccessError(`Ошибка чтения задачи: ${id}`, e as Error);
      }
    }

    // Step 2: Try .md (legacy fallback)
    try {
      return await this.fs.readFile(mdPath, 'utf8');
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

    // Валидируем JSON
    this.validateJson(content);

    const targetPath = path.join(this.tasksDir, `${id}.json`);
    const tempPath = `${targetPath}.tmp`;
    const mdPath = path.join(this.tasksDir, `${id}.md`);

    // Проверяем, что задача существует (хотя бы один формат)
    const jsonExists = await this.fs
      .access(targetPath)
      .then(() => true)
      .catch(() => false);
    const mdExists = await this.fs
      .access(mdPath)
      .then(() => true)
      .catch(() => false);

    if (!jsonExists && !mdExists) {
      throw new StorageNotFoundError(id);
    }

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

      // При успехе удаляем .md если существует
      try {
        await this.fs.unlink(mdPath);
      } catch {
        // Ignore if .md doesn't exist
      }
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

    const jsonPath = path.join(this.tasksDir, `${id}.json`);
    const mdPath = path.join(this.tasksDir, `${id}.md`);

    // Удаляем оба формата если существуют (идемпотентно)
    for (const filePath of [jsonPath, mdPath]) {
      try {
        await this.fs.unlink(filePath);
      } catch (e) {
        if (isNodeError(e) && e.code === 'ENOENT') {
          // No-op если файл не существует
          continue;
        }
        if (isNodeError(e) && (e.code === 'EACCES' || e.code === 'EROFS')) {
          throw new StorageAccessError(`Нет прав на удаление задачи: ${id}`, e);
        }
        throw new StorageAccessError(`Ошибка удаления задачи: ${id}`, e as Error);
      }
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

    const tasksMap = new Map<string, Task>();
    const entriesSet = new Set(entries); // O(1) lookup вместо O(n) includes()

    for (const entry of entries) {
      // Игнорируем .hod директорию
      if (entry === '.hod') {
        continue;
      }

      const id = extractId(entry);
      if (!id || !isValidId(id)) {
        continue;
      }

      // Если уже есть задача с этим ID в .json, пропускаем
      if (tasksMap.has(id)) {
        continue;
      }

      // Prefer .json over .md (extractId возвращает ID для обоих форматов)
      // Но так как мы идем по списку entries в произвольном порядке,
      // нужно явно проверить приоритет
      const jsonEntry = `${id}.json`;
      const mdEntry = `${id}.md`;

      let filePath: string | null = null;

      // Если есть .json, используем его
      if (entriesSet.has(jsonEntry)) {
        filePath = path.join(this.tasksDir, jsonEntry);
      } else if (entriesSet.has(mdEntry)) {
        filePath = path.join(this.tasksDir, mdEntry);
      } else {
        // Файл был удален между readdir и readFile
        continue;
      }

      try {
        const content = await this.fs.readFile(filePath!, 'utf8');
        tasksMap.set(id, { id, content });
      } catch {
        // Graceful degradation - пропускаем недоступные файлы
        continue;
      }
    }

    // Сортируем по ID
    const sortedIds = sortIds(Array.from(tasksMap.keys()));
    const sortedTasks: Task[] = [];

    for (const id of sortedIds) {
      const task = tasksMap.get(id);
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

    const jsonPath = path.join(this.tasksDir, `${id}.json`);
    const mdPath = path.join(this.tasksDir, `${id}.md`);

    // Проверяем .json ИЛИ .md (но не .tmp)
    for (const filePath of [jsonPath, mdPath]) {
      try {
        await this.fs.access(filePath);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }
}

export function createStorageService(tasksDir: string, fs?: FsModule): StorageService {
  return new StorageServiceImpl(tasksDir, fs);
}

// Экспорт для тестов
export { StorageServiceImpl };

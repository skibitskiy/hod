import type { ParsedTask } from '../../parser/types.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import type { StorageService } from '../../storage/storage.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { ParentValidationError, CircularDependencyError } from '../errors.js';
import { MAX_ID_LENGTH } from '../../utils/validation.js';

interface NodeError extends Error {
  cause?: unknown;
}

export interface AddCommandOptions {
  [fieldName: string]: string | undefined;
  dependencies?: string;
  parent?: string;
}

/**
 * Collects field values from CLI arguments based on config.
 * Maps --field-name (kebab-case) to markdown field via config.fields[key].name
 */
function collectFields(
  args: AddCommandOptions,
  config: Config,
): Record<string, string | undefined> {
  const fields: Record<string, string | undefined> = {};

  // Build reverse mapping: CLI arg name -> Markdown key
  const nameToKey = new Map<string, string>();
  for (const [markdownKey, fieldConfig] of Object.entries(config.fields)) {
    nameToKey.set(fieldConfig.name, markdownKey);
  }

  // Process all CLI args
  for (const [argName, argValue] of Object.entries(args)) {
    if (argValue === undefined) {
      continue;
    }

    // Check if this is a known field
    const markdownKey = nameToKey.get(argName);
    if (markdownKey) {
      fields[markdownKey] = argValue.trim();
    }
  }

  return fields;
}

/**
 * Validates that all provided field names are known.
 * Throws error with all available fields if unknown field found.
 */
function validateFieldNames(args: AddCommandOptions, config: Config): void {
  const systemFields = ['dependencies', 'parent', '_'];

  // Build set of known field names
  const knownNames = new Set<string>();
  for (const fieldConfig of Object.values(config.fields)) {
    knownNames.add(fieldConfig.name);
  }

  // Check each arg
  for (const argName of Object.keys(args)) {
    if (systemFields.includes(argName)) {
      // Skip system fields
      continue;
    }
    if (!knownNames.has(argName)) {
      const availableFields = Array.from(knownNames).join(', ');
      throw new Error(`Неизвестное поле \`${argName}\`. Доступные поля: ${availableFields}`);
    }
  }
}

/**
 * Applies default values from config to fields.
 */
function applyDefaults(
  fields: Record<string, string | undefined>,
  config: Config,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [markdownKey, fieldConfig] of Object.entries(config.fields)) {
    const value = fields[markdownKey];
    if (value !== undefined && value !== '') {
      result[markdownKey] = value;
    } else if (fieldConfig.default !== undefined) {
      result[markdownKey] = fieldConfig.default;
    }
  }

  return result;
}

/**
 * Validates that all required fields have values.
 */
function validateRequired(fields: Record<string, string>, config: Config): void {
  for (const [markdownKey, fieldConfig] of Object.entries(config.fields)) {
    if (fieldConfig.required && !fields[markdownKey]) {
      throw new Error(
        `Не указано обязательное поле '${markdownKey}'. Используйте --${fieldConfig.name} "Значение"`,
      );
    }
  }
}

/**
 * Generates the next available main task ID.
 * Only generates main task IDs (1, 2, 3, ...), never subtask IDs.
 */
async function generateMainTaskId(storage: StorageService): Promise<string> {
  // 1. Get list from storage
  const tasks = await storage.list();

  // 2. Extract main task IDs (filter out subtasks and invalid IDs)
  const mainIds = tasks
    .map((t) => t.id.split('.')[0]) // "1.5" -> "1"
    .filter((v, i, a) => a.indexOf(v) === i) // unique
    .map(Number)
    .filter((n) => !isNaN(n)); // Filter out NaN from invalid IDs

  // 3. Find max, increment
  if (mainIds.length === 0) return '1';
  const maxId = Math.max(...mainIds);
  return String(maxId + 1);
}

/**
 * Generates a subtask ID under a parent task with best-effort collision detection.
 * Finds the maximum existing subtask number and increments it.
 *
 * @param parent - Parent task ID (must be a main task, not a subtask)
 * @param storage - Storage service to read existing tasks
 * @returns Generated subtask ID (e.g., "1.1", "1.2", etc.)
 * @throws {Error} if unable to generate unique ID after multiple attempts
 * @throws {Error} if generated ID exceeds 50 characters
 */
async function generateSubtaskId(parent: string, storage: StorageService): Promise<string> {
  let attempt = 0;
  const maxAttempts = 100; // Safety limit

  while (attempt < maxAttempts) {
    const tasks = await storage.list();
    const parentDepth = parent.split('.').length;

    // Filter: only direct children (exactly one more segment than parent)
    const siblings = tasks.filter((t) => {
      const parts = t.id.split('.');
      return parts.length === parentDepth + 1 && t.id.startsWith(parent + '.');
    });

    // Extract subtask numbers
    const subNumbers = siblings.map((t) => Number(t.id.split('.').pop())).filter((n) => !isNaN(n));

    // Find max, increment with attempt offset for collision handling
    const max = subNumbers.length > 0 ? Math.max(...subNumbers) : 0;
    const candidateId = `${parent}.${max + 1 + attempt}`;

    // Validate ID length (max 50 characters per architecture)
    if (candidateId.length > MAX_ID_LENGTH) {
      throw new Error(
        `Невозможно создать подзадачу: ID '${candidateId}' превышает максимальную длину ${MAX_ID_LENGTH} символов`,
      );
    }

    // Best-effort: check if file already exists (race condition detection)
    try {
      await storage.read(candidateId);
      // File exists, try next number
      attempt++;
      continue;
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        // File doesn't exist, safe to use
        return candidateId;
      }
      throw error;
    }
  }

  throw new Error('Не удалось сгенерировать уникальный ID после нескольких попыток');
}

/**
 * Parses dependencies from CLI argument format.
 * Format: comma-separated "1,2,3" -> ["1", "2", "3"]
 */
function parseDependencies(depsArg?: string): string[] {
  if (!depsArg || depsArg.trim() === '') {
    return [];
  }

  return depsArg
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d !== '');
}

/**
 * Converts collected fields to ParsedTask format.
 * Maps markdown keys to parser-compatible format.
 * @throws {Error} if custom field value is not a string
 */
function fieldsToParsedTask(fields: Record<string, unknown>): ParsedTask {
  // Validate standard fields are strings
  const title = fields.Title;
  const description = fields.Description;

  if (typeof title !== 'string') {
    throw new Error(
      `Невалидное значение для поля 'Title': ожидается строка, получено ${typeof title}`,
    );
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new Error(
      `Невалидное значение для поля 'Description': ожидается строка, получено ${typeof description}`,
    );
  }

  const task: ParsedTask = {
    title,
  };

  // Add description if present
  if (description) {
    task.description = description;
  }

  // Add custom fields with type validation (status is now a custom field in config)
  const standardKeys = new Set(['Title', 'Description']);
  for (const [key, value] of Object.entries(fields)) {
    if (!standardKeys.has(key)) {
      // Validate that custom fields are strings
      if (typeof value !== 'string') {
        throw new Error(
          `Невалидное значение для поля '${key}': ожидается строка, получено ${typeof value}`,
        );
      }
      // Convert to lowercase to match parser behavior
      task[key.toLowerCase()] = value;
    }
  }

  return task;
}

/**
 * Validates the parent task ID.
 * Throws ParentValidationError if validation fails.
 *
 * @param parent - Parent task ID from --parent option
 * @param storage - Storage service to check task existence
 * @throws {ParentValidationError} if parent is invalid
 */
async function validateParent(parent: string, storage: StorageService): Promise<void> {
  // Whitespace-only → treat as empty
  const trimmed = parent.trim();
  if (!trimmed) {
    throw new ParentValidationError(
      'ID родительской задачи не может быть пустым или содержать только пробелы',
    );
  }

  // Format validation
  if (!/^\d+(\.\d+)*$/.test(trimmed)) {
    throw new ParentValidationError(`Неверный формат ID родительской задачи: '${trimmed}'`);
  }

  // Depth validation (only main tasks can be parents)
  if (trimmed.includes('.')) {
    throw new ParentValidationError(
      `Родительская задача '${trimmed}' является подзадачей. Подзадачи не могут иметь свои подзадачи`,
    );
  }

  // Existence validation
  try {
    await storage.read(trimmed);
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      throw new ParentValidationError(`Родительская задача '${trimmed}' не существует`);
    }
    throw error;
  }
}

/**
 * Main implementation of the add command.
 */
export async function addCommand(options: AddCommandOptions, services: Services): Promise<string> {
  // 1. Get config
  const config = await services.config.load();

  // 2. Validate field names
  validateFieldNames(options, config);

  // 3. Validate parent (if specified)
  if (options.parent) {
    await validateParent(options.parent, services.storage);
  }

  // 4. Collect field values from arguments
  const fields = collectFields(options, config);

  // 5. Apply defaults from config
  const withDefaults = applyDefaults(fields, config);

  // 6. Validate required fields
  validateRequired(withDefaults, config);

  // 7. Generate ID (main or subtask based on parent)
  const id = options.parent
    ? await generateSubtaskId(options.parent, services.storage)
    : await generateMainTaskId(services.storage);

  // 8. Parse dependencies
  const dependencies = parseDependencies(options.dependencies);

  // 9. Check for logical circular dependency (subtask depends on parent)
  if (options.parent && dependencies.includes(options.parent)) {
    throw new CircularDependencyError(
      `Подзадача не может зависеть от своей родительской задачи '${options.parent}'`,
      [options.parent, id],
    );
  }

  // 10. Get status from defaults or use 'pending'
  const status = withDefaults.Status || 'pending';

  // 11. Build ParsedTask (without status and dependencies - they go to index)
  const parsedTask = fieldsToParsedTask(withDefaults);

  // 11. Serialize to Markdown
  const markdown = services.parser.serialize(parsedTask);

  // 12. Create in Storage
  await services.storage.create(id, markdown);

  // 13. Update Index (with rollback)
  try {
    await services.index.update(id, { status, dependencies });
  } catch (error) {
    // Rollback: delete the created task file
    try {
      await services.storage.delete(id);
    } catch (rollbackError) {
      // If rollback fails, log warning and attach rollback error to original error
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      console.warn(`Предупреждение: не удалось откатить создание задачи ${id}: ${rollbackMessage}`);

      // Attach rollback error to original error's cause chain for debugging
      if (error instanceof Error) {
        (error as NodeError).cause = rollbackError;
      }
    }
    throw error;
  }

  return id;
}

// Export helper functions for testing
export {
  collectFields,
  validateFieldNames,
  applyDefaults,
  validateRequired,
  generateMainTaskId,
  generateSubtaskId,
  validateParent,
  parseDependencies,
  fieldsToParsedTask,
};

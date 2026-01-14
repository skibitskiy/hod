import type { ParsedTask } from '../../parser/types.js';
import { ParserService } from '../../parser/parser.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import type { StorageService } from '../../storage/storage.js';

interface NodeError extends Error {
  cause?: unknown;
}

export interface AddCommandOptions {
  [fieldName: string]: string | undefined;
  dependencies?: string;
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
  // Build set of known field names
  const knownNames = new Set<string>();
  for (const fieldConfig of Object.values(config.fields)) {
    knownNames.add(fieldConfig.name);
  }

  // Check each arg
  for (const argName of Object.keys(args)) {
    if (argName === 'dependencies') {
      // dependencies is a special system field
      continue;
    }
    if (argName === '_') {
      // commander.js adds _ for positional args
      continue;
    }
    if (!knownNames.has(argName)) {
      const availableFields = Array.from(knownNames).join(', ');
      throw new Error(`Неизвестное поле '${argName}'. Доступные поля: ${availableFields}`);
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
 * Generates the next available task ID.
 * Only generates main task IDs (1, 2, 3, ...), never subtask IDs.
 */
async function generateId(storage: StorageService): Promise<string> {
  // 1. Get list from storage
  const tasks = await storage.list();

  // 2. Extract main task IDs (filter out subtasks)
  const mainIds = tasks
    .map((t) => t.id.split('.')[0]) // "1.5" -> "1"
    .filter((v, i, a) => a.indexOf(v) === i); // unique

  // 3. Find max, increment
  if (mainIds.length === 0) return '1';
  const maxId = Math.max(...mainIds.map(Number));
  return String(maxId + 1);
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
function fieldsToParsedTask(fields: Record<string, unknown>, dependencies: string[]): ParsedTask {
  // Validate standard fields are strings
  const title = fields.Title;
  const status = fields.Status;
  const description = fields.Description;

  if (typeof title !== 'string') {
    throw new Error(
      `Невалидное значение для поля 'Title': ожидается строка, получено ${typeof title}`,
    );
  }
  if (status !== undefined && typeof status !== 'string') {
    throw new Error(
      `Невалидное значение для поля 'Status': ожидается строка, получено ${typeof status}`,
    );
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new Error(
      `Невалидное значение для поля 'Description': ожидается строка, получено ${typeof description}`,
    );
  }

  const task: ParsedTask = {
    dependencies,
    status: status || 'pending',
    title,
  };

  // Add description if present
  if (description) {
    task.description = description;
  }

  // Add custom fields with type validation
  const standardKeys = new Set(['Title', 'Description', 'Status']);
  for (const [key, value] of Object.entries(fields)) {
    if (!standardKeys.has(key)) {
      // Validate that custom fields are strings
      if (typeof value !== 'string') {
        throw new Error(
          `Невалидное значение для поля '${key}': ожидается строка, получено ${typeof value}`,
        );
      }
      task[key] = value;
    }
  }

  return task;
}

/**
 * Main implementation of the add command.
 */
export async function addCommand(options: AddCommandOptions, services: Services): Promise<string> {
  // 1. Get config
  const config = await services.config.load();

  // 2. Validate field names
  validateFieldNames(options, config);

  // 3. Collect field values from arguments
  const fields = collectFields(options, config);

  // 4. Apply defaults from config
  const withDefaults = applyDefaults(fields, config);

  // 5. Validate required fields
  validateRequired(withDefaults, config);

  // 6. Generate ID
  const id = await generateId(services.storage);

  // 7. Parse dependencies
  const dependencies = parseDependencies(options.dependencies);

  // 8. Build ParsedTask
  const parsedTask = fieldsToParsedTask(withDefaults, dependencies);

  // 9. Serialize to Markdown
  const markdown = ParserService.serialize(parsedTask);

  // 10. Create in Storage
  await services.storage.create(id, markdown);

  // 11. Update Index (with rollback)
  try {
    await services.index.update(id, dependencies);
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
  generateId,
  parseDependencies,
  fieldsToParsedTask,
};

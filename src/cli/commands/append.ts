import type { ParsedTask } from '../../parser/types.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import type { AddCommandOptions } from './add.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { validateCliId } from '../../utils/validation.js';
import { collectFields, validateFieldNames } from './add.js';

interface NodeError extends Error {
  cause?: unknown;
}

export interface AppendCommandOptions extends AddCommandOptions {
  id: string;
}

/**
 * Parses task content that may be either JSON or markdown format.
 * Tries JSON first, falls back to markdown parser.
 *
 * @param content - The file content to parse
 * @param parser - ParserService for markdown parsing
 * @returns ParsedTask
 * @throws {Error} if content is invalid JSON or markdown
 */
function parseTaskContent(
  content: string,
  parser: typeof import('../../parser/parser.js').ParserService,
): ParsedTask {
  const trimmed = content.trim();

  // Try JSON first (check if it starts with {)
  if (trimmed.startsWith('{')) {
    try {
      const jsonData = JSON.parse(trimmed);
      // Validate it's an object
      if (typeof jsonData !== 'object' || jsonData === null || Array.isArray(jsonData)) {
        throw new Error('JSON task must be an object');
      }

      // Convert JSON data to ParsedTask format
      // JSON keys should match lowercase ParsedTask keys
      const task: ParsedTask = {
        title: jsonData.title as string,
      };

      // Add description if present
      if (jsonData.description !== undefined) {
        task.description = String(jsonData.description);
      }

      // Add custom fields (all other keys except title, description)
      const standardKeys = new Set(['title', 'description']);
      for (const [key, value] of Object.entries(jsonData)) {
        if (!standardKeys.has(key.toLowerCase()) && value !== undefined && value !== null) {
          // JSON keys are expected to be lowercase (matching ParsedTask format)
          task[key.toLowerCase()] = String(value);
        }
      }

      return task;
    } catch {
      // JSON parse failed, try markdown parser
      // Continue to markdown parsing below
    }
  }

  // Fall back to markdown parser
  return parser.parse(trimmed);
}

/**
 * Validates that provided fields are not system fields.
 * System fields (Status, Dependencies) are stored in index and cannot be appended to.
 * @throws {Error} if a system field is being appended to
 */
function validateNotSystemFields(
  collectedFields: Record<string, string | undefined>,
  options: Record<string, string | undefined>,
): void {
  // Check for Status in collected fields
  if (collectedFields.Status !== undefined) {
    throw new Error(
      `Нельзя добавить данные к системному полю 'Status'. Это поле хранится в индексе и не поддерживает append.`,
    );
  }

  // Check for Dependencies in raw options (not collected by collectFields)
  if (options.dependencies !== undefined) {
    throw new Error(
      `Нельзя добавить данные к системному полю 'Dependencies'. Это поле хранится в индексе и не поддерживает append.`,
    );
  }
}

/**
 * Validates that required fields are not empty after appending.
 * @throws {Error} if a required field is empty
 */
function validateRequiredFields(task: ParsedTask, config: Config): void {
  for (const [markdownKey, fieldConfig] of Object.entries(config.fields)) {
    if (fieldConfig.required) {
      // Map markdown key to lowercase key in ParsedTask
      const taskKey = markdownKey.toLowerCase();
      const value = task[taskKey];

      if (value === undefined || value === '') {
        throw new Error(`Поле '${markdownKey}' не может быть пустым`);
      }
    }
  }
}

/**
 * Main implementation of the append command.
 */
export async function appendCommand(
  options: AppendCommandOptions,
  services: Services,
): Promise<string> {
  const { id } = options;

  // 1. Validate ID format using regex from validation module
  validateCliId(id);

  // 2. Check task existence via storage.exists()
  const exists = await services.storage.exists(id);
  if (!exists) {
    throw new StorageNotFoundError(id);
  }

  // 3. Get config
  const config = await services.config.load();

  // 4. Validate field names (fail-fast, like in list.ts)
  // Exclude 'id' from validation (it's a positional argument, not a field)
  const optionsForValidation: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key !== 'id') {
      optionsForValidation[key] = value;
    }
  }
  validateFieldNames(optionsForValidation, config);

  // 5. Read current content via storage.read()
  const currentContent = await services.storage.read(id);

  // 6. Parse content (may be JSON or markdown) to get current ParsedTask
  // Use parseTaskContent for dual-format support (tries JSON first, falls back to markdown)
  const currentTask = parseTaskContent(currentContent, services.parser);

  // 7. Collect new field values from options (reuse collectFields from add.ts)
  // Exclude 'id' from collection (it's a positional argument, not a field)
  const optionsForCollection: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key !== 'id') {
      optionsForCollection[key] = value;
    }
  }
  const collectedFields = collectFields(optionsForCollection, config);

  // 8. Validate that we're not trying to append to system fields
  // Pass both collected fields and raw options to check for dependencies
  validateNotSystemFields(collectedFields, optionsForCollection);

  // 9. Also validate that required fields are not being set to empty
  for (const [markdownKey, fieldConfig] of Object.entries(config.fields)) {
    if (fieldConfig.required) {
      const cliFieldName = fieldConfig.name;
      // Check if this required field is being set to empty via options
      if (optionsForCollection[cliFieldName] === '') {
        throw new Error(`Поле '${markdownKey}' не может быть пустым`);
      }
    }
  }

  // 10. Build updated ParsedTask: for each field in options, append to current value with \n separator
  const updatedTask: ParsedTask = { ...currentTask };

  for (const [markdownKey, valueToAppend] of Object.entries(collectedFields)) {
    if (valueToAppend === undefined || valueToAppend === '') {
      // Skip empty values (no-op for append)
      continue;
    }

    const taskKey = markdownKey.toLowerCase();
    const currentValue = updatedTask[taskKey];

    if (currentValue === undefined || currentValue === '') {
      // Field doesn't exist or is empty, just set the new value
      updatedTask[taskKey] = valueToAppend;
    } else {
      // Append with \n separator
      updatedTask[taskKey] = `${currentValue}\n${valueToAppend}`;
    }
  }

  // 11. Validate required fields after applying updates
  validateRequiredFields(updatedTask, config);

  // 12. Serialize to JSON via parser.serializeToJson()
  const jsonData = services.parser.serializeToJson(updatedTask);

  // 13. Store original content for potential rollback
  const originalContent = currentContent;

  // 13. Write via storage.update() (atomic)
  await services.storage.update(id, jsonData);

  // 14. Get current status/dependencies from index (no changes for append)
  const currentIndexData = await services.index.load();
  const currentStatus = currentIndexData[id]?.status ?? 'pending';
  const currentDependencies = currentIndexData[id]?.dependencies ?? [];

  // 15. Update index via index.update() with same values (rollback storage if this fails)
  // This ensures index is in sync even though we don't modify status/dependencies
  try {
    await services.index.update(id, {
      status: currentStatus,
      dependencies: currentDependencies,
    });
  } catch (error) {
    // Rollback storage by updating with old content
    try {
      await services.storage.update(id, originalContent);
    } catch (rollbackError) {
      // If rollback fails, log warning and throw original error
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      console.warn(
        `Предупреждение: не удалось откатить обновление задачи ${id}: ${rollbackMessage}`,
      );

      // Attach rollback error to original error's cause chain for debugging
      if (error instanceof Error) {
        (error as NodeError).cause = rollbackError;
      }
    }
    throw error;
  }

  // 16. Output success message
  return id;
}

// Export helper functions for testing
export { validateNotSystemFields, validateRequiredFields };

import type { ParsedTask } from '../../parser/types.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import type { AddCommandOptions } from './add.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { validateCliId } from '../../utils/validation.js';
import { collectFields, validateFieldNames, parseDependencies } from './add.js';

interface NodeError extends Error {
  cause?: unknown;
}

export interface UpdateCommandOptions extends AddCommandOptions {
  id: string;
}

/**
 * Validates that required fields are not empty.
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
 * Removes a field from the ParsedTask by setting it to undefined.
 * Used for optional fields when empty string is provided.
 */
function removeOptionalField(task: ParsedTask, markdownKey: string): void {
  const taskKey = markdownKey.toLowerCase();
  delete task[taskKey];
}

/**
 * Main implementation of the update command.
 */
export async function updateCommand(
  options: UpdateCommandOptions,
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

  // 6. Parse via parser.parseJson() to get current ParsedTask
  const currentTask = services.parser.parseJson(currentContent);

  // 7. Collect new field values from options (reuse collectFields from add.ts)
  // Exclude 'id' from collection (it's a positional argument, not a field)
  const optionsForCollection: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key !== 'id') {
      optionsForCollection[key] = value;
    }
  }
  const collectedFields = collectFields(optionsForCollection, config);

  // 8. Parse dependencies from --dependencies option (reuse parseDependencies from add.ts)
  // Note: empty string clears all dependencies (unlike Status which cannot be empty)
  const dependenciesOption = options.dependencies;
  const newDependencies = parseDependencies(dependenciesOption);

  // 9. Build updated ParsedTask: start with current task, replace values for any fields that were provided in options
  const updatedTask: ParsedTask = { ...currentTask };

  // Extract status from collected fields if present (for index update)
  // Do this BEFORE processing fields so we can validate empty Status
  let statusForIndex: string | undefined;
  if (collectedFields.Status !== undefined) {
    // Validate Status is not empty
    if (collectedFields.Status === '') {
      throw new Error(`Поле 'Status' не может быть пустым`);
    }
    statusForIndex = collectedFields.Status;
    // Status doesn't go to markdown anymore, so remove it from collected fields
    delete collectedFields.Status;
  }

  // Process each field from options
  for (const [markdownKey, value] of Object.entries(collectedFields)) {
    const taskKey = markdownKey.toLowerCase();

    if (value === '' || value === undefined) {
      // System fields (Status, Dependencies) cannot be removed
      if (markdownKey === 'Status' || markdownKey === 'Dependencies') {
        throw new Error(`Поле '${markdownKey}' не может быть пустым`);
      }
      // Empty string for optional field removes it
      if (!config.fields[markdownKey]?.required) {
        removeOptionalField(updatedTask, markdownKey);
      } else {
        // Empty string for required field is an error
        throw new Error(`Поле '${markdownKey}' не может быть пустым`);
      }
    } else {
      // Specified fields replace current values
      updatedTask[taskKey] = value;
    }
  }

  // 10. Validate required fields after applying updates
  validateRequiredFields(updatedTask, config);

  // 11. Serialize via parser.serializeToJson()
  const jsonData = services.parser.serializeToJson(updatedTask);

  // 12. Store original content for potential rollback
  const originalContent = currentContent;

  // 13. Write via storage.update() (atomic)
  await services.storage.update(id, jsonData);

  // 14. Get current status/dependencies from index for partial updates
  const currentIndexData = await services.index.load();
  const currentStatus = currentIndexData[id]?.status ?? 'pending'; // Default to 'pending' if not in index
  const currentDependencies = currentIndexData[id]?.dependencies ?? [];

  // 15. Update index via index.update() (rollback storage if this fails)
  try {
    await services.index.update(id, {
      status: statusForIndex ?? currentStatus,
      dependencies: dependenciesOption !== undefined ? newDependencies : currentDependencies,
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

  // 15. Output success message
  return id;
}

// Export helper functions for testing
export { validateRequiredFields, removeOptionalField };

import type { Services } from '../services.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { validateCliId } from '../../utils/validation.js';
import { findDirectSubtasks, formatSubtaskList } from '../utils/subtasks.js';

export interface DeleteCommandOptions {
  id: string;
  recursive?: boolean;
}

/**
 * Main implementation of the delete command.
 */
export async function deleteCommand(
  options: DeleteCommandOptions,
  services: Services,
): Promise<string> {
  const { id, recursive = false } = options;

  // 1. Validate ID format
  validateCliId(id);

  // 2. Check task existence via storage.exists() — error if not found
  const exists = await services.storage.exists(id);
  if (!exists) {
    throw new StorageNotFoundError(id);
  }

  // 3. Check for subtasks via storage.list()
  const allTasks = await services.storage.list();
  const subtasks = findDirectSubtasks(id, allTasks);

  // 4. If subtasks exist and -r flag is not specified
  if (subtasks.length > 0 && !recursive) {
    const subtaskList = formatSubtaskList(subtasks);
    throw new Error(
      `Задача ${id} имеет подзадачи: ${subtaskList}. Используйте -r для рекурсивного удаления`,
    );
  }

  // 5. If subtasks exist and -r flag is specified
  if (subtasks.length > 0 && recursive) {
    // Collect all direct subtasks (depth-based matching: only tasks with parts.length === parentDepth + 1)
    // Delete each subtask from storage first, then from index
    // Note: If index.remove() fails for a subtask, the storage file is already deleted.
    // This inconsistency can be fixed via 'hod sync'.
    for (const subtask of subtasks) {
      await services.storage.delete(subtask.id);
      await services.index.remove(subtask.id);
    }
  }

  // 6. Read task content for potential rollback before deleting
  const taskContent = await services.storage.read(id);

  // 7. Delete the task itself via storage.delete()
  await services.storage.delete(id);

  // 8. Remove task from index via index.remove() with rollback
  try {
    await services.index.remove(id);
  } catch (error) {
    // Rollback: restore the task file if index removal fails
    try {
      await services.storage.create(id, taskContent);
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      console.warn(
        `Предупреждение: не удалось откатить удаление задачи ${id}: ${rollbackMessage}. Запустите 'hod sync' для исправления.`,
      );
    }
    throw error;
  }

  // 9. Output success message
  return id;
}

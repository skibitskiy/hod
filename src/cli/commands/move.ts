import type { Services } from '../services.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { validateCliId } from '../../utils/validation.js';
import { generateSubtaskId } from './add.js';
import { findDirectSubtasks } from '../utils/subtasks.js';

interface NodeError extends Error {
  cause?: unknown;
}

export interface MoveCommandOptions {
  id: string;
  parent?: string;
}

/**
 * Extracts current parent from task ID.
 * @returns Parent ID or undefined for main tasks
 */
function extractCurrentParent(taskId: string): string | undefined {
  if (!taskId.includes('.')) {
    return undefined; // Main task, no parent
  }
  return taskId.split('.')[0]; // First segment is parent
}

/**
 * Main implementation of the move command.
 */
export async function moveCommand(
  options: MoveCommandOptions,
  services: Services,
): Promise<string> {
  const { id, parent } = options;

  // 1. Validate format of the task being moved
  validateCliId(id);

  // 2. Check that --parent is specified
  if (!parent) {
    throw new Error('--parent обязателен для команды move');
  }

  // 3. Validate format of the new parent
  validateCliId(parent);

  // 4. Check existence of the task being moved
  const taskExists = await services.storage.exists(id);
  if (!taskExists) {
    throw new StorageNotFoundError(id);
  }

  // 5. Check existence of the new parent
  const parentExists = await services.storage.exists(parent);
  if (!parentExists) {
    throw new Error(`Родительская задача ${parent} не существует`);
  }

  // 6. Verify that the new parent is a main task (not a subtask)
  if (parent.includes('.')) {
    throw new Error(
      `Задача ${parent} является подзадачей. Только основные задачи могут быть родительскими`,
    );
  }

  // 7. Check if new parent equals current parent
  const currentParent = extractCurrentParent(id);
  if (currentParent === parent) {
    // No-op, output success message and exit
    return id;
  }

  // 8. Check for subtasks on the task being moved
  const allTasks = await services.storage.list();
  const subtasks = findDirectSubtasks(id, allTasks);

  if (subtasks.length > 0) {
    throw new Error(
      `Задача ${id} имеет подзадачи. Перемещение задач с подзадачами не поддерживается`,
    );
  }

  // 9. Read and parse the current task
  const currentContent = await services.storage.read(id);
  const currentTask = services.parser.parse(currentContent);

  // 10. Generate new ID under the new parent
  const newId = await generateSubtaskId(parent, services.storage);

  // 11. Check dependencies for cycles considering the new ID
  // Note: index.update() will do this automatically, but we need to handle rollback

  // 12. Create new task with new ID via storage.create()
  const markdown = services.parser.serialize(currentTask);
  await services.storage.create(newId, markdown);

  // 13. Update index via index.update() (with rollback on error)
  try {
    await services.index.update(newId, {
      status: currentTask.status,
      dependencies: currentTask.dependencies,
    });
  } catch (error) {
    // Rollback: delete new task from storage
    try {
      await services.storage.delete(newId);
    } catch (rollbackError) {
      // If rollback fails, log warning and throw original error
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      console.warn(
        `Предупреждение: не удалось откатить создание задачи ${newId}: ${rollbackMessage}`,
      );

      // Attach rollback error to original error's cause chain for debugging
      if (error instanceof Error) {
        (error as NodeError).cause = rollbackError;
      }
    }
    throw error;
  }

  // 14. Delete old task via storage.delete()
  await services.storage.delete(id);

  // 15. Remove old task from index via index.remove() with rollback
  try {
    await services.index.remove(id);
  } catch (error) {
    // Rollback: restore the old task file and clean up the new task
    try {
      await services.storage.create(id, currentContent);
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      console.warn(
        `Предупреждение: не удалось восстановить задачу ${id}: ${rollbackMessage}. Запустите 'hod sync' для исправления.`,
      );
    }
    // Also try to clean up the new task and its index entry
    try {
      await services.index.remove(newId);
      await services.storage.delete(newId);
    } catch (cleanupError) {
      const cleanupMessage =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.warn(
        `Предупреждение: не удалось очистить новую задачу ${newId}: ${cleanupMessage}. Запустите 'hod sync' для исправления.`,
      );
    }
    throw error;
  }

  // 16. Output success message with new ID
  return `${id} -> ${newId}`;
}

// Export helper functions for testing
export { extractCurrentParent };

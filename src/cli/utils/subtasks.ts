import type { Task } from '../../storage/storage.js';

/**
 * Finds direct subtasks of a parent using depth-based matching.
 * A task is a subtask if: parts.length === parentParts.length + 1 && id.startsWith(parentId + '.')
 *
 * This ensures:
 * - 1.1 is a child of 1
 * - 1.10 is NOT a child of 1.1
 *
 * @param parentId - The parent task ID
 * @param allTasks - All tasks in storage
 * @returns Array of direct subtasks
 */
export function findDirectSubtasks(parentId: string, allTasks: Task[]): Task[] {
  const parentDepth = parentId.split('.').length;
  return allTasks.filter((task) => {
    const parts = task.id.split('.');
    return parts.length === parentDepth + 1 && task.id.startsWith(parentId + '.');
  });
}

/**
 * Formats a list of subtasks for error messages.
 * @param subtasks - Array of subtasks to format
 * @returns Comma-separated list of subtask IDs
 */
export function formatSubtaskList(subtasks: Task[]): string {
  return subtasks
    .map((s) => s.id)
    .sort()
    .join(', ');
}

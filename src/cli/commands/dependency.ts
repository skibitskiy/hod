import type { Services } from '../services.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { validateCliId } from '../../utils/validation.js';

export interface DependencyCommandOptions {
  id: string;
  add?: string[];
  delete?: string[];
}

export interface DependencyCommandResult {
  id: string;
  dependencies: string[];
  added: string[];
  removed: string[];
}

/**
 * Main implementation of the dependency command.
 * Adds and/or removes dependencies from an existing task.
 *
 * @returns Result object with final state and what was actually changed
 */
export async function dependencyCommand(
  options: DependencyCommandOptions,
  services: Services,
): Promise<DependencyCommandResult> {
  const { id } = options;

  // 1. Validate ID format
  validateCliId(id);

  // 2. Check task existence
  const exists = await services.storage.exists(id);
  if (!exists) {
    throw new StorageNotFoundError(id);
  }

  // 3. Normalize add/delete arrays
  const toAdd = options.add ?? [];
  const toDelete = options.delete ?? [];

  // 4. Require at least one operation
  if (toAdd.length === 0 && toDelete.length === 0) {
    throw new Error('Необходимо указать хотя бы один из флагов: --add или --delete');
  }

  // 5. Validate all dependency IDs
  for (const depId of [...toAdd, ...toDelete]) {
    validateCliId(depId);
  }

  // 6. Load current index
  const indexData = await services.index.load();
  const currentStatus = indexData[id]?.status ?? 'pending';
  const currentDeps = indexData[id]?.dependencies ?? [];

  // 7. Compute new dependencies
  const depsSet = new Set(currentDeps);

  const added: string[] = [];
  for (const depId of toAdd) {
    if (!depsSet.has(depId)) {
      depsSet.add(depId);
      added.push(depId);
    }
  }

  const removed: string[] = [];
  for (const depId of toDelete) {
    if (depsSet.has(depId)) {
      depsSet.delete(depId);
      removed.push(depId);
    }
  }

  const newDeps = Array.from(depsSet);

  // 8. Update index (circular dependency check is handled inside index.update)
  await services.index.update(id, {
    status: currentStatus,
    dependencies: newDeps,
  });

  return { id, dependencies: newDeps, added, removed };
}

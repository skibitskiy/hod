import type { Services } from '../services.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { validateCliId } from '../../utils/validation.js';
import { DEFAULT_DONE_STATUS } from '../../config/types.js';

export interface DoneCommandOptions {
  id: string;
}

export interface DoneCommandResult {
  id: string;
  wasAlreadyDone: boolean;
  doneStatus: string;
}

/**
 * Main implementation of the done command.
 * Marks a task as completed by setting its status to the configured doneStatus value.
 *
 * @returns Result object with task id, whether it was already done, and the done status used
 */
export async function doneCommand(
  options: DoneCommandOptions,
  services: Services,
): Promise<DoneCommandResult> {
  const { id } = options;

  // 1. Validate ID format
  validateCliId(id);

  // 2. Check task existence
  const exists = await services.storage.exists(id);
  if (!exists) {
    throw new StorageNotFoundError(id);
  }

  // 3. Get config to retrieve doneStatus value
  // Fallback chain: doneStatus -> first doneStatuses value -> DEFAULT_DONE_STATUS
  const config = await services.config.load();
  const doneStatusValue = config.doneStatus ?? config.doneStatuses?.[0] ?? DEFAULT_DONE_STATUS;

  // 4. Get current status from index
  const currentIndexData = await services.index.load();
  const currentStatus = currentIndexData[id]?.status ?? 'pending';

  // 5. Check if task already has the done status
  if (currentStatus === doneStatusValue) {
    // Return result indicating no-op (CLI layer will handle the warning message)
    return { id, wasAlreadyDone: true, doneStatus: doneStatusValue };
  }

  // 6. Update index with new status (dependencies remain unchanged)
  const currentDependencies = currentIndexData[id]?.dependencies ?? [];

  await services.index.update(id, {
    status: doneStatusValue,
    dependencies: currentDependencies,
  });

  // 7. Return success
  return { id, wasAlreadyDone: false, doneStatus: doneStatusValue };
}

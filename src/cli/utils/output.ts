import type { ParsedTask } from '../../parser/types.js';
import type { Config } from '../../config/types.js';
import { sortIds } from '../../utils/sort.js';

/**
 * Outputs a single task in the full format:
 * ID: <id>
 * Title: <title>
 * Status: <status>
 * Dependencies: <deps>
 * <CustomField>: <value>
 */
export function outputTaskFull(
  id: string,
  parsed: ParsedTask,
  indexEntry: { status: string; dependencies: string[] } | undefined,
  config: Config,
): void {
  console.log(`ID: ${id}`);

  // Output title
  if (parsed.title) {
    console.log(`Title: ${parsed.title}`);
  }

  // Output status from index
  if (indexEntry) {
    console.log(`Status: ${indexEntry.status}`);
  }

  // Output dependencies from index (sorted)
  if (indexEntry && indexEntry.dependencies.length > 0) {
    const sortedDeps = sortIds(indexEntry.dependencies);
    console.log(`Dependencies: ${sortedDeps.join(', ')}`);
  }

  // Output custom fields from config
  for (const [markdownKey, fieldConfig] of Object.entries(config.fields)) {
    if (markdownKey === 'Title' || markdownKey === 'Status') continue; // Already handled

    const fieldName = fieldConfig.name;
    const value = parsed[fieldName];
    if (value !== undefined && value !== '') {
      console.log(`${markdownKey}: ${value}`);
    }
  }
}

/**
 * Outputs multiple tasks in the full format with separator.
 */
export function outputTasksFull(
  tasks: Array<{ id: string; task: ParsedTask }>,
  indexData: Record<string, { status: string; dependencies: string[] }>,
  config: Config,
): void {
  for (let i = 0; i < tasks.length; i++) {
    if (i > 0) {
      console.log('---');
    }
    const { id, task } = tasks[i];
    outputTaskFull(id, task, indexData[id], config);
  }
}

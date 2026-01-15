import type { ParsedTask } from '../../parser/types.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import { StorageAccessError } from '../../storage/errors.js';
import { sortIds } from '../../utils/sort.js';
import { buildTree, formatTree, detectOrphans, treeToJson } from '../tree.js';

export interface ListCommandOptions {
  [key: string]: string | boolean | undefined;
  tree?: boolean;
}

/**
 * Main implementation of the list command.
 */
export async function listCommand(options: ListCommandOptions, services: Services): Promise<void> {
  // 1. Load config and validate field names (fail-fast)
  const config = await services.config.load();
  const fields = config.fields;
  const availableFields = Object.values(fields).map((f) => f.name);

  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === 'json' || key === 'tree') continue;
    if (value === undefined) continue;
    if (typeof value !== 'string') continue;

    if (!availableFields.includes(key)) {
      throw new Error(`Неизвестное поле \`${key}\`. Доступные поля: ${availableFields.join(', ')}`);
    }
    filters[key] = value;
  }

  // 2. Load all tasks from storage
  let tasks: Array<{ id: string; content: string }>;
  try {
    tasks = await services.storage.list();
  } catch (error) {
    if (error instanceof StorageAccessError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // 3. Parse each task with error handling
  const parsed: Array<{ id: string; task: ParsedTask }> = [];
  for (const task of tasks) {
    try {
      parsed.push({
        id: task.id,
        task: services.parser.parse(task.content),
      });
    } catch (error) {
      console.error(`Предупреждение: задача ${task.id}: ${(error as Error).message} — пропущена`);
    }
  }

  // 4. Apply filters
  const filtered = parsed.filter(({ task }) => {
    for (const [key, value] of Object.entries(filters)) {
      // Missing field -> filter fails
      if (task[key] === undefined) return false;
      // Case-sensitive strict equality
      if (task[key] !== value) return false;
    }
    return true;
  });

  // 5. Output
  if (options.tree) {
    outputTree(filtered, !!options.json);
  } else if (options.json) {
    outputJson(filtered, fields);
  } else {
    outputTable(filtered, fields);
  }
}

/**
 * Outputs tasks as JSON.
 */
function outputJson(
  filtered: Array<{ id: string; task: ParsedTask }>,
  fields: Config['fields'],
): void {
  if (filtered.length === 0) {
    console.log('[]');
    return;
  }

  const result = filtered.map(({ id, task }) => {
    const obj: Record<string, string | string[]> = { id };

    for (const field of Object.values(fields)) {
      const val = task[field.name];
      // Skip missing fields (undefined)
      if (val !== undefined) {
        obj[field.name] = val;
      }
    }

    // Dependencies from parser (sortIds doesn't mutate input)
    obj.dependencies = sortIds(task.dependencies);
    return obj;
  });

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Outputs tasks as a table.
 */
function outputTable(
  filtered: Array<{ id: string; task: ParsedTask }>,
  fields: Config['fields'],
): void {
  if (filtered.length === 0) {
    console.log('Нет задач');
    return;
  }

  // 1. Get field keys sorted alphabetically by Markdown key
  const fieldKeys = Object.keys(fields).sort();

  // 2. Calculate column widths
  const colWidths: Record<string, number> = { id: 4 };
  for (const key of fieldKeys) {
    const cliName = fields[key].name;
    const header = key; // Markdown key as header
    const maxVal = Math.max(
      header.length,
      ...filtered.map((f) => (f.task[cliName] ?? '-').toString().length),
    );
    colWidths[cliName] = maxVal;
  }

  // 3. Print header
  const headerParts = fieldKeys.map((k) => {
    const cliName = fields[k].name;
    return k.padEnd(colWidths[cliName]);
  });
  console.log(`ID  ${headerParts.join('  ')}`);

  // 4. Print data rows
  for (const { id, task } of filtered) {
    const values = fieldKeys.map((k) => {
      const cliName = fields[k].name;
      const val = task[cliName];
      // Handle special chars and empty values
      const isEmpty = val === undefined || val === '';
      const clean = isEmpty ? '-' : val.toString().replace(/[\n\r\t]+/g, ' ');
      return clean.padEnd(colWidths[cliName]);
    });
    console.log(`${id.padEnd(4)}${values.join('  ')}`);
  }
}

/**
 * Outputs tasks as a tree structure.
 */
function outputTree(filtered: Array<{ id: string; task: ParsedTask }>, asJson: boolean): void {
  // Build tree with warnings
  const { tree, warnings } = buildTree(filtered);

  // Output any warnings from tree building
  for (const warning of warnings) {
    console.warn(warning);
  }

  // Detect orphaned subtasks
  const orphans = detectOrphans(tree);
  if (orphans.length > 0) {
    console.warn(`Предупреждение: обнаружены ${orphans.length} подзадач с отсутствующими родителями: ${orphans.join(', ')}`);
  }

  // Output tree
  if (tree.length === 0) {
    console.log('Нет задач');
    return;
  }

  if (asJson) {
    // Hierarchical JSON with minimal schema
    console.log(JSON.stringify(treeToJson(tree), null, 2));
  } else {
    // Text tree with box-drawing characters
    console.log(formatTree(tree));
  }
}

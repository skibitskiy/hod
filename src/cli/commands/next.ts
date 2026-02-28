import type { ParsedTask } from '../../parser/types.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import { StorageAccessError } from '../../storage/errors.js';
import { sortIds } from '../../utils/sort.js';
import { DEFAULT_DONE_STATUS } from '../../config/types.js';
import { outputTasksFull } from '../utils/output.js';

export interface NextCommandOptions {
  [key: string]: string | boolean | number | undefined;
  all?: boolean;
  json?: boolean;
  limit?: number;
}

/**
 * Main implementation of the next command.
 */
export async function nextCommand(options: NextCommandOptions, services: Services): Promise<void> {
  // 1. Load config to get doneStatuses
  // Fallback: doneStatuses -> [doneStatus] -> [DEFAULT_DONE_STATUS]
  const config = await services.config.load();
  const doneStatuses =
    config.doneStatuses ?? (config.doneStatus ? [config.doneStatus] : [DEFAULT_DONE_STATUS]);

  // 2. Get next task IDs from index service
  const nextIds = await services.index.getNextTasks(doneStatuses);

  if (nextIds.length === 0) {
    console.log('Нет задач готовых к выполнению');
    return;
  }

  // 3. Determine which field names are selected via flags
  const allFieldNames = new Set([
    ...Object.values(config.fields).map((f) => f.name),
    'dependencies',
  ]);
  const selectedFieldNames = [...allFieldNames].filter((name) => options[name] === true);
  const selectedFields = selectedFieldNames.length > 0 ? new Set(selectedFieldNames) : undefined;

  // 4. If --all flag is not set, show only the first task; apply --limit if set
  let idsToShow = options.all ? nextIds : [nextIds[0]];
  if (options.all && options.limit !== undefined && options.limit > 0) {
    idsToShow = idsToShow.slice(0, options.limit);
  }

  // 5. Load tasks from storage
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

  // 6. Filter and parse tasks to show
  const taskMap = new Map(tasks.map((t) => [t.id, t.content]));
  const parsed: Array<{ id: string; task: ParsedTask }> = [];

  for (const id of idsToShow) {
    const content = taskMap.get(id);
    if (!content) {
      console.error(`Предупреждение: задача ${id} не найдена в хранилище`);
      continue;
    }

    try {
      const trimmed = content.trim();
      let parsedTask: ParsedTask;

      if (trimmed.startsWith('{')) {
        parsedTask = services.parser.parseJson(content);
      } else {
        parsedTask = services.parser.parse(content);
      }

      parsed.push({ id, task: parsedTask });
    } catch (error) {
      console.error(`Предупреждение: задача ${id}: ${(error as Error).message} — пропущена`);
    }
  }

  if (parsed.length === 0) {
    console.log('Нет задач доступных для показа (задачи не найдены в хранилище)');
    return;
  }

  // 7. Load index data for status display
  const indexData = await services.index.load();

  // 8. Output
  if (options.json) {
    outputJson(parsed, indexData, config.fields, selectedFields);
  } else {
    outputTasksFull(parsed, indexData, config, selectedFields);
  }
}

/**
 * Outputs tasks as JSON.
 */
function outputJson(
  filtered: Array<{ id: string; task: ParsedTask }>,
  indexData: Record<string, { status: string; dependencies: string[] }>,
  fields: Config['fields'],
  selectedFields?: Set<string>,
): void {
  if (filtered.length === 0) {
    console.log('[]');
    return;
  }

  const result = filtered.map(({ id, task }) => {
    const obj: Record<string, string | string[]> = { id };

    for (const field of Object.values(fields)) {
      if (selectedFields && !selectedFields.has(field.name)) continue;
      const val = task[field.name];
      if (val !== undefined) {
        obj[field.name] = val;
      }
    }

    const indexEntry = indexData[id];
    if (indexEntry) {
      if (!selectedFields || selectedFields.has('status')) {
        obj.status = indexEntry.status;
      }
      if (!selectedFields || selectedFields.has('dependencies')) {
        obj.dependencies = sortIds(indexEntry.dependencies);
      }
    }
    return obj;
  });

  console.log(JSON.stringify(result, null, 2));
}

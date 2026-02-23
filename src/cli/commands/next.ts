import type { ParsedTask } from '../../parser/types.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import { StorageAccessError } from '../../storage/errors.js';
import { sortIds } from '../../utils/sort.js';
import { DEFAULT_DONE_STATUS } from '../../config/types.js';
import { outputTasksFull } from '../utils/output.js';

export interface NextCommandOptions {
  [key: string]: string | boolean | undefined;
  all?: boolean;
  json?: boolean;
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

  // 3. If --all flag is not set, show only the first task
  const idsToShow = options.all ? nextIds : [nextIds[0]];

  // 4. Load tasks from storage
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

  // 5. Filter and parse tasks to show
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

  // 6. Load index data for status display
  const indexData = await services.index.load();

  // 7. Output
  if (options.json) {
    outputJson(parsed, indexData, config.fields);
  } else {
    outputTasksFull(parsed, indexData, config);
  }
}

/**
 * Outputs tasks as JSON.
 */
function outputJson(
  filtered: Array<{ id: string; task: ParsedTask }>,
  indexData: Record<string, { status: string; dependencies: string[] }>,
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
      if (val !== undefined) {
        obj[field.name] = val;
      }
    }

    const indexEntry = indexData[id];
    if (indexEntry) {
      obj.status = indexEntry.status;
      obj.dependencies = sortIds(indexEntry.dependencies);
    }
    return obj;
  });

  console.log(JSON.stringify(result, null, 2));
}

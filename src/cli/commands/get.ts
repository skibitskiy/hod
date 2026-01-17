import type { ParsedTask } from '../../parser/types.js';
import type { Services } from '../services.js';
import type { Config } from '../../config/types.js';
import type { TaskData } from '../../types.js';
import type { IndexData } from '../../index/types.js';
import { validateCliId } from '../../utils/validation.js';
import { generate } from '../../formatters/generator.js';
import { ParseError } from '../../parser/types.js';

export interface GetCommandOptions {
  title?: boolean;
  dependencies?: boolean;
  status?: boolean;
  json?: boolean;
  markdown?: boolean;
}

/**
 * Detects if content is JSON or markdown format.
 * Uses JSON.parse() to validate instead of brittle brace checking.
 */
function isJsonContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    // Must be an object (not null, array, or primitive)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Main implementation of the get command.
 */
export async function getCommand(
  id: string,
  options: GetCommandOptions,
  services: Services,
): Promise<void> {
  // 1. Validate ID format and length
  try {
    validateCliId(id);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Неверный формат ID');
  }

  // 2. Load task from storage
  let content: string;
  try {
    content = await services.storage.read(id);
  } catch (error) {
    if (error instanceof Error && error.message.includes('не найден')) {
      throw new Error(`Задача с ID "${id}" не найдена`);
    }
    throw error;
  }

  // 3. Parse content (JSON or markdown)
  let parsed: ParsedTask;

  try {
    if (isJsonContent(content)) {
      parsed = services.parser.parseJson(content);
    } else {
      parsed = services.parser.parse(content);
    }
  } catch (error) {
    if (error instanceof ParseError) {
      throw new Error(`Ошибка парсинга задачи ${id}: ${error.message}`);
    }
    throw error;
  }

  // 4. Load index data (status and dependencies)
  const indexData = await services.index.load();
  const indexEntry = indexData[id];

  // 5. Load config for field mappings
  const config = await services.config.load();

  // 6. Output based on options
  if (options.markdown) {
    outputMarkdown(id, parsed, indexData);
  } else if (options.json) {
    outputJson(id, parsed, indexEntry);
  } else if (options.title) {
    outputTitle(id, parsed);
  } else if (options.status) {
    outputStatus(id, indexEntry);
  } else if (options.dependencies) {
    outputDependencies(id, indexEntry);
  } else {
    outputFull(id, parsed, indexEntry, config);
  }
}

/**
 * Output only title with ID: "1. Title"
 */
function outputTitle(id: string, parsed: ParsedTask): void {
  const title = parsed.title || '<без заголовка>';
  console.log(`${id}. ${title}`);
}

/**
 * Output only status
 */
function outputStatus(
  id: string,
  indexEntry: { status: string; dependencies: string[] } | undefined,
): void {
  if (!indexEntry) {
    throw new Error(
      `Задача ${id} не найдена в индексе. Это может указывать на повреждение данных. Запустите 'hod sync' для восстановления индекса.`,
    );
  }
  console.log(indexEntry.status);
}

/**
 * Output only dependencies
 */
function outputDependencies(
  id: string,
  indexEntry: { status: string; dependencies: string[] } | undefined,
): void {
  if (!indexEntry) {
    throw new Error(
      `Задача ${id} не найдена в индексе. Это может указывать на повреждение данных. Запустите 'hod sync' для восстановления индекса.`,
    );
  }
  if (indexEntry.dependencies.length === 0) {
    console.log('Нет зависимостей');
    return;
  }
  console.log(indexEntry.dependencies.join(', '));
}

/**
 * Output full task in readable format
 */
function outputFull(
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

  // Output dependencies from index
  if (indexEntry && indexEntry.dependencies.length > 0) {
    console.log(`Dependencies: ${indexEntry.dependencies.join(', ')}`);
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
 * Output task as JSON
 */
function outputJson(
  id: string,
  parsed: ParsedTask,
  indexEntry: { status: string; dependencies: string[] } | undefined,
): void {
  const result: Record<string, unknown> = { id };

  // Add fields from parsed task
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  // Add status and dependencies from index (override if present)
  if (indexEntry) {
    result.status = indexEntry.status;
    result.dependencies = indexEntry.dependencies;
  }

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output task as markdown (original format)
 */
function outputMarkdown(id: string, parsed: ParsedTask, indexData: IndexData | undefined): void {
  // Convert ParsedTask to TaskData (filter out non-string values)
  const taskData: TaskData = { title: parsed.title || '' };

  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'title' || key === 'dependencies' || key === 'status') continue;
    if (typeof value === 'string') {
      taskData[key] = value;
    }
  }

  const markdown = generate(id, taskData, indexData);
  console.log(markdown);
}

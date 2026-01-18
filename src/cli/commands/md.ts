import type { Services } from '../services.js';
import type { ParsedTask } from '../../parser/types.js';
import type { TaskData } from '../../types.js';
import type { IndexData } from '../../index/types.js';
import { validateCliId } from '../../utils/validation.js';
import { generate } from '../../formatters/generator.js';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { FileIO } from './migrate-types.js';

// Default fs implementation using real Node.js fs
const defaultFs: FileIO = {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
};

export interface MdCommandOptions {
  output?: string;
  stdout?: boolean;
}

/**
 * Detects if content is JSON or markdown format.
 */
function isJsonContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Main implementation of the md command.
 * Reads a task by ID from tasksDir and converts it to .md format.
 *
 * @param id - Task ID (e.g., "1", "1.2")
 * @param options - Command options
 * @param services - DI container
 * @param fsModule - Optional fs module for testing (defaults to real fs)
 */
export async function mdCommand(
  id: string,
  options: MdCommandOptions,
  services: Services,
  fsModule: FileIO = defaultFs,
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

  // 2. Load task content from storage
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
  let wasJson = false;

  try {
    if (isJsonContent(content)) {
      parsed = services.parser.parseJson(content);
      wasJson = true;
    } else {
      parsed = services.parser.parse(content);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ошибка парсинга задачи ${id}: ${error.message}`);
    }
    throw error;
  }

  // 4. Load index data (for dependencies if needed)
  const indexData: IndexData | undefined = await services.index.load();

  // 5. Convert ParsedTask to TaskData format
  const taskData: TaskData = { title: parsed.title || '' };
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'title' || key === 'dependencies' || key === 'status') continue;
    if (typeof value === 'string') {
      taskData[key] = value;
    }
  }

  // 6. Generate markdown using the generator
  let markdownContent: string;
  try {
    markdownContent = generate(id, taskData, indexData);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ошибка генерации markdown: ${error.message}`);
    }
    throw error;
  }

  // 7. Output to stdout or file
  if (options.stdout) {
    console.log(markdownContent);
  } else {
    // Get tasksDir from config for output path
    const config = await services.config.load();
    const tasksDir = config.tasksDir;

    const outputPath = options.output || resolve(tasksDir, `${id}.md`);

    // Create parent directories if needed
    const outputDir = dirname(outputPath);
    await fsModule.mkdir(outputDir, { recursive: true });

    // Atomic write: write to temp file first, then rename
    const tempPath = `${outputPath}.tmp`;

    // Cleanup old .tmp if exists
    if (fsModule.unlink) {
      try {
        await fsModule.unlink(tempPath);
      } catch {
        // Ignore if file doesn't exist
      }
    }

    let tempFileCreated = false;

    try {
      await fsModule.writeFile(tempPath, markdownContent, { encoding: 'utf-8' });
      tempFileCreated = true;
      await fsModule.rename(tempPath, outputPath);

      const fileType = wasJson ? 'JSON' : 'markdown';
      console.log(`✓ Задача ${id} конвертирована из ${fileType} в markdown: ${outputPath}`);
    } catch (error) {
      // Clean up temp file if it was created
      if (tempFileCreated && fsModule.unlink) {
        try {
          await fsModule.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      if (error instanceof Error) {
        throw new Error(`Ошибка записи файла: ${error.message}`);
      }
      throw error;
    }
  }
}

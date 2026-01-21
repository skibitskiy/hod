import type { Services } from '../services.js';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import type { FileIO } from './migrate-types.js';
import { validateCliId } from '../../utils/validation.js';

// Default fs implementation using real Node.js fs
const defaultFs: FileIO = {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
};

export interface MigrateCommandOptions {
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
 * Main implementation of the migrate command.
 * Converts a .md file to .json format.
 * Accepts either a task ID (e.g., "6") or a file path (e.g., "./tasks/6.md").
 *
 * @param input - Task ID or path to the .md file to migrate
 * @param options - Command options
 * @param services - DI container
 * @param fsModule - Optional fs module for testing (defaults to real fs)
 */
export async function migrateCommand(
  input: string,
  options: MigrateCommandOptions,
  services: Services,
  fsModule: FileIO = defaultFs,
): Promise<void> {
  let content: string;
  let resolvedPath: string;
  let sourceDescription: string;

  // 1. Determine if input is a task ID or file path
  // Check if input looks like a task ID (starts with digit and matches ID pattern)
  // We need to check this before file path handling to give proper error messages
  const looksLikeTaskId = /^\d/.test(input) && !input.includes('/') && !input.includes('\\');

  if (looksLikeTaskId) {
    // Input looks like a task ID - validate it properly (will throw if invalid)
    try {
      validateCliId(input);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Невалидный формат ID');
    }

    // Valid task ID - read from storage
    try {
      content = await services.storage.read(input);
    } catch (error) {
      if (error instanceof Error && error.message.includes('не найден')) {
        throw new Error(`Задача с ID "${input}" не найдена`);
      }
      throw error;
    }

    // Get tasksDir from config for resolving output path
    const config = await services.config.load();
    resolvedPath = join(config.tasksDir, `${input}.md`);
    sourceDescription = `Задача ${input}`;
  } else {
    // Input is a file path
    resolvedPath = resolve(input);

    // Validate file extension (should be .md)
    if (!input.endsWith('.md')) {
      throw new Error(`Файл должен иметь расширение .md: ${input}`);
    }

    // Check if file exists and read content
    try {
      content = await fsModule.readFile(resolvedPath, { encoding: 'utf-8' });
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Файл не найден: ${input}`);
      }
      throw error;
    }

    sourceDescription = resolvedPath;
  }

  // 2. Check if already JSON
  if (isJsonContent(content)) {
    throw new Error(`Файл уже в формате JSON: ${sourceDescription}`);
  }

  // 3. Parse markdown content
  let parsed;
  try {
    parsed = services.parser.parse(content);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ошибка парсинга markdown: ${error.message}`);
    }
    throw error;
  }

  // 4. Serialize to JSON
  let jsonContent: string;
  try {
    jsonContent = services.parser.serializeJson(parsed);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ошибка сериализации в JSON: ${error.message}`);
    }
    throw error;
  }

  // 5. Output to stdout or file
  if (options.stdout) {
    console.log(jsonContent);
  } else {
    const outputPath = options.output || resolvedPath.replace(/\.md$/, '.json');

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
      await fsModule.writeFile(tempPath, jsonContent, { encoding: 'utf-8' });
      tempFileCreated = true;
      await fsModule.rename(tempPath, outputPath);

      console.log(`✓ Файл мигрирован: ${resolvedPath} -> ${outputPath}`);
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

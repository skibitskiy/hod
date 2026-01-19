import { readFile, access, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { Config, ConfigService, FieldConfig } from './types.js';
import { ConfigLoadError, ConfigNotFoundError, ConfigValidationError } from './errors.js';

const MARKDOWN_KEY_REGEX = /^[A-Za-z0-9_-]{1,50}$/;
const NAME_REGEX = /^[a-z0-9-]{1,50}$/;

const markdownKeySchema = z
  .string()
  .regex(
    MARKDOWN_KEY_REGEX,
    'Markdown key must contain only letters, numbers, hyphens and underscores',
  );

const nameSchema = z
  .string()
  .regex(NAME_REGEX, 'Name must be kebab-case (lowercase letters, numbers, hyphens only)');

const fieldConfigSchema = z
  .object({
    name: nameSchema,
    required: z.boolean().optional(),
    default: z.string().optional(),
  })
  .refine(
    (field) => {
      if (field.required && field.default !== undefined) {
        return false;
      }
      return true;
    },
    {
      message: 'Field with required: true cannot have a default value',
      path: ['required'],
    },
  )
  .strict();

const configSchema = z
  .object({
    tasksDir: z.string().min(1, 'tasksDir cannot be empty'),
    fields: z
      .record(markdownKeySchema, fieldConfigSchema)
      .refine(
        (fields) => Object.keys(fields).length >= 1,
        'fields must contain at least one field',
      ),
    doneStatus: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  })
  .strict();

export class ConfigServiceImpl implements ConfigService {
  async createDefault(
    tasksDir: string = './tasks',
  ): Promise<{ created: boolean; message: string }> {
    const configPath = resolve(process.cwd(), 'hod.config.yml');

    // Check if config already exists
    try {
      await access(configPath);
      return { created: false, message: 'Конфигурация уже существует (hod.config.yml)' };
    } catch {
      // File doesn't exist, continue
    }

    // Create tasks directory
    try {
      await mkdir(tasksDir, { recursive: true });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }

    // Create default config file
    const defaultConfig = {
      tasksDir,
      fields: {
        Title: { name: 'title', required: true },
        Description: { name: 'description' },
        Status: { name: 'status', default: 'pending' },
      },
      doneStatus: 'completed',
    };

    await writeFile(configPath, stringify(defaultConfig), 'utf-8');

    return { created: true, message: 'HOD проект инициализирован' };
  }

  /**
   * Find config file by traversing up the directory tree.
   * Returns the resolved path to the config file, or null if not found.
   */
  private async findConfigPath(startDir: string): Promise<string | null> {
    let currentDir = resolve(startDir);

    while (true) {
      const configPath = resolve(currentDir, 'hod.config.yml');

      try {
        await access(configPath);
        return configPath;
      } catch (e) {
        const error = e as NodeJS.ErrnoException;
        // If it's not a "not found" error (e.g., permission denied), propagate it
        if (error.code !== 'ENOENT') {
          throw new ConfigLoadError(`Cannot access config at ${configPath}`, error);
        }
        // File doesn't exist, go up one directory
      }

      const parentDir = dirname(currentDir);

      // Stop if we've reached the root
      if (parentDir === currentDir) {
        return null;
      }

      currentDir = parentDir;
    }
  }

  async load(path?: string): Promise<Config> {
    let configPath: string;

    if (path) {
      configPath = resolve(path);
      // Explicit path: verify it exists
      try {
        await access(configPath);
      } catch {
        throw new ConfigNotFoundError();
      }
    } else {
      // Search upward from current directory
      const foundPath = await this.findConfigPath(process.cwd());
      if (foundPath) {
        configPath = foundPath;
      } else {
        throw new ConfigNotFoundError();
      }
    }

    const content = await readFile(configPath, 'utf-8');

    let rawConfig: unknown;
    try {
      rawConfig = parse(content);
    } catch (e) {
      throw new ConfigLoadError('Invalid YAML in configuration file', e as Error);
    }

    if (!rawConfig || typeof rawConfig !== 'object') {
      throw new ConfigLoadError('Configuration file is empty or invalid');
    }

    const config = this.validateAndParse(rawConfig);

    const configDir = dirname(configPath);
    const resolvedTasksDir = resolve(configDir, config.tasksDir);

    this.validatePathSecurity(resolvedTasksDir);

    return {
      ...config,
      tasksDir: resolvedTasksDir,
    };
  }

  validate(config: Config): void {
    const result = configSchema.safeParse(config);

    if (!result.success) {
      throw new ConfigValidationError(result.error.issues);
    }
  }

  private validateAndParse(raw: unknown): Config {
    let parsed: z.infer<typeof configSchema>;

    try {
      parsed = configSchema.parse(raw);
    } catch (e) {
      if (e instanceof z.ZodError) {
        throw new ConfigValidationError(e.issues);
      }
      throw new ConfigLoadError('Failed to parse configuration', e as Error);
    }

    this.validateUniqueNames(parsed.fields);

    return this.ensureDescriptionField(parsed);
  }

  private validateUniqueNames(fields: Record<string, FieldConfig>): void {
    const names = new Map<string, string>();
    const duplicates: Array<{ name: string; key1: string; key2: string }> = [];

    for (const [markdownKey, fieldConfig] of Object.entries(fields)) {
      const existingKey = names.get(fieldConfig.name);
      if (existingKey) {
        duplicates.push({ name: fieldConfig.name, key1: existingKey, key2: markdownKey });
      }
      names.set(fieldConfig.name, markdownKey);
    }

    if (duplicates.length > 0) {
      throw new ConfigValidationError(
        duplicates.map(({ name, key1, key2 }) => ({
          message: `Duplicate name "${name}" used by fields "${key1}" and "${key2}"`,
          path: ['fields', key2, 'name'],
        })),
      );
    }
  }

  private ensureDescriptionField(config: z.infer<typeof configSchema>): Config {
    const descriptionField = config.fields.Description;

    if (!descriptionField) {
      return {
        ...config,
        fields: {
          ...config.fields,
          Description: { name: 'description' },
        },
      };
    }

    if (descriptionField.name !== 'description') {
      throw new ConfigValidationError([
        {
          message:
            'Field "Description" must have name="description", but found "' +
            descriptionField.name +
            '"',
          path: ['fields', 'Description', 'name'],
        },
      ]);
    }

    return config;
  }

  private validatePathSecurity(resolvedTasksDir: string): void {
    const normalizedTasksDir = resolve(resolvedTasksDir);

    const criticalPaths = ['/etc', '/sys', '/proc', '/root', '/boot'];

    for (const criticalPath of criticalPaths) {
      if (normalizedTasksDir.startsWith(criticalPath)) {
        throw new ConfigLoadError('tasksDir path attempts to access critical system directory');
      }
    }
  }
}

export const configService = new ConfigServiceImpl();

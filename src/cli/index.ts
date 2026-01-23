#!/usr/bin/env node
import { Command } from 'commander';
import { addCommand, type AddCommandOptions } from './commands/add.js';
import { listCommand, type ListCommandOptions } from './commands/list.js';
import { updateCommand, type UpdateCommandOptions } from './commands/update.js';
import { deleteCommand, type DeleteCommandOptions } from './commands/delete.js';
import { moveCommand, type MoveCommandOptions } from './commands/move.js';
import type { InitCommandOptions } from './commands/init.js';
import { getCommand, type GetCommandOptions } from './commands/get.js';
import { migrateCommand, type MigrateCommandOptions } from './commands/migrate.js';
import { mdCommand, type MdCommandOptions } from './commands/md.js';
import { nextCommand, type NextCommandOptions } from './commands/next.js';
import { appendCommand, type AppendCommandOptions } from './commands/append.js';
import { doneCommand } from './commands/done.js';
import { createServices } from './services.js';
import type { Config } from '../config/types.js';
import { ConfigNotFoundError } from '../config/errors.js';

const program = new Command();

/**
 * Dynamically generates CLI options from config fields.
 * Maps --field-name (kebab-case) to markdown field via config.fields[key].name
 */
function registerConfigOptions(command: Command, config: Config): void {
  for (const [markdownKey, fieldConfig] of Object.entries(config.fields)) {
    command.option(`--${fieldConfig.name} <value>`, `Значение поля "${markdownKey}"`);
  }
}

/**
 * Registers the 'add' command with dynamic options from config.
 */
async function registerAddCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;
  let config: Config;

  try {
    services = await createServices();
    config = await services.config.load();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      // Register a placeholder command that shows the error
      program
        .command('add')
        .description('Создать новую задачу')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('add')
    .description('Создать новую задачу')
    .option('--dependencies <ids>', 'Зависимости через запятую (например: 1,2,3)')
    .option('--parent <id>', 'Родительская задача (только main задачи)')
    .action(async (options: AddCommandOptions) => {
      try {
        const id = await addCommand(options, services);
        console.log(`✓ Задача создана: ${id}`);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });

  // Register dynamic options from config
  registerConfigOptions(program.commands[0], config);
}

/**
 * Registers the 'list' command with dynamic options from config.
 */
async function registerListCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;
  let config: Config;

  try {
    services = await createServices();
    config = await services.config.load();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      // Register a placeholder command that shows the error
      program
        .command('list')
        .description('Показать список задач')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  const listCmd = program
    .command('list')
    .description('Показать список задач')
    .option('--json', 'Вывод в формате JSON')
    .option('--tree', 'Показать задачи в виде дерева')
    .action(async (options: ListCommandOptions) => {
      try {
        await listCommand(options, services);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });

  // Register dynamic options from config
  registerConfigOptions(listCmd, config);
}

/**
 * Registers the 'update' command with dynamic options from config.
 */
async function registerUpdateCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;
  let config: Config;

  try {
    services = await createServices();
    config = await services.config.load();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      // Register a placeholder command that shows the error
      program
        .command('update')
        .description('Обновить задачу')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  const updateCmd = program
    .command('update <id>')
    .description('Обновить задачу')
    .option('--dependencies <ids>', 'Зависимости через запятую (например: 1,2,3)')
    .action(async (id: string, options: Omit<UpdateCommandOptions, 'id'>) => {
      try {
        const updatedId = await updateCommand({ ...options, id }, services);
        console.log(`✓ Задача ${updatedId} обновлена`);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });

  // Register dynamic options from config
  registerConfigOptions(updateCmd, config);
}

/**
 * Registers the 'delete' command.
 */
async function registerDeleteCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;

  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      program
        .command('delete')
        .description('Удалить задачу')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('delete <id>')
    .description('Удалить задачу')
    .option('-r, --recursive', 'Удалить задачу со всеми подзадачами')
    .action(async (id: string, options: Omit<DeleteCommandOptions, 'id'>) => {
      try {
        const deletedId = await deleteCommand({ ...options, id }, services);
        console.log(`✓ Задача ${deletedId} удалена`);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'done' command.
 */
async function registerDoneCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;

  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      program
        .command('done')
        .description('Отметить задачу как выполненную')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('done <id>')
    .description('Отметить задачу как выполненную')
    .action(async (id: string) => {
      try {
        const result = await doneCommand({ id }, services);

        if (result.wasAlreadyDone) {
          console.warn(
            `Предупреждение: задача ${result.id} уже имеет статус "${result.doneStatus}"`,
          );
        }

        console.log(`✓ Задача ${result.id} выполнена`);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'move' command.
 */
async function registerMoveCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;

  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      program
        .command('move')
        .description('Переместить задачу под нового родителя')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('move <id>')
    .description('Переместить задачу под нового родителя')
    .option('--parent <id>', 'ID нового родителя (только основные задачи)', '')
    .action(async (id: string, options: Omit<MoveCommandOptions, 'id'>) => {
      try {
        const result = await moveCommand({ ...options, id }, services);
        // Handle special return format for move: "old_id -> new_id" or just "id" (no-op)
        if (result.includes(' -> ')) {
          const [oldId, newId] = result.split(' -> ');
          console.log(`✓ Задача ${oldId} перемещена в ${newId}`);
        } else {
          console.log(`✓ Задача ${result} перемещена`);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'init' command.
 */
async function registerInitCommand(): Promise<void> {
  // Init command doesn't need services to be created, it only needs configService
  // which has the createDefault method
  const { configService } = await import('../config/index.js');

  program
    .command('init')
    .description('Инициализировать новый HOD проект')
    .option('--dir <path>', 'Директория для задач (по умолчанию: ./tasks)')
    .action(async (options: InitCommandOptions) => {
      try {
        const tasksDir = options.dir || './tasks';
        const result = await configService.createDefault(tasksDir);
        console.log(result.message);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'get' command.
 */
async function registerGetCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;

  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      program
        .command('get')
        .description('Получить задачу по ID')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('get <id>')
    .description('Получить задачу по ID')
    .option('--title', 'Вывести только заголовок')
    .option('--status', 'Вывести только статус')
    .option('--dependencies', 'Вывести только зависимости')
    .option('--json', 'Вывод в формате JSON')
    .option('--markdown', 'Вывести в markdown формате (как в файле)')
    .action(async (id: string, options: GetCommandOptions) => {
      try {
        await getCommand(id, options, services);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'md' command.
 */
async function registerMdCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;

  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      program
        .command('md')
        .description('Конвертировать задачу в markdown формат')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('md <id>')
    .description('Конвертировать задачу в markdown формат')
    .option('-o, --output <path>', 'Путь для сохранения markdown файла')
    .option('-s, --stdout', 'Вывести markdown в stdout вместо записи в файл')
    .action(async (id: string, options: MdCommandOptions) => {
      try {
        await mdCommand(id, options, services);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'migrate' command.
 */
async function registerMigrateCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;

  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      program
        .command('migrate')
        .description('Конвертировать .md файл в .json формат')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('migrate <id>')
    .description('Конвертировать задачу из .md в .json формат')
    .option('-o, --output <path>', 'Путь для сохранения JSON файла')
    .option('-s, --stdout', 'Вывести JSON в stdout вместо записи в файл')
    .option('-f, --force', 'Перезаписать если файл уже в формате JSON')
    .action(async (id: string, options: MigrateCommandOptions) => {
      try {
        await migrateCommand(id, options, services);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'next' command.
 */
async function registerNextCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;

  try {
    services = await createServices();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      program
        .command('next')
        .description('Показать задачи готовые к выполнению')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  program
    .command('next')
    .description('Показать задачи готовые к выполнению')
    .option('--all', 'Показать все готовые задачи')
    .option('--json', 'Вывод в формате JSON')
    .action(async (options: NextCommandOptions) => {
      try {
        await nextCommand(options, services);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });
}

/**
 * Registers the 'append' command with dynamic options from config.
 */
async function registerAppendCommand(): Promise<void> {
  let services: Awaited<ReturnType<typeof createServices>>;
  let config: Config;

  try {
    services = await createServices();
    config = await services.config.load();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      // Register a placeholder command that shows the error
      program
        .command('append')
        .description('Добавить данные к полям задачи')
        .action(() => {
          console.error(error.message);
          process.exit(1);
        });
      return;
    }
    throw error;
  }

  const appendCmd = program
    .command('append <id>')
    .description('Добавить данные к полям задачи (с разделителем \\n)')
    .action(async (id: string, options: Omit<AppendCommandOptions, 'id'>) => {
      try {
        const updatedId = await appendCommand({ ...options, id }, services);
        console.log(`✓ Задача ${updatedId} обновлена`);
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message);
          process.exit(1);
        }
        console.error('Неизвестная ошибка');
        process.exit(1);
      }
    });

  // Register dynamic options from config
  registerConfigOptions(appendCmd, config);
}

/**
 * Main CLI entry point.
 */
export async function main(): Promise<void> {
  program.name('hod').description('HOD — Задачник для Markdown').version('1.0.0');

  // Register add command
  await registerAddCommand();

  // Register list command
  await registerListCommand();

  // Register update command
  await registerUpdateCommand();

  // Register delete command
  await registerDeleteCommand();

  // Register done command
  await registerDoneCommand();

  // Register move command
  await registerMoveCommand();

  // Register init command
  await registerInitCommand();

  // Register get command
  await registerGetCommand();

  // Register migrate command
  await registerMigrateCommand();

  // Register md command
  await registerMdCommand();

  // Register next command
  await registerNextCommand();

  // Register append command
  await registerAppendCommand();

  await program.parseAsync(process.argv);
}

// Note: Direct execution check handled by esbuild footer in CJS bundle
// For ESM, consumers should call main() directly

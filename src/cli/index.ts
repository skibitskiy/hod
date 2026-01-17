#!/usr/bin/env node
import { Command } from 'commander';
import { addCommand, type AddCommandOptions } from './commands/add.js';
import { listCommand, type ListCommandOptions } from './commands/list.js';
import { updateCommand, type UpdateCommandOptions } from './commands/update.js';
import { deleteCommand, type DeleteCommandOptions } from './commands/delete.js';
import { moveCommand, type MoveCommandOptions } from './commands/move.js';
import { createServices } from './services.js';
import type { Config } from '../config/types.js';

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
  const services = await createServices();
  const config = await services.config.load();

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
  const services = await createServices();
  const config = await services.config.load();

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
  const services = await createServices();
  const config = await services.config.load();

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
  const services = await createServices();

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
 * Registers the 'move' command.
 */
async function registerMoveCommand(): Promise<void> {
  const services = await createServices();

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

  // Register move command
  await registerMoveCommand();

  await program.parseAsync(process.argv);
}

// Run CLI if this file is executed directly
// Note: ESM uses import.meta.url, CJS bundle uses require.main check
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
}

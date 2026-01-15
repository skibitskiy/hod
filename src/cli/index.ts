#!/usr/bin/env node
import { Command } from 'commander';
import { addCommand, type AddCommandOptions } from './commands/add.js';
import { listCommand, type ListCommandOptions } from './commands/list.js';
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
 * Main CLI entry point.
 */
export async function main(): Promise<void> {
  program.name('hod').description('HOD — Задачник для Markdown').version('1.0.0');

  // Register add command
  await registerAddCommand();

  // Register list command
  await registerListCommand();

  await program.parseAsync(process.argv);
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
}

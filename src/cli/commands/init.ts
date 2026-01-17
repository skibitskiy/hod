import type { Services } from '../services.js';

export interface InitCommandOptions {
  dir?: string;
}

/**
 * Main implementation of the init command.
 */
export async function initCommand(
  options: InitCommandOptions,
  services: Services,
): Promise<string> {
  const tasksDir = options.dir || './tasks';
  const result = await services.config.createDefault(tasksDir);
  return result.message;
}

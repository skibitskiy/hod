import type { ConfigService } from '../config/types.js';
import type { StorageService } from '../storage/storage.js';
import type { IndexService } from '../index/index.js';
import { configService } from '../config/index.js';
import { createStorageService } from '../storage/storage.js';
import { createIndexService } from '../index/index.js';
import { ParserService } from '../parser/parser.js';

export interface Services {
  config: ConfigService;
  storage: StorageService;
  index: IndexService;
  parser: ParserService;
}

export async function createServices(configPath?: string): Promise<Services> {
  // 1. Load config first (needed for tasksDir)
  const config = await configService.load(configPath);

  // 2. Create services with tasksDir from config
  const storageService = createStorageService(config.tasksDir);
  const indexService = createIndexService(config.tasksDir);

  return {
    config: configService,
    storage: storageService,
    index: indexService,
    parser: ParserService,
  };
}

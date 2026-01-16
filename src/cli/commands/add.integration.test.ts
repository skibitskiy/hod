import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Volume } from 'memfs';
import type { Config } from '../../config/types.js';
import type { ConfigService } from '../../config/types.js';
import { createStorageService } from '../../storage/storage.js';
import { createIndexService } from '../../index/index.js';
import { ParserService } from '../../parser/parser.js';
import type { AddCommandOptions } from './add.js';
import { addCommand } from './add.js';
import type { Services } from '../services.js';

// Mock config that works with memfs paths
const mockConfig: Config = {
  tasksDir: '/tasks',
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
  },
};

// Helper to create real services with memfs
async function createIntegrationServices(vol: Volume): Promise<Services> {
  // Create a mock config service that returns our mock config
  const configService: ConfigService = {
    load: vi.fn().mockResolvedValue(mockConfig),
    validate: vi.fn(),
  } as unknown as ConfigService;

  // Create storage and index with memfs
  const storageService = createStorageService(
    mockConfig.tasksDir,
    vol.promises as unknown as typeof import('node:fs/promises'),
  );
  const indexService = createIndexService(
    mockConfig.tasksDir,
    vol.promises as unknown as typeof import('node:fs/promises'),
  );

  return {
    config: configService,
    storage: storageService,
    index: indexService,
    parser: ParserService,
  };
}

describe('add command (integration tests with memfs)', () => {
  let services: Services;
  let vol: Volume;

  beforeEach(async () => {
    vol = Volume.fromJSON({});
    services = await createIntegrationServices(vol);
  });

  describe('базовое создание задач', () => {
    it('должен создать файл задачи и обновить индекс', async () => {
      const options: AddCommandOptions = {
        title: 'Test task',
        description: 'Task description',
      };

      const id = await addCommand(options, services);

      expect(id).toBe('1');

      // Check file was created
      const content = await services.storage.read(id);
      expect(content).toContain('# Title\nTest task');
      expect(content).toContain('# Description\nTask description');

      // Check index was updated
      const index = await services.index.load();
      expect(index).toEqual({ '1': { status: 'pending', dependencies: [] } });
    });

    it('должен применять дефолтный статус из config', async () => {
      const options: AddCommandOptions = {
        title: 'Task',
      };

      await addCommand(options, services);

      const index = await services.index.load();
      // Статус сохраняется в индексе, не в markdown
      expect(index['1']).toEqual({ status: 'pending', dependencies: [] });
    });

    it('должен создавать задачи с кастомными полями из config', async () => {
      const options: AddCommandOptions = {
        title: 'Task',
      };

      await addCommand(options, services);

      const content = await services.storage.read('1');
      const parsed = ParserService.parse(content);

      expect(parsed.title).toBe('Task');
      expect(parsed.status).toBe('pending');
      expect(parsed.dependencies).toEqual([]);
    });
  });

  describe('генерация ID', () => {
    it('должен генерировать "1" для первой задачи', async () => {
      const options: AddCommandOptions = {
        title: 'First task',
      };

      const id = await addCommand(options, services);
      expect(id).toBe('1');
    });

    it('должен генерировать "2" после создания "1"', async () => {
      await addCommand({ title: 'First' }, services);

      const options: AddCommandOptions = {
        title: 'Second task',
      };
      const id = await addCommand(options, services);

      expect(id).toBe('2');

      const tasks = await services.storage.list();
      expect(tasks).toHaveLength(2);
    });

    it('должен игнорировать подзадачи при генерации ID', async () => {
      // Create main task
      await addCommand({ title: 'Main' }, services);

      // Create subtask manually (simulating subtask creation)
      await services.storage.create(
        '1.1',
        ParserService.serialize({
          title: 'Subtask',
          status: 'pending',
          dependencies: ['1'],
        }),
      );
      await services.index.update('1.1', { status: 'pending', dependencies: ['1'] });

      // Next main task should be 2, not 1.1
      const id = await addCommand({ title: 'Second main' }, services);
      expect(id).toBe('2');
    });

    it('должен находить max ID при пропусках', async () => {
      // Create tasks 1, 3, 5 manually
      for (const taskId of ['1', '3', '5']) {
        await services.storage.create(
          taskId,
          ParserService.serialize({
            title: `Task ${taskId}`,
            status: 'pending',
            dependencies: [],
          }),
        );
        await services.index.update(taskId, { status: 'pending', dependencies: [] });
      }

      // Next ID should be 6 (max is 5)
      const id = await addCommand({ title: 'Next' }, services);
      expect(id).toBe('6');
    });
  });

  describe('зависимости', () => {
    it('должен создавать задачу с зависимостями', async () => {
      // Create dependency tasks
      await addCommand({ title: 'Task 1' }, services);
      await addCommand({ title: 'Task 2' }, services);

      // Create task with dependencies
      const options: AddCommandOptions = {
        title: 'Task with deps',
        dependencies: '1,2',
      };

      const id = await addCommand(options, services);

      const index = await services.index.load();
      expect(index[id]).toEqual({ status: 'pending', dependencies: ['1', '2'] });

      const content = await services.storage.read(id);
      expect(content).toContain('# Dependencies\n1, 2');
    });

    it('должен trim пробелы в зависимостях', async () => {
      await addCommand({ title: 'Task 1' }, services);
      await addCommand({ title: 'Task 2' }, services);
      await addCommand({ title: 'Task 3' }, services);

      const options: AddCommandOptions = {
        title: 'Task',
        dependencies: ' 1 , 2 , 3 ',
      };

      await addCommand(options, services);

      const index = await services.index.load();
      expect(index['4']).toEqual({ status: 'pending', dependencies: ['1', '2', '3'] });
    });

    it('должен допускать forward references', async () => {
      const options: AddCommandOptions = {
        title: 'Task with future dep',
        dependencies: '99',
      };

      // Should not throw - forward references are allowed
      await addCommand(options, services);

      const index = await services.index.load();
      expect(index['1']).toEqual({ status: 'pending', dependencies: ['99'] });
    });

    it('должен откатывать создание файла при циклической зависимости', async () => {
      // Create task 1 that depends on itself
      const options: AddCommandOptions = {
        title: 'Self-referencing',
        dependencies: '1',
      };

      await expect(addCommand(options, services)).rejects.toThrow();

      // File should not exist (rollback)
      const exists = await services.storage.exists('1');
      expect(exists).toBe(false);
    });
  });

  describe('валидация полей', () => {
    it('должен выбрасывать ошибку для неизвестного поля', async () => {
      const options: AddCommandOptions = {
        title: 'Task',
        unknownField: 'value',
      };

      await expect(addCommand(options, services)).rejects.toThrow('Неизвестное поле');
    });

    it('должен выбрасывать ошибку если отсутствует обязательное поле Title', async () => {
      const options: AddCommandOptions = {
        description: 'Description only',
      };

      await expect(addCommand(options, services)).rejects.toThrow('Не указано обязательное поле');
    });

    it('должен игнорировать пустые строки', async () => {
      const options: AddCommandOptions = {
        title: '',
      };

      await expect(addCommand(options, services)).rejects.toThrow('Не указано обязательное поле');
    });

    it('должен trim пробелы в значениях', async () => {
      const options: AddCommandOptions = {
        title: '  Task title  ',
        description: ' Description text ',
      };

      await addCommand(options, services);

      const content = await services.storage.read('1');
      const parsed = ParserService.parse(content);

      expect(parsed.title).toBe('Task title');
      expect(parsed.description).toBe('Description text');
    });
  });

  describe('формат Markdown', () => {
    it('должен сериализовать задачу в корректный Markdown', async () => {
      const options: AddCommandOptions = {
        title: 'Test Task',
        description: 'Multi-line\ndescription',
      };

      await addCommand(options, services);

      const content = await services.storage.read('1');
      const lines = content.split('\n');

      expect(lines[0]).toBe('# Title');
      expect(lines[1]).toBe('Test Task');
      expect(lines).toContain('# Description');
      // Status больше не пишется в markdown (только в index)
      expect(lines).toContain('# Dependencies');
    });

    it('должен включать все стандартные секции', async () => {
      const options: AddCommandOptions = {
        title: 'Task',
      };

      await addCommand(options, services);

      const content = await services.storage.read('1');
      const parsed = ParserService.parse(content);

      expect(parsed.title).toBeDefined();
      expect(parsed.status).toBeDefined();
      expect(parsed.dependencies).toBeDefined();
    });
  });

  describe('работа с индексом', () => {
    it('должен обновлять индекс после создания задачи', async () => {
      await addCommand({ title: 'Task 1' }, services);
      await addCommand({ title: 'Task 2' }, services);

      const index = await services.index.load();
      expect(Object.keys(index)).toEqual(['1', '2']);
    });

    it('должен сохранять зависимости в индексе', async () => {
      await addCommand({ title: 'Task 1' }, services);
      await addCommand({ title: 'Task 2', dependencies: '1' }, services);

      const index = await services.index.load();
      expect(index['1']).toEqual({ status: 'pending', dependencies: [] });
      expect(index['2']).toEqual({ status: 'pending', dependencies: ['1'] });
    });

    it('должен удалять задачу из индекса при rollback', async () => {
      // Create a task that creates a cycle
      await addCommand({ title: 'Task 1' }, services);

      const options: AddCommandOptions = {
        title: 'Task 2',
        dependencies: '2', // self-dependency
      };

      await expect(addCommand(options, services)).rejects.toThrow();

      const index = await services.index.load();
      // Only task 1 should be in index
      expect(Object.keys(index)).toEqual(['1']);
    });
  });

  describe('edge cases', () => {
    it('должен создавать несколько задач подряд', async () => {
      const ids: string[] = [];

      for (let i = 0; i < 5; i++) {
        const id = await addCommand({ title: `Task ${i}` }, services);
        ids.push(id);
      }

      expect(ids).toEqual(['1', '2', '3', '4', '5']);

      const tasks = await services.storage.list();
      expect(tasks).toHaveLength(5);
    });

    it('должен обрабатывать пустые зависимости', async () => {
      const options: AddCommandOptions = {
        title: 'Task',
        dependencies: '',
      };

      await addCommand(options, services);

      const index = await services.index.load();
      expect(index['1']).toEqual({ status: 'pending', dependencies: [] });
    });

    it('должен обрабатывать задачи с большим ID', async () => {
      // Create task 100
      await services.storage.create(
        '100',
        ParserService.serialize({
          title: 'Big ID task',
          status: 'pending',
          dependencies: [],
        }),
      );
      await services.index.update('100', { status: 'pending', dependencies: [] });

      // Next task should be 101
      const id = await addCommand({ title: 'Next' }, services);
      expect(id).toBe('101');
    });
  });
});

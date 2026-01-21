import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Volume } from 'memfs';
import type { Config } from '../../config/types.js';
import type { ConfigService } from '../../config/types.js';
import { createStorageService } from '../../storage/storage.js';
import { createIndexService } from '../../index/index.js';
import { ParserService } from '../../parser/parser.js';
import type { AppendCommandOptions } from './append.js';
import { appendCommand } from './append.js';
import { addCommand, type AddCommandOptions } from './add.js';
import type { Services } from '../services.js';

// Mock config that works with memfs paths
const mockConfig: Config = {
  tasksDir: '/tasks',
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
    Priority: { name: 'priority' },
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

describe('append command (integration tests with memfs)', () => {
  let services: Services;
  let vol: Volume;

  beforeEach(async () => {
    vol = Volume.fromJSON({});
    services = await createIntegrationServices(vol);
  });

  describe('базовое добавление к полям', () => {
    it('должен добавлять к существующему описанию с \\n разделителем', async () => {
      // Create initial task
      const addOptions: AddCommandOptions = {
        title: 'Test task',
        description: 'Initial description',
      };
      const taskId = await addCommand(addOptions, services);

      // Append to description
      const appendOptions: AppendCommandOptions = {
        id: taskId,
        description: 'Appended text',
      };

      const resultId = await appendCommand(appendOptions, services);
      expect(resultId).toBe(taskId);

      // Verify the content was appended
      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('Initial description\nAppended text');
      expect(parsed.title).toBe('Test task'); // Unchanged
    });

    it('должен добавлять к нескольким полям одновременно', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Initial description',
      };
      const taskId = await addCommand(addOptions, services);

      const appendOptions: AppendCommandOptions = {
        id: taskId,
        title: '- updated',
        description: 'Additional info',
        priority: 'high',
      };

      await appendCommand(appendOptions, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.title).toBe('Task\n- updated');
      expect(parsed.description).toBe('Initial description\nAdditional info');
      expect(parsed.priority).toBe('high');
    });

    it('должен создавать поле если оно не существует', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
      };
      const taskId = await addCommand(addOptions, services);

      const appendOptions: AppendCommandOptions = {
        id: taskId,
        description: 'New description',
        priority: 'high',
      };

      await appendCommand(appendOptions, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('New description');
      expect(parsed.priority).toBe('high');
    });

    it('должен создавать поле если существующее поле пустое', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: '',
      };
      const taskId = await addCommand(addOptions, services);

      const appendOptions: AppendCommandOptions = {
        id: taskId,
        description: 'New description',
      };

      await appendCommand(appendOptions, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('New description');
    });
  });

  describe('многократное добавление', () => {
    it('должен корректно обрабатывать несколько append операций подряд', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Line 1',
      };
      const taskId = await addCommand(addOptions, services);

      // First append
      await appendCommand({ id: taskId, description: 'Line 2' }, services);

      // Second append
      await appendCommand({ id: taskId, description: 'Line 3' }, services);

      // Third append
      await appendCommand({ id: taskId, description: 'Line 4' }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('Line 1\nLine 2\nLine 3\nLine 4');
    });

    it('должен добавлять к разным полям в разном порядке', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Desc',
      };
      const taskId = await addCommand(addOptions, services);

      // Append to title
      await appendCommand({ id: taskId, title: '(v1)' }, services);

      // Append to description
      await appendCommand({ id: taskId, description: '- more info' }, services);

      // Append to title again
      await appendCommand({ id: taskId, title: '(v2)' }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.title).toBe('Task\n(v1)\n(v2)');
      expect(parsed.description).toBe('Desc\n- more info');
    });
  });

  describe('работа с индексом', () => {
    it('должен сохранять статус и зависимости без изменений', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Initial',
        status: 'in-progress',
        dependencies: '1',
      };
      const taskId1 = await addCommand({ title: 'Task 1' }, services);
      const taskId2 = await addCommand(addOptions, services);

      // Append to description
      await appendCommand({ id: taskId2, description: 'Appended' }, services);

      // Index should remain unchanged
      const index = await services.index.load();
      expect(index[taskId2]).toEqual({
        status: 'in-progress',
        dependencies: [taskId1],
      });
    });

    it('должен откатывать storage при ошибке индекса', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Original description',
      };
      const taskId = await addCommand(addOptions, services);

      // Create a cycle in dependencies to trigger index error
      // First, create task that will cause cycle
      await addCommand({ title: 'Task 1' }, services);

      // Manually corrupt the index to simulate an error
      const originalUpdate = services.index.update;
      services.index.update = vi.fn().mockRejectedValueOnce(new Error('Index update failed'));

      // Try to append (should fail on index update and rollback storage)
      await expect(
        appendCommand({ id: taskId, description: 'This should not be saved' }, services),
      ).rejects.toThrow('Index update failed');

      // Verify storage was rolled back - description should be unchanged
      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('Original description');

      // Restore original update function
      services.index.update = originalUpdate;
    });
  });

  describe('системные поля', () => {
    it('должен выбрасывать ошибку при попытке append к Status', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
      };
      const taskId = await addCommand(addOptions, services);

      const appendOptions: AppendCommandOptions = {
        id: taskId,
        status: 'done',
      };

      await expect(appendCommand(appendOptions, services)).rejects.toThrow(
        "Нельзя добавить данные к системному полю 'Status'",
      );
    });

    it('не должен изменять статус в индексе при append', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        status: 'in-progress',
      };
      const taskId = await addCommand(addOptions, services);

      const indexBefore = await services.index.load();
      const statusBefore = indexBefore[taskId].status;

      await appendCommand({ id: taskId, description: 'Appended' }, services);

      const indexAfter = await services.index.load();
      expect(indexAfter[taskId].status).toBe(statusBefore);
    });
  });

  describe('валидация', () => {
    it('должен выбрасывать ошибку для неизвестного поля', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
      };
      const taskId = await addCommand(addOptions, services);

      const appendOptions: AppendCommandOptions = {
        id: taskId,
        unknownField: 'value',
      } as unknown as AppendCommandOptions;

      await expect(appendCommand(appendOptions, services)).rejects.toThrow('Неизвестное поле');
    });

    it('должен выбрасывать ошибку при пустой задаче', async () => {
      const appendOptions: AppendCommandOptions = {
        id: '999',
        description: 'Text',
      };

      await expect(appendCommand(appendOptions, services)).rejects.toThrow(
        'Задача не найдена: 999',
      );
    });

    it('должен выбрасывать ошибку при невалидном ID', async () => {
      const appendOptions: AppendCommandOptions = {
        id: 'invalid-id',
        description: 'Text',
      };

      await expect(appendCommand(appendOptions, services)).rejects.toThrow(
        "Невалидный формат ID: 'invalid-id'",
      );
    });
  });

  describe('пустые значения', () => {
    it('должен пропускать поля с пустыми значениями', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Original',
      };
      const taskId = await addCommand(addOptions, services);

      // Append with empty values should be no-op
      await appendCommand({ id: taskId, description: '', priority: '' }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('Original'); // Unchanged
      expect(parsed).not.toHaveProperty('priority');
    });

    it('должен trim добавляемые значения', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Original',
      };
      const taskId = await addCommand(addOptions, services);

      await appendCommand({ id: taskId, description: '  \n  Trimmed  \n  ' }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('Original\nTrimmed');
    });
  });

  describe('работа с JSON форматом', () => {
    it('должен корректно читать и обновлять JSON задачи', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Initial',
      };
      const taskId = await addCommand(addOptions, services);

      // Verify file is JSON
      const contentBefore = await services.storage.read(taskId);
      expect(() => JSON.parse(contentBefore)).not.toThrow();

      // Append
      await appendCommand({ id: taskId, description: 'Appended' }, services);

      // Verify still valid JSON
      const contentAfter = await services.storage.read(taskId);
      const parsed = JSON.parse(contentAfter);
      expect(parsed.description).toBe('Initial\nAppended');
      expect(parsed.title).toBe('Task');
    });

    it('должен сохранять валидный JSON с многострочными значениями', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Line 1\nLine 2',
      };
      const taskId = await addCommand(addOptions, services);

      await appendCommand({ id: taskId, description: 'Line 3\nLine 4' }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('Line 1\nLine 2\nLine 3\nLine 4');
    });
  });

  describe('edge cases', () => {
    it('должен работать с задачами без описания', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Title only task',
      };
      const taskId = await addCommand(addOptions, services);

      // Append description to task that doesn't have one
      await appendCommand({ id: taskId, description: 'First description' }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('First description');
      expect(parsed.title).toBe('Title only task');
    });

    it('должен сохранять существующие кастомные поля', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        priority: 'low',
      };
      const taskId = await addCommand(addOptions, services);

      // Append to description, should not affect priority
      await appendCommand({ id: taskId, description: 'New desc' }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.priority).toBe('low'); // Unchanged
      expect(parsed.description).toBe('New desc');
    });

    it('должен работать с большими количествами текста', async () => {
      const addOptions: AddCommandOptions = {
        title: 'Task',
        description: 'Initial',
      };
      const taskId = await addCommand(addOptions, services);

      const longText = 'A'.repeat(1000);
      await appendCommand({ id: taskId, description: longText }, services);

      const content = await services.storage.read(taskId);
      const parsed = JSON.parse(content);
      expect(parsed.description).toBe('Initial\n' + longText);
    });
  });
});

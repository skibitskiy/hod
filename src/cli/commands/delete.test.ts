import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { deleteCommand, type DeleteCommandOptions } from './delete.js';

const mockConfig: Config = {
  tasksDir: '/tasks',
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
  },
};

const createMockServices = (overrides?: Partial<Services>): Services => ({
  config: {
    load: vi.fn().mockResolvedValue(mockConfig),
    validate: vi.fn(),
  } as unknown as ConfigService,
  storage: {
    create: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue('# Title\nTest\n# Dependencies\n'),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as StorageService,
  index: {
    load: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    getNextTasks: vi.fn().mockReturnValue([]),
  } as unknown as IndexService,
  parser: ParserService,
  ...overrides,
});

describe('deleteCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('удаление существующей задачи без подзадач', () => {
    it('должен успешно удалить задачу без подзадач', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi
            .fn()
            .mockResolvedValue([{ id: '1', content: '# Title\nTask 1\n# Dependencies\n' }]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
      };

      const result = await deleteCommand(options, services);

      expect(result).toBe('1');
      expect(services.storage.delete).toHaveBeenCalledWith('1');
      expect(services.index.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('удаление с подзадачами без флага -r', () => {
    it('должен выбрасывать ошибку с списком подзадач', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1\n# Dependencies\n' },
            { id: '1.2', content: '# Title\nSubtask 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
        recursive: false,
      };

      await expect(deleteCommand(options, services)).rejects.toThrow(
        'Задача 1 имеет подзадачи: 1.1, 1.2. Используйте -r для рекурсивного удаления',
      );

      // Should not delete anything
      expect(services.storage.delete).not.toHaveBeenCalled();
      expect(services.index.remove).not.toHaveBeenCalled();
    });
  });

  describe('удаление с подзадачами с флагом -r', () => {
    it('должен удалять задачу и все прямые подзадачи', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1\n# Dependencies\n' },
            { id: '1.2', content: '# Title\nSubtask 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
        recursive: true,
      };

      const result = await deleteCommand(options, services);

      expect(result).toBe('1');

      // Should delete subtasks first
      expect(services.storage.delete).toHaveBeenCalledWith('1.1');
      expect(services.storage.delete).toHaveBeenCalledWith('1.2');
      expect(services.index.remove).toHaveBeenCalledWith('1.1');
      expect(services.index.remove).toHaveBeenCalledWith('1.2');

      // Then delete parent task
      expect(services.storage.delete).toHaveBeenCalledWith('1');
      expect(services.index.remove).toHaveBeenCalledWith('1');
    });

    it('должен удалять только прямые подзадачи (не вложенные)', async () => {
      // When deleting 1.1 with -r flag:
      // - 1.1.1 would be a direct child (if it existed)
      // - 1.10 is NOT a child of 1.1 (same depth: 2)
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue([
            { id: '1.1', content: '# Title\nTask 1.1\n# Dependencies\n' },
            {
              id: '1.10',
              content: '# Title\nTask 1.10 (sibling of 1.1, not child)\n# Dependencies\n',
            },
            { id: '1.1.1', content: '# Title\nTask 1.1.1 (direct child of 1.1)\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1.1',
        recursive: true,
      };

      const result = await deleteCommand(options, services);

      expect(result).toBe('1.1');

      // Should only delete direct children of 1.1 (which is 1.1.1 at depth 3)
      // 1.10 is at depth 2, same as 1.1, so it's NOT a child
      expect(services.storage.delete).toHaveBeenCalledWith('1.1.1');
      expect(services.storage.delete).toHaveBeenCalledWith('1.1');
      expect(services.storage.delete).not.toHaveBeenCalledWith('1.10');
    });
  });

  describe('удаление с флагом -r когда подзадач нет', () => {
    it('должен успешно удалять задачу (silent success)', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi
            .fn()
            .mockResolvedValue([{ id: '1', content: '# Title\nTask 1\n# Dependencies\n' }]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
        recursive: true,
      };

      const result = await deleteCommand(options, services);

      expect(result).toBe('1');
      expect(services.storage.delete).toHaveBeenCalledWith('1');
      expect(services.index.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('проверка глубины подзадач', () => {
    it('должен правильно определять что 1.10 это НЕ подзадача 1.1', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue([
            { id: '1.1', content: '# Title\nTask 1.1\n# Dependencies\n' },
            { id: '1.10', content: '# Title\nTask 1.10\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1.1',
        recursive: false,
      };

      // 1.10 has depth 2, 1.1 has depth 2
      // 1.10 is NOT a child of 1.1 (same depth)
      // Should not find subtasks, should succeed
      const result = await deleteCommand(options, services);

      expect(result).toBe('1.1');
    });

    it('должен правильно находить прямых потомков: 1.1 и 1.2 для задачи 1', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
            { id: '1.2', content: '# Title\nSubtask 1.2\n# Dependencies\n' },
            { id: '1.10', content: '# Title\nSubtask 1.10\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
        recursive: false,
      };

      // All three (1.1, 1.2, 1.10) are direct children of 1
      await expect(deleteCommand(options, services)).rejects.toThrow(/Задача 1 имеет подзадачи:/);
    });
  });

  describe('валидация ID', () => {
    it('должен выбрасывать ошибку при невалидном формате ID', async () => {
      const services = createMockServices();

      const options: DeleteCommandOptions = {
        id: 'invalid-id',
      };

      await expect(deleteCommand(options, services)).rejects.toThrow(
        "Невалидный формат ID: 'invalid-id'",
      );
    });

    it('должен выбрасывать StorageNotFoundError при несуществующей задаче', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          exists: vi.fn().mockResolvedValue(false),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '999',
      };

      await expect(deleteCommand(options, services)).rejects.toThrow(StorageNotFoundError);
    });

    it('должен выбрасывать ошибку при ID превышающем MAX_ID_LENGTH', async () => {
      const services = createMockServices();

      // Create a 51-character ID
      const longId = '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1';
      expect(longId.length).toBeGreaterThan(50);

      const options: DeleteCommandOptions = {
        id: longId,
      };

      await expect(deleteCommand(options, services)).rejects.toThrow(
        `ID задачи превышает максимальную длину 50 символов: '${longId}'`,
      );
    });

    it('должен принимать ID равный MAX_ID_LENGTH', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue('# Title\nTask 1\n# Dependencies\n'),
          list: vi
            .fn()
            .mockResolvedValue([{ id: '1', content: '# Title\nTask 1\n# Dependencies\n' }]),
        } as unknown as StorageService,
      });

      // Create a 50-character ID: '1' repeated 50 times
      const maxLengthId = '1'.repeat(50);
      expect(maxLengthId.length).toBe(50);

      const options: DeleteCommandOptions = {
        id: maxLengthId,
      };

      const result = await deleteCommand(options, services);

      expect(result).toBe(maxLengthId);
    });
  });

  describe('orphaned dependencies', () => {
    it('должен оставлять orphaned dependencies без ошибок', async () => {
      // Simulate other tasks depending on the deleted one
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '2', content: '# Title\nTask 2\n# Dependencies\n1' },
          ]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
      };

      const result = await deleteCommand(options, services);

      // Should succeed even though task 2 depends on task 1
      expect(result).toBe('1');
      expect(services.storage.delete).toHaveBeenCalledWith('1');
    });
  });

  describe('порядок удаления с подзадачами', () => {
    it('должен удалять подзадачи перед родительской задачей', async () => {
      const deleteOrder: string[] = [];
      const storageDelete = vi.fn().mockImplementation(async (id: string) => {
        deleteOrder.push(id);
      });

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          delete: storageDelete,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1\n# Dependencies\n' },
            { id: '1.2', content: '# Title\nSubtask 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
        recursive: true,
      };

      await deleteCommand(options, services);

      // Subtasks deleted before parent
      expect(deleteOrder.indexOf('1.1')).toBeLessThan(deleteOrder.indexOf('1'));
      expect(deleteOrder.indexOf('1.2')).toBeLessThan(deleteOrder.indexOf('1'));
    });
  });

  describe('rollback при ошибке индекса', () => {
    it('должен откатить удаление при ошибке index.remove()', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue('# Title\nTask 1\n# Dependencies\n'),
          list: vi
            .fn()
            .mockResolvedValue([{ id: '1', content: '# Title\nTask 1\n# Dependencies\n' }]),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          remove: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
      };

      await expect(deleteCommand(options, services)).rejects.toThrow('Index error');

      // Should have deleted the task
      expect(services.storage.delete).toHaveBeenCalledWith('1');

      // Should have rolled back by recreating the task
      expect(services.storage.create).toHaveBeenCalledWith(
        '1',
        '# Title\nTask 1\n# Dependencies\n',
      );
    });

    it('должен логировать warning при неудачном rollback', async () => {
      const warns: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((msg) => warns.push(String(msg)));

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue('# Title\nTask 1\n# Dependencies\n'),
          create: vi.fn().mockRejectedValue(new Error('Create failed')),
          list: vi
            .fn()
            .mockResolvedValue([{ id: '1', content: '# Title\nTask 1\n# Dependencies\n' }]),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          remove: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: DeleteCommandOptions = {
        id: '1',
      };

      await expect(deleteCommand(options, services)).rejects.toThrow('Index error');

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain('Предупреждение: не удалось откатить удаление задачи 1');

      vi.restoreAllMocks();
    });
  });
});

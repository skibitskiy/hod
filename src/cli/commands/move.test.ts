import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { moveCommand, type MoveCommandOptions } from './move.js';

const mockConfig: Config = {
  tasksDir: '/tasks',
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
  },
};

const createMockServices = (overrides?: Partial<Services>): Services => {
  const defaultStorage: StorageService = {
    create: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue('# Title\nTest\n# Dependencies\n'),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as StorageService;

  return {
    config: {
      load: vi.fn().mockResolvedValue(mockConfig),
      validate: vi.fn(),
    } as unknown as ConfigService,
    storage: defaultStorage,
    index: {
      load: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      getNextTasks: vi.fn().mockReturnValue([]),
    } as unknown as IndexService,
    parser: ParserService,
    ...overrides,
  };
};

describe('moveCommand', () => {
  let warns: string[] = [];

  beforeEach(() => {
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((msg) => warns.push(String(msg)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('перемещение подзадачи под другого родителя', () => {
    it('должен перемещать подзадачу под другого родителя (1.1 -> 2)', async () => {
      const storageRead = vi
        .fn()
        .mockResolvedValueOnce('# Title\nSubtask 1.1\n# Dependencies\n') // Reading task being moved (1.1)
        .mockResolvedValueOnce('# Title\nParent 2\n# Dependencies\n') // Reading new parent (2)
        .mockRejectedValueOnce(new StorageNotFoundError('2.1')) // Collision check for 2.1 (doesn't exist, good)
        .mockRejectedValueOnce(new StorageNotFoundError('2.2')) // Second collision check for 2.2 (doesn't exist, good)
        .mockRejectedValue(new StorageNotFoundError('Not found')); // All other reads throw

      const storageExists = vi.fn().mockImplementation((id: string) => {
        // Only 1.1 and 2 exist, all others don't
        return Promise.resolve(id === '1.1' || id === '2');
      });

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: storageRead,
          exists: storageExists,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
            { id: '2', content: '# Title\nParent 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1.1',
        parent: '2',
      };

      const result = await moveCommand(options, services);

      // Result should show old_id -> new_id
      expect(result).toBe('1.1 -> 2.2');

      // Verify: create new task, update index, delete old task, remove from index
      expect(services.storage.create).toHaveBeenCalled();
      expect(services.storage.delete).toHaveBeenCalledWith('1.1');
      expect(services.index.remove).toHaveBeenCalledWith('1.1');
    });
  });

  describe('перемещение основной задачи под другую основную задачу', () => {
    it('должен перемещать основную задачу под другую (1 -> 2, становится 2.1)', async () => {
      const storageRead = vi
        .fn()
        .mockResolvedValueOnce('# Title\nTask 1\n# Dependencies\n') // Reading task being moved (1)
        .mockResolvedValueOnce('# Title\nParent 2\n# Dependencies\n') // Reading new parent (2)
        .mockRejectedValueOnce(new StorageNotFoundError('2.1')) // Collision check for 2.1 (doesn't exist, good)
        .mockRejectedValueOnce(new StorageNotFoundError('2.2')) // Second collision check for 2.2 (doesn't exist, good)
        .mockRejectedValue(new StorageNotFoundError('Not found')); // All other reads throw

      const storageExists = vi.fn().mockImplementation((id: string) => {
        // Only 1 and 2 exist, all others don't
        return Promise.resolve(id === '1' || id === '2');
      });

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: storageRead,
          exists: storageExists,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '2', content: '# Title\nParent 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1',
        parent: '2',
      };

      const result = await moveCommand(options, services);

      expect(result).toBe('1 -> 2.2');
      expect(services.storage.create).toHaveBeenCalled();
      expect(services.storage.delete).toHaveBeenCalledWith('1');
    });
  });

  describe('ошибка при перемещении с подзадачами', () => {
    it('должен выбрасывать ошибку если задача имеет подзадачи', async () => {
      const storageRead = vi
        .fn()
        .mockResolvedValueOnce('# Title\nTask 1\n# Dependencies\n')
        .mockResolvedValue('# Title\nParent 2\n# Dependencies\n');

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: storageRead,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
            { id: '2', content: '# Title\nParent 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1',
        parent: '2',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        'Задача 1 имеет подзадачи. Перемещение задач с подзадачами не поддерживается',
      );

      // Should not create or delete anything
      expect(services.storage.create).not.toHaveBeenCalled();
      expect(services.storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('ошибка при перемещении в несуществующего родителя', () => {
    it('должен выбрасывать ошибку если родитель не существует', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          exists: vi
            .fn()
            .mockResolvedValueOnce(true) // Task 1 exists
            .mockResolvedValueOnce(false), // Parent 999 does not exist
          list: vi
            .fn()
            .mockResolvedValue([{ id: '1', content: '# Title\nTask 1\n# Dependencies\n' }]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1',
        parent: '999',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        'Родительская задача 999 не существует',
      );
    });
  });

  describe('ошибка при отсутствии --parent', () => {
    it('должен выбрасывать ошибку если --parent не указан', async () => {
      const services = createMockServices();

      const options: MoveCommandOptions = {
        id: '1',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        '--parent обязателен для команды move',
      );
    });
  });

  describe('ошибка при подзадаче как новом родителе', () => {
    it('должен выбрасывать ошибку если новый родитель является подзадачей', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          exists: vi
            .fn()
            .mockResolvedValueOnce(true) // Task 1 exists
            .mockResolvedValueOnce(true), // Parent 1.1 exists
          list: vi
            .fn()
            .mockResolvedValue([{ id: '1', content: '# Title\nTask 1\n# Dependencies\n' }]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1',
        parent: '1.1',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        'Задача 1.1 является подзадачей. Только основные задачи могут быть родительскими',
      );
    });
  });

  describe('no-op при том же родителе', () => {
    it('должен быть no-op если новый родитель равен текущему', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1.1',
        parent: '1', // Same as current parent
      };

      const result = await moveCommand(options, services);

      // Should return the original id (no-op)
      expect(result).toBe('1.1');

      // Should not create or delete anything
      expect(services.storage.create).not.toHaveBeenCalled();
      expect(services.storage.delete).not.toHaveBeenCalled();
      expect(services.index.update).not.toHaveBeenCalled();
    });
  });

  describe('orphaned references после перемещения', () => {
    it('должен сохранять orphaned references без изменений', async () => {
      // Task 3 references task 1.1. When we move 1.1 to 2.1,
      // task 3's reference becomes orphaned (acceptable in v1)
      const storageRead = vi
        .fn()
        .mockResolvedValueOnce('# Title\nSubtask 1.1\n# Dependencies\n') // Reading 1.1
        .mockResolvedValueOnce('# Title\nParent 2\n# Dependencies\n') // Reading 2
        .mockRejectedValueOnce(new StorageNotFoundError('2.1')) // Collision check for 2.1 (doesn't exist, good)
        .mockRejectedValueOnce(new StorageNotFoundError('2.2')) // Second collision check for 2.2 (doesn't exist, good)
        .mockRejectedValue(new StorageNotFoundError('Not found')); // All other reads throw

      const storageExists = vi.fn().mockImplementation((id: string) => {
        // Only 1.1, 2, and 3 exist, all others don't
        return Promise.resolve(id === '1.1' || id === '2' || id === '3');
      });

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: storageRead,
          exists: storageExists,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
            { id: '2', content: '# Title\nParent 2\n# Dependencies\n' },
            { id: '3', content: '# Title\nTask 3\n# Dependencies\n1.1' }, // References 1.1
          ]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1.1',
        parent: '2',
      };

      const result = await moveCommand(options, services);

      // Should succeed - we don't update other tasks' dependencies
      expect(result).toBe('1.1 -> 2.2');
    });
  });

  describe('валидация ID', () => {
    it('должен выбрасывать ошибку при невалидном формате ID задачи', async () => {
      const services = createMockServices();

      const options: MoveCommandOptions = {
        id: 'invalid-id',
        parent: '2',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        "Невалидный формат ID: 'invalid-id'",
      );
    });

    it('должен выбрасывать ошибку при невалидном формате ID родителя', async () => {
      const services = createMockServices();

      const options: MoveCommandOptions = {
        id: '1',
        parent: 'invalid-parent',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        "Невалидный формат ID: 'invalid-parent'",
      );
    });

    it('должен выбрасывать StorageNotFoundError при несуществующей задаче', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          exists: vi.fn().mockResolvedValue(false),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '999',
        parent: '2',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(StorageNotFoundError);
    });

    it('должен выбрасывать ошибку при ID превышающем MAX_ID_LENGTH', async () => {
      const services = createMockServices();

      // Create a 51-character ID
      const longId = '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1';
      expect(longId.length).toBeGreaterThan(50);

      const options: MoveCommandOptions = {
        id: longId,
        parent: '2',
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        `ID задачи превышает максимальную длину 50 символов: '${longId}'`,
      );
    });

    it('должен выбрасывать ошибку при ID родителя превышающем MAX_ID_LENGTH', async () => {
      const services = createMockServices();

      // Create a 51-character ID
      const longId = '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1';
      expect(longId.length).toBeGreaterThan(50);

      const options: MoveCommandOptions = {
        id: '1',
        parent: longId,
      };

      await expect(moveCommand(options, services)).rejects.toThrow(
        `ID задачи превышает максимальную длину 50 символов: '${longId}'`,
      );
    });
  });

  describe('rollback при ошибках', () => {
    it('должен откатывать создание новой задачи при ошибке index.update()', async () => {
      const storageRead = vi
        .fn()
        .mockResolvedValueOnce('# Title\nTask 1\n# Dependencies\n')
        .mockResolvedValueOnce('# Title\nParent 2\n# Dependencies\n')
        .mockRejectedValueOnce(new StorageNotFoundError('2.1')) // Collision check for 2.1 (doesn't exist, good)
        .mockRejectedValueOnce(new StorageNotFoundError('2.2')) // Second collision check for 2.2 (doesn't exist, good)
        .mockRejectedValue(new StorageNotFoundError('Not found')); // All other reads throw

      const storageExists = vi.fn().mockImplementation((id: string) => {
        // Only 1 and 2 exist, all others don't
        return Promise.resolve(id === '1' || id === '2');
      });

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: storageRead,
          exists: storageExists,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '2', content: '# Title\nParent 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          update: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: MoveCommandOptions = {
        id: '1',
        parent: '2',
      };

      await expect(moveCommand(options, services)).rejects.toThrow('Index error');

      // Should have created the new task
      expect(services.storage.create).toHaveBeenCalled();

      // Should have rolled back by deleting the new task
      // (not the old task - rollback means undoing the creation)
    });

    it('должен логировать warning при неудачном rollback', async () => {
      const storageRead = vi
        .fn()
        .mockResolvedValueOnce('# Title\nTask 1\n# Dependencies\n')
        .mockResolvedValueOnce('# Title\nParent 2\n# Dependencies\n')
        .mockRejectedValueOnce(new StorageNotFoundError('2.1')) // Collision check for 2.1 (doesn't exist, good)
        .mockRejectedValueOnce(new StorageNotFoundError('2.2')) // Second collision check for 2.2 (doesn't exist, good)
        .mockRejectedValue(new StorageNotFoundError('Not found')); // All other reads throw

      const storageExists = vi.fn().mockImplementation((id: string) => {
        // Only 1 and 2 exist, all others don't
        return Promise.resolve(id === '1' || id === '2');
      });

      const storageCreate = vi.fn().mockResolvedValue(undefined);
      const storageDelete = vi
        .fn()
        .mockRejectedValueOnce(new Error('Delete failed')) // Rollback fails
        .mockResolvedValueOnce(undefined); // Second delete would succeed

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          create: storageCreate,
          delete: storageDelete,
          read: storageRead,
          exists: storageExists,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '2', content: '# Title\nParent 2\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          update: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: MoveCommandOptions = {
        id: '1',
        parent: '2',
      };

      await expect(moveCommand(options, services)).rejects.toThrow('Index error');

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain('Предупреждение: не удалось откатить создание задачи');
    });
  });

  describe('collision scenario при генерации нового ID', () => {
    it('должен успешно обрабатывать collision когда другая задача ссылается на сгенерированный ID', async () => {
      // Task 2 has dependency ["3.1"]. User moves task 1 under 3.
      // New ID is 3.1. Task 2's reference now points to the moved task (acceptable)
      const storageRead = vi
        .fn()
        .mockResolvedValueOnce('# Title\nTask 1\n# Dependencies\n')
        .mockResolvedValueOnce('# Title\nParent 3\n# Dependencies\n')
        .mockRejectedValueOnce(new StorageNotFoundError('3.1')) // Collision check for 3.1 (doesn't exist, good)
        .mockRejectedValueOnce(new StorageNotFoundError('3.2')) // Second collision check for 3.2 (doesn't exist, good)
        .mockRejectedValue(new StorageNotFoundError('Not found')); // All other reads throw

      const storageExists = vi.fn().mockImplementation((id: string) => {
        // Only 1, 2, and 3 exist, all others don't
        return Promise.resolve(id === '1' || id === '2' || id === '3');
      });

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: storageRead,
          exists: storageExists,
          list: vi.fn().mockResolvedValue([
            { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
            { id: '2', content: '# Title\nTask 2\n# Dependencies\n3.1' }, // References 3.1
            { id: '3', content: '# Title\nParent 3\n# Dependencies\n' },
          ]),
        } as unknown as StorageService,
      });

      const options: MoveCommandOptions = {
        id: '1',
        parent: '3',
      };

      const result = await moveCommand(options, services);

      // Should succeed - collision is acceptable in v1
      expect(result).toBe('1 -> 3.2');
    });
  });
});

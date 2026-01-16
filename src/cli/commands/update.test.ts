import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { CircularDependencyError } from '../errors.js';
import { updateCommand, type UpdateCommandOptions } from './update.js';

const mockConfig: Config = {
  tasksDir: '/tasks',
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
    Priority: { name: 'priority' },
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

const existingTaskMarkdown = `# Title
Old Title
# Description
Old description
# Dependencies
1, 2
`;

describe('updateCommand', () => {
  let warns: string[] = [];

  beforeEach(() => {
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((msg) => warns.push(String(msg)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('обновление полей', () => {
    it('должен обновлять одно поле', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        title: 'New Title',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');
      expect(services.storage.update).toHaveBeenCalled();
      expect(services.index.update).toHaveBeenCalledWith('1', {
        status: 'pending',
        dependencies: ['1', '2'],
      });
    });

    it('должен обновлять несколько полей одновременно', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        title: 'New Title',
        description: 'New description',
        priority: 'high',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');
      expect(services.storage.update).toHaveBeenCalled();
    });

    it('должен обновлять зависимости с проверкой на циклы', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        dependencies: '3, 4',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');
      expect(services.index.update).toHaveBeenCalledWith('1', {
        status: 'pending',
        dependencies: ['3', '4'],
      });
    });

    it('должен позволять несуществующие ID зависимостей (orphaned references)', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        dependencies: '999', // Non-existent ID
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');
      expect(services.index.update).toHaveBeenCalledWith('1', {
        status: 'pending',
        dependencies: ['999'],
      });
    });

    it('должен очищать все зависимости при --dependencies ""', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        dependencies: '',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');
      expect(services.index.update).toHaveBeenCalledWith('1', {
        status: 'pending',
        dependencies: [],
      });
    });

    it('должен успешно обновляться без указания обязательного поля (если оно существует в задаче)', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        description: 'Only updating description',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');
      expect(services.storage.update).toHaveBeenCalled();
    });
  });

  describe('удаление опциональных полей', () => {
    it('должен удалять описание при --description ""', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        description: '',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');

      // Verify that serialized markdown doesn't contain Description section
      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedMarkdown = updateCall[1] as string;
      expect(updatedMarkdown).not.toContain('# Description');
    });

    it('должен удалять кастомное поле при пустой строке', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue('# Title\nTest\n# Priority\nhigh\n# Dependencies\n'),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        priority: '',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');

      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedMarkdown = updateCall[1] as string;
      expect(updatedMarkdown).not.toContain('# Priority');
    });
  });

  describe('валидация обязательных полей', () => {
    it('должен выбрасывать ошибку при пустой строке для обязательного поля', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        title: '', // Empty required field
      };

      await expect(updateCommand(options, services)).rejects.toThrow(
        "Поле 'Title' не может быть пустым",
      );
    });
  });

  describe('валидация Status поля', () => {
    it('должен выбрасывать ошибку при пустом Status --status ""', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        status: '',
      };

      await expect(updateCommand(options, services)).rejects.toThrow(
        "Поле 'Status' не может быть пустым",
      );
    });
  });

  describe('trim значений', () => {
    it('должен trim значения полей', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        title: '  New Title  ',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe('1');

      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedMarkdown = updateCall[1] as string;
      // Trimmed value should be in the markdown
      expect(updatedMarkdown).toContain('New Title');
      expect(updatedMarkdown).not.toContain('  New Title  ');
    });
  });

  describe('валидация ID', () => {
    it('должен выбрасывать ошибку при невалидном формате ID', async () => {
      const services = createMockServices();

      const options: UpdateCommandOptions = {
        id: 'invalid-id',
      };

      await expect(updateCommand(options, services)).rejects.toThrow(
        "Невалидный формат ID: 'invalid-id'",
      );
    });

    it('должен выбрасывать ошибку при ID превышающем MAX_ID_LENGTH', async () => {
      const services = createMockServices();

      // Create a 51-character ID
      const longId = '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1';
      expect(longId.length).toBeGreaterThan(50);

      const options: UpdateCommandOptions = {
        id: longId,
      };

      await expect(updateCommand(options, services)).rejects.toThrow(
        `ID задачи превышает максимальную длину 50 символов: '${longId}'`,
      );
    });

    it('должен принимать ID равный MAX_ID_LENGTH', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
      });

      // Create a 50-character ID: '1' repeated 50 times
      const maxLengthId = '1'.repeat(50);
      expect(maxLengthId.length).toBe(50);

      const options: UpdateCommandOptions = {
        id: maxLengthId,
        title: 'Test',
      };

      const result = await updateCommand(options, services);

      expect(result).toBe(maxLengthId);
    });

    it('должен выбрасывать ошибку при несуществующей задаче', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          exists: vi.fn().mockResolvedValue(false),
        } as unknown as StorageService,
      });

      const options: UpdateCommandOptions = {
        id: '999',
      };

      await expect(updateCommand(options, services)).rejects.toThrow(StorageNotFoundError);
    });
  });

  describe('неизвестные поля', () => {
    it('должен выбрасывать ошибку для неизвестного поля', async () => {
      const services = createMockServices();

      const options: UpdateCommandOptions = {
        id: '1',
        unknown: 'value',
      };

      await expect(updateCommand(options, services)).rejects.toThrow('Неизвестное поле `unknown`');
    });
  });

  describe('проверка циклических зависимостей', () => {
    it('должен выбрасывать CircularDependencyError при обнаружении цикла', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          load: vi.fn().mockResolvedValue({
            '1': { status: 'pending', dependencies: [] },
            '2': { status: 'pending', dependencies: ['1'] },
          }),
          update: vi
            .fn()
            .mockRejectedValue(
              new CircularDependencyError('Обнаружена циклическая зависимость', ['1', '2', '1']),
            ),
        } as unknown as IndexService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        dependencies: '2',
      };

      await expect(updateCommand(options, services)).rejects.toThrow(CircularDependencyError);
    });
  });

  describe('rollback при ошибке индекса', () => {
    it('должен откатывать storage при ошибке index.update()', async () => {
      const storageUpdate = vi
        .fn()
        .mockResolvedValueOnce(undefined) // First call (actual update)
        .mockResolvedValueOnce(undefined); // Second call (rollback)

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
          update: storageUpdate,
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          update: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        title: 'New Title',
      };

      await expect(updateCommand(options, services)).rejects.toThrow('Index error');

      // Should have called update twice (original + rollback)
      expect(storageUpdate).toHaveBeenCalledTimes(2);
    });

    it('должен логировать warning при неудачном rollback', async () => {
      const storageUpdate = vi
        .fn()
        .mockResolvedValueOnce(undefined) // First call (actual update)
        .mockRejectedValueOnce(new Error('Rollback failed')); // Second call (rollback fails)

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskMarkdown),
          update: storageUpdate,
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          update: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: UpdateCommandOptions = {
        id: '1',
        title: 'New Title',
      };

      await expect(updateCommand(options, services)).rejects.toThrow('Index error');

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain('Предупреждение: не удалось откатить обновление задачи 1');
    });
  });
});

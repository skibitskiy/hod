import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { appendCommand, type AppendCommandOptions } from './append.js';

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
    read: vi.fn().mockResolvedValue(
      JSON.stringify({
        title: 'Old Title',
        description: 'Old description',
      }),
    ),
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

const existingTaskJson = JSON.stringify({
  title: 'Old Title',
  description: 'Old description',
});

describe('appendCommand', () => {
  let warns: string[] = [];

  beforeEach(() => {
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((msg) => warns.push(String(msg)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('appending to existing fields', () => {
    it('должен добавлять к существующему полю с \\n разделителем', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskJson),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          load: vi.fn().mockResolvedValue({
            '1': { status: 'pending', dependencies: [] },
          }),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        description: 'New info to append',
      };

      const result = await appendCommand(options, services);

      expect(result).toBe('1');
      expect(services.storage.update).toHaveBeenCalled();

      // Verify the content was appended with \n separator
      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedJson = updateCall[1] as string;
      const parsed = JSON.parse(updatedJson);
      expect(parsed.description).toBe('Old description\nNew info to append');
      expect(parsed.title).toBe('Old Title'); // Unchanged
    });

    it('должен добавлять к нескольким полям одновременно', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskJson),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          load: vi.fn().mockResolvedValue({
            '1': { status: 'pending', dependencies: [] },
          }),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        title: '- updated',
        description: 'New info',
      };

      const result = await appendCommand(options, services);

      expect(result).toBe('1');

      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedJson = updateCall[1] as string;
      const parsed = JSON.parse(updatedJson);
      expect(parsed.title).toBe('Old Title\n- updated');
      expect(parsed.description).toBe('Old description\nNew info');
    });
  });

  describe('appending to non-existent fields', () => {
    it('должен создавать поле если оно не существует', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(
            JSON.stringify({
              title: 'Title only',
            }),
          ),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          load: vi.fn().mockResolvedValue({
            '1': { status: 'pending', dependencies: [] },
          }),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        description: 'New description',
        priority: 'high',
      };

      const result = await appendCommand(options, services);

      expect(result).toBe('1');

      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedJson = updateCall[1] as string;
      const parsed = JSON.parse(updatedJson);
      expect(parsed.description).toBe('New description');
      expect(parsed.priority).toBe('high');
    });

    it('должен создавать поле если существующее поле пустое', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(
            JSON.stringify({
              title: 'Title',
              description: '',
            }),
          ),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          load: vi.fn().mockResolvedValue({
            '1': { status: 'pending', dependencies: [] },
          }),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        description: 'New description',
      };

      const result = await appendCommand(options, services);

      expect(result).toBe('1');

      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedJson = updateCall[1] as string;
      const parsed = JSON.parse(updatedJson);
      expect(parsed.description).toBe('New description');
    });
  });

  describe('пропуск пустых значений', () => {
    it('должен пропускать поля с пустыми значениями', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskJson),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          load: vi.fn().mockResolvedValue({
            '1': { status: 'pending', dependencies: [] },
          }),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        description: '',
        priority: '',
      };

      const result = await appendCommand(options, services);

      expect(result).toBe('1');

      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedJson = updateCall[1] as string;
      const parsed = JSON.parse(updatedJson);
      // Values should remain unchanged
      expect(parsed.description).toBe('Old description');
      expect(parsed).not.toHaveProperty('priority');
    });
  });

  describe('системные поля', () => {
    it('должен выбрасывать ошибку при попытке append к Status', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskJson),
        } as unknown as StorageService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        status: 'done',
      };

      await expect(appendCommand(options, services)).rejects.toThrow(
        "Нельзя добавить данные к системному полю 'Status'",
      );
    });

    it('должен выбрасывать ошибку при попытке append к Dependencies', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskJson),
        } as unknown as StorageService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        dependencies: '2,3',
      };

      await expect(appendCommand(options, services)).rejects.toThrow(
        "Нельзя добавить данные к системному полю 'Dependencies'",
      );
    });
  });

  describe('валидация обязательных полей', () => {
    it('должен выбрасывать ошибку если после append обязательное поле пустое', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(
            JSON.stringify({
              title: 'Old Title',
            }),
          ),
        } as unknown as StorageService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        title: '',
      };

      await expect(appendCommand(options, services)).rejects.toThrow(
        "Поле 'Title' не может быть пустым",
      );
    });
  });

  describe('валидация ID', () => {
    it('должен выбрасывать ошибку при невалидном формате ID', async () => {
      const services = createMockServices();

      const options: AppendCommandOptions = {
        id: 'invalid-id',
      };

      await expect(appendCommand(options, services)).rejects.toThrow(
        "Невалидный формат ID: 'invalid-id'",
      );
    });

    it('должен выбрасывать ошибку при ID превышающем MAX_ID_LENGTH', async () => {
      const services = createMockServices();

      // Create a 51-character ID
      const longId = '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1';
      expect(longId.length).toBeGreaterThan(50);

      const options: AppendCommandOptions = {
        id: longId,
      };

      await expect(appendCommand(options, services)).rejects.toThrow(
        `ID задачи превышает максимальную длину 50 символов: '${longId}'`,
      );
    });

    it('должен выбрасывать ошибку при несуществующей задаче', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          exists: vi.fn().mockResolvedValue(false),
        } as unknown as StorageService,
      });

      const options: AppendCommandOptions = {
        id: '999',
      };

      await expect(appendCommand(options, services)).rejects.toThrow(StorageNotFoundError);
    });
  });

  describe('неизвестные поля', () => {
    it('должен выбрасывать ошибку для неизвестного поля', async () => {
      const services = createMockServices();

      const options: AppendCommandOptions = {
        id: '1',
        unknown: 'value',
      };

      await expect(appendCommand(options, services)).rejects.toThrow('Неизвестное поле `unknown`');
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
          read: vi.fn().mockResolvedValue(existingTaskJson),
          update: storageUpdate,
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          update: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        description: 'New info',
      };

      await expect(appendCommand(options, services)).rejects.toThrow('Index error');

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
          read: vi.fn().mockResolvedValue(existingTaskJson),
          update: storageUpdate,
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          update: vi.fn().mockRejectedValue(new Error('Index error')),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        description: 'New info',
      };

      await expect(appendCommand(options, services)).rejects.toThrow('Index error');

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain('Предупреждение: не удалось откатить обновление задачи 1');
    });
  });

  describe('trim значений', () => {
    it('должен trim добавляемые значения', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          read: vi.fn().mockResolvedValue(existingTaskJson),
        } as unknown as StorageService,
        index: {
          ...createMockServices().index,
          load: vi.fn().mockResolvedValue({
            '1': { status: 'pending', dependencies: [] },
          }),
        } as unknown as IndexService,
      });

      const options: AppendCommandOptions = {
        id: '1',
        description: '  New info  ',
      };

      const result = await appendCommand(options, services);

      expect(result).toBe('1');

      const updateCall = (services.storage.update as ReturnType<typeof vi.fn>).mock.calls[0];
      const updatedJson = updateCall[1] as string;
      const parsed = JSON.parse(updatedJson);
      // Trimmed value should be appended
      expect(parsed.description).toBe('Old description\nNew info');
    });
  });
});

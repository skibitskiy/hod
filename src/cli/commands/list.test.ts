import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { StorageAccessError } from '../../storage/errors.js';
import { listCommand, type ListCommandOptions } from './list.js';

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
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
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

describe('listCommand', () => {
  let logs: string[] = [];
  let errors: string[] = [];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
    vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('валидация полей (fail-fast)', () => {
    it('должен выбрасывать ошибку для неизвестного поля', async () => {
      const services = createMockServices();
      const options: ListCommandOptions = { unknown: 'value' };

      await expect(listCommand(options, services)).rejects.toThrow(
        'Неизвестное поле `unknown`. Доступные поля: title, description, status, priority',
      );
    });

    it('должен выбрасывать ошибку для dependencies поля', async () => {
      const services = createMockServices();
      const options: ListCommandOptions = { dependencies: '1' };

      await expect(listCommand(options, services)).rejects.toThrow(
        'Неизвестное поле `dependencies`',
      );
    });

    it('не должен выбрасывать ошибку для известных полей', async () => {
      const services = createMockServices();
      const options: ListCommandOptions = { title: 'Test' };

      await expect(listCommand(options, services)).resolves.not.toThrow();
    });
  });

  describe('фильтрация', () => {
    const mockTasks = [
      {
        id: '1',
        content: '# Title\nЗадача 1',
      },
      {
        id: '2',
        content: '# Title\nЗадача 2',
      },
      {
        id: '3',
        content: '# Title\nЗадача 3\n# Priority\nhigh',
      },
    ];

    it('должен фильтровать по одному полю (status)', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { status: 'pending' };
      await listCommand(options, services);

      const output = logs.join('\n');
      // Статус больше не читается из markdown (всегда 'pending' при парсинге)
      // Поэтому все задачи с 'pending' статусом будут показаны
      expect(output).toContain('Задача 1');
      expect(output).toContain('Задача 2');
      expect(output).toContain('Задача 3');
    });

    it('должен фильтровать по нескольким полям (AND логика)', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { status: 'pending', priority: 'high' };
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('Задача 3');
      expect(output).not.toContain('Задача 1');
      expect(output).not.toContain('Задача 2');
    });

    it('должен быть case-sensitive', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { status: 'Pending' }; // Capital P
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).not.toContain('Задача 1');
      expect(output).toContain('Нет задач');
    });

    it('должен показывать все задачи при пустых фильтрах', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = {};
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('Задача 1');
      expect(output).toContain('Задача 2');
      expect(output).toContain('Задача 3');
    });

    it('должен пропускать задачи где поле отсутствует (undefined)', async () => {
      const tasks = [
        { id: '1', content: '# Title\nЗадача 1\n# Priority\nhigh' },
        { id: '2', content: '# Title\nЗадача 2' }, // No priority
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { priority: 'high' };
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('Задача 1');
      expect(output).not.toContain('Задача 2');
    });

    it('пустой результат → "Нет задач"', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { status: 'cancelled' };
      await listCommand(options, services);

      expect(logs).toContain('Нет задач');
    });

    it('должен обрабатывать empty string и undefined одинаково при фильтрации', async () => {
      const tasks = [
        { id: '1', content: '# Title\nЗадача 1\n# Priority\nhigh' },
        { id: '2', content: '# Title\nЗадача 2\n# Priority\n' }, // Empty value
        { id: '3', content: '# Title\nЗадача 3' }, // No priority field
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      // Empty string и undefined не проходят фильтр
      const options: ListCommandOptions = { priority: 'high' };
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('Задача 1');
      expect(output).not.toContain('Задача 2'); // empty string
      expect(output).not.toContain('Задача 3'); // undefined
    });
  });

  describe('JSON формат вывода', () => {
    const mockTasks = [
      {
        id: '1',
        content: '# Title\nЗадача 1\n# Status\npending\n# Dependencies\n2, 3',
      },
      {
        id: '2',
        content: '# Title\nЗадача 2\n# Status\ncompleted',
      },
    ];

    it('должен выводить валидный JSON', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { json: true };
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('должен сортировать dependencies', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { json: true };
      await listCommand(options, services);

      const output = logs.join('\n');
      const parsed = JSON.parse(output);
      expect(parsed[0].dependencies).toEqual(['2', '3']);
    });

    it('пустой результат → []', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { json: true, status: 'cancelled' };
      await listCommand(options, services);

      expect(logs[0]).toBe('[]');
    });

    it('должен пропускать missing fields в JSON', async () => {
      const tasks = [
        { id: '1', content: '# Title\nЗадача 1' }, // No description, no priority (custom field)
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { json: true };
      await listCommand(options, services);

      const output = logs.join('\n');
      const parsed = JSON.parse(output);
      expect(parsed[0]).toHaveProperty('id');
      expect(parsed[0]).toHaveProperty('title');
      expect(parsed[0]).toHaveProperty('status'); // Has default value
      expect(parsed[0]).toHaveProperty('dependencies'); // Always included
      expect(parsed[0]).not.toHaveProperty('description'); // Missing, skipped
      expect(parsed[0]).not.toHaveProperty('priority'); // Missing, skipped
    });

    it('комбинирует json с фильтрами', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { json: true, status: 'pending' };
      await listCommand(options, services);

      const output = logs.join('\n');
      const parsed = JSON.parse(output);
      // Статус больше не читается из markdown (всегда 'pending' при парсинге)
      // Поэтому все задачи с 'pending' статусом будут показаны
      expect(parsed).toHaveLength(2);
      expect(parsed[0].status).toBe('pending');
      expect(parsed[1].status).toBe('pending');
    });
  });

  describe('табличный формат вывода', () => {
    const mockTasks = [
      {
        id: '1',
        content: '# Title\nКороткая\n# Status\npending',
      },
      {
        id: '2',
        content: '# Title\nОчень длинная задача которая расширяет колонку\n# Status\ncompleted',
      },
    ];

    it('должен выводить таблицу с заголовками', async () => {
      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(mockTasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = {};
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('ID');
      expect(output).toContain('Status');
      expect(output).toContain('Title');
    });

    it('должен показывать "-" для пустых значений', async () => {
      const tasks = [
        { id: '1', content: '# Title\nЗадача 1' }, // No status
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = {};
      await listCommand(options, services);

      const output = logs.join('\n');
      // Проверяем что есть строка с "-" в статусе
      expect(output).toMatch(/1\s+-/);
    });
  });

  describe('обработка ошибок парсинга', () => {
    it('должен пропускать задачи с ошибками парсинга с warning', async () => {
      const tasks = [
        { id: '1', content: '# Title\nЗадача 1\n# Status\npending' },
        { id: '2', content: 'Невалидный markdown без Title' },
        { id: '3', content: '# Title\nЗадача 3\n# Status\ncompleted' },
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = {};
      await listCommand(options, services);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Предупреждение: задача 2');
      expect(errors[0]).toContain('пропущена');

      const output = logs.join('\n');
      expect(output).toContain('Задача 1');
      expect(output).toContain('Задача 3');
      expect(output).not.toContain('Невалидный markdown');
    });
  });

  describe('обработка StorageAccessError', () => {
    it('должен обрабатывать StorageAccessError с exit code 1', async () => {
      const storageError = new StorageAccessError('Нет прав доступа к директории задач');
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1) called');
      });

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockRejectedValue(storageError),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = {};

      await expect(listCommand(options, services)).rejects.toThrow('process.exit(1) called');
      expect(errors[0]).toContain('Нет прав доступа к директории задач');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('custom поля (lowercase)', () => {
    it('должен фильтровать по custom полям с lowercase ключами', async () => {
      const tasks = [
        {
          id: '1',
          content: '# Title\nЗадача 1\n# Priority\nhigh',
        },
        {
          id: '2',
          content: '# Title\nЗадача 2\n# Priority\nlow',
        },
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { priority: 'high' };
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('Задача 1');
      expect(output).not.toContain('Задача 2');
    });
  });

  describe('спецсимволы в значениях', () => {
    it('должен заменять newlines на пробел в таблице', async () => {
      const tasks = [
        {
          id: '1',
          content: '# Title\nЗадача 1\n# Description\nСтрока1\nСтрока2\nСтрока3',
        },
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = {};
      await listCommand(options, services);

      const output = logs.join('\n');
      // Newlines заменены на пробелы
      expect(output).toContain('Строка1 Строка2 Строка3');
      expect(output).not.toContain('Строка1\nСтрока2');
    });

    it('должен сохранять newlines в JSON', async () => {
      const tasks = [
        {
          id: '1',
          content: '# Title\nЗадача 1\n# Description\nСтрока1\nСтрока2',
        },
      ];

      const services = createMockServices({
        storage: {
          ...createMockServices().storage,
          list: vi.fn().mockResolvedValue(tasks),
        } as unknown as StorageService,
      });

      const options: ListCommandOptions = { json: true };
      await listCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('Строка1\\nСтрока2');
    });
  });
});

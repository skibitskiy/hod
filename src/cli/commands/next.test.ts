import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { nextCommand, type NextCommandOptions } from './next.js';
import { StorageAccessError } from '../../storage/errors.js';

const mockConfig: Config = {
  tasksDir: '/tasks',
  doneStatus: 'completed',
  doneStatuses: ['completed'],
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
  },
};

const createMockServices = (
  tasks: Array<{ id: string; content: string }> = [],
  indexData?: Record<string, { status: string; dependencies: string[] }>,
  config: Config = mockConfig,
): Services => ({
  config: {
    load: vi.fn().mockResolvedValue(config),
    validate: vi.fn(),
  } as unknown as ConfigService,
  storage: {
    list: vi.fn().mockResolvedValue(tasks),
  } as unknown as StorageService,
  index: {
    load: vi.fn().mockResolvedValue(indexData ?? {}),
    getNextTasks: vi.fn().mockResolvedValue(['1', '2']),
  } as unknown as IndexService,
  parser: ParserService,
});

describe('next command', () => {
  let logs: string[] = [];
  let errors: string[] = [];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
    vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg)));
  });

  describe('получение списка задач', () => {
    it('должен показывать первую задачу готовую к выполнению (без --all)', async () => {
      const tasks = [
        { id: '1', content: '# Title\nFirst Task' },
        { id: '2', content: '# Title\nSecond Task' },
      ];
      const indexData = {
        '1': { status: 'pending', dependencies: [] },
        '2': { status: 'pending', dependencies: ['1'] },
      };
      const services = createMockServices(tasks, indexData);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1', '2']);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      // getNextTasks вызван с doneStatuses из конфига
      expect(services.index.getNextTasks).toHaveBeenCalledWith(['completed']);

      // Показана только первая задача
      expect(logs.join('\n')).toContain('First Task');
      expect(logs.join('\n')).not.toContain('Second Task');
    });

    it('должен показывать все задачи с --all', async () => {
      const tasks = [
        { id: '1', content: '# Title\nFirst Task' },
        { id: '2', content: '# Title\nSecond Task' },
      ];
      const indexData = {
        '1': { status: 'pending', dependencies: [] },
        '2': { status: 'pending', dependencies: ['1'] },
      };
      const services = createMockServices(tasks, indexData);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1', '2']);

      const options: NextCommandOptions = { all: true };
      await nextCommand(options, services);

      // Показаны обе задачи
      expect(logs.join('\n')).toContain('First Task');
      expect(logs.join('\n')).toContain('Second Task');
    });

    it('должен использовать doneStatus из конфига', async () => {
      const customConfig: Config = {
        ...mockConfig,
        doneStatus: 'done',
        doneStatuses: undefined, // Override to test doneStatus fallback
      };
      const services = createMockServices([], {}, customConfig);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      // doneStatus is wrapped in array when passed to getNextTasks
      expect(services.index.getNextTasks).toHaveBeenCalledWith(['done']);
    });

    it('должен использовать doneStatuses из конфига', async () => {
      const customConfig: Config = {
        ...mockConfig,
        doneStatuses: ['done', 'completed', 'closed'],
      };
      const services = createMockServices([], {}, customConfig);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      expect(services.index.getNextTasks).toHaveBeenCalledWith(['done', 'completed', 'closed']);
    });

    it('должен использовать "completed" как дефолтный doneStatus', async () => {
      const configWithoutDoneStatus: Config = {
        tasksDir: '/tasks',
        fields: mockConfig.fields,
      };
      const services = createMockServices([], {}, configWithoutDoneStatus);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      // Default is wrapped in array when passed to getNextTasks
      expect(services.index.getNextTasks).toHaveBeenCalledWith(['completed']);
    });
  });

  describe('вывод сообщений', () => {
    it('должен выводить "Нет задач готовых к выполнению" если список пуст', async () => {
      const services = createMockServices([], {});
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      expect(logs[0]).toBe('Нет задач готовых к выполнению');
    });

    it('должен выводить предупреждение если задача не найдена в хранилище', async () => {
      const services = createMockServices([], {});
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      expect(errors[0]).toContain('не найдена в хранилище');
    });

    it('должен выводить "Нет задач доступных для показа" если задачи не найдены в хранилище', async () => {
      const services = createMockServices([], {});
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      // После того как все задачи пропущены (не найдены в хранилище)
      expect(logs[logs.length - 1]).toBe(
        'Нет задач доступных для показа (задачи не найдены в хранилище)',
      );
    });

    it('должен выводить предупреждение при ошибке парсинга', async () => {
      const tasks = [{ id: '1', content: 'invalid content' }];
      const services = createMockServices(tasks, {});
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      expect(errors.some((e) => e.includes('1') && e.includes('пропущена'))).toBe(true);
    });
  });

  describe('опция --json', () => {
    it('должен выводить валидный JSON', async () => {
      const tasks = [{ id: '1', content: '# Title\nTest Task' }];
      const indexData = { '1': { status: 'pending', dependencies: [] } };
      const services = createMockServices(tasks, indexData);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = { json: true };
      await nextCommand(options, services);

      const output = logs.join('\n');
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('должен включать все поля в JSON', async () => {
      const tasks = [{ id: '1', content: '# Title\nTest Task\n# Description\nTest Description' }];
      const indexData = { '1': { status: 'pending', dependencies: ['2'] } };
      const services = createMockServices(tasks, indexData);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = { json: true };
      await nextCommand(options, services);

      const parsed = JSON.parse(logs.join('\n'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('id', '1');
      expect(parsed[0]).toHaveProperty('title', 'Test Task');
      expect(parsed[0]).toHaveProperty('description', 'Test Description');
      expect(parsed[0]).toHaveProperty('status', 'pending');
      expect(parsed[0]).toHaveProperty('dependencies', ['2']);
    });

    it('должен выводить текстовое сообщение если нет задач (ранний возврат)', async () => {
      const services = createMockServices([], {});
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const options: NextCommandOptions = { json: true };
      await nextCommand(options, services);

      // Ранний возврат выводит текст, не JSON
      expect(logs[0]).toBe('Нет задач готовых к выполнению');
    });
  });

  describe('форматирование таблицы', () => {
    it('должен выводить таблицу с заголовком', async () => {
      const tasks = [{ id: '1', content: '# Title\nTest Task' }];
      const indexData = { '1': { status: 'pending', dependencies: [] } };
      const services = createMockServices(tasks, indexData);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      const output = logs.join('\n');
      expect(output).toContain('ID');
      expect(output).toContain('Title');
      expect(output).toContain('Status');
    });

    it('должен выводить статус из индекса', async () => {
      const tasks = [{ id: '1', content: '# Title\nTest Task' }];
      const indexData = { '1': { status: 'in_progress', dependencies: [] } };
      const services = createMockServices(tasks, indexData);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      expect(logs.join('\n')).toContain('in_progress');
    });

    it('должен заменять пустые значения на "-"', async () => {
      const tasks = [{ id: '1', content: '# Title\nTest Task' }];
      const indexData = { '1': { status: 'pending', dependencies: [] } };
      const services = createMockServices(tasks, indexData);
      (services.index.getNextTasks as ReturnType<typeof vi.fn>).mockResolvedValue(['1']);

      const options: NextCommandOptions = {};
      await nextCommand(options, services);

      expect(logs.join('\n')).toContain('-'); // Для пустого description
    });
  });

  describe('обработка ошибок', () => {
    it('должен обрабатывать StorageAccessError', async () => {
      const services = createMockServices([], {});
      const storageError = new StorageAccessError('Нет доступа к директории');
      (services.storage.list as ReturnType<typeof vi.fn>).mockRejectedValue(storageError);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1) called');
      });

      const options: NextCommandOptions = {};

      await expect(async () => await nextCommand(options, services)).rejects.toThrow(
        'process.exit(1) called',
      );

      expect(errors.length).toBeGreaterThan(0);

      exitSpy.mockRestore();
    });
  });
});

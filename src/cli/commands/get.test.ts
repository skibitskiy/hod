import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { getCommand, type GetCommandOptions } from './get.js';

const mockConfig: Config = {
  tasksDir: '/tasks',
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
  },
};

const createMockServices = (
  taskContent?: string,
  indexData?: Record<string, { status: string; dependencies: string[] }>,
): Services => ({
  config: {
    load: vi.fn().mockResolvedValue(mockConfig),
    validate: vi.fn(),
  } as unknown as ConfigService,
  storage: {
    read: vi.fn().mockResolvedValue(taskContent || '# Title\nTest Task'),
  } as unknown as StorageService,
  index: {
    load: vi.fn().mockResolvedValue(indexData ?? {}),
  } as unknown as IndexService,
  parser: ParserService,
});

describe('get command', () => {
  let logs: string[] = [];
  let errors: string[] = [];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
    vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg)));
  });

  describe('валидация ID', () => {
    it('должен принимать валидный ID (число)', async () => {
      const services = createMockServices();
      const options: GetCommandOptions = {};

      await getCommand('1', options, services);

      expect(services.storage.read).toHaveBeenCalledWith('1');
    });

    it('должен принимать валидный ID (подзадача)', async () => {
      const services = createMockServices();
      const options: GetCommandOptions = {};

      await getCommand('1.2.3', options, services);

      expect(services.storage.read).toHaveBeenCalledWith('1.2.3');
    });

    it('должен отклонять ID с буквами', async () => {
      const services = createMockServices();
      const options: GetCommandOptions = {};

      await expect(getCommand('a1', options, services)).rejects.toThrow('Невалидный формат ID');
    });

    it('должен отклонять ID с спецсимволами (кроме точки)', async () => {
      const services = createMockServices();
      const options: GetCommandOptions = {};

      await expect(getCommand('1-2', options, services)).rejects.toThrow('Невалидный формат ID');
    });

    it('должен отклонять пустой ID', async () => {
      const services = createMockServices();
      const options: GetCommandOptions = {};

      await expect(getCommand('', options, services)).rejects.toThrow('Невалидный формат ID');
    });

    it('должен отклонять ID с двумя точками подряд', async () => {
      const services = createMockServices();
      const options: GetCommandOptions = {};

      await expect(getCommand('1..2', options, services)).rejects.toThrow('Невалидный формат ID');
    });

    it('должен отклонять ID превышающий 50 символов', async () => {
      const services = createMockServices();
      const options: GetCommandOptions = {};

      // Create ID that exceeds MAX_ID_LENGTH (50 chars) - 53 chars
      const longId = '1.22.33.44.55.66.77.88.99.100.111.222.333.444.555.666';

      await expect(getCommand(longId, options, services)).rejects.toThrow(
        'превышает максимальную длину',
      );
    });
  });

  describe('чтение задачи', () => {
    it('должен выбрасывать ошибку если задача не найдена', async () => {
      const services = createMockServices();
      (services.storage.read as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Задача 999 не найден'),
      );
      const options: GetCommandOptions = {};

      await expect(getCommand('999', options, services)).rejects.toThrow(
        'Задача с ID "999" не найдена',
      );
    });

    it('должен парсить markdown контент', async () => {
      const content = '# Title\nTest Task\n# Description\nTest Description';
      const services = createMockServices(content);
      const options: GetCommandOptions = {};

      await getCommand('1', options, services);

      expect(logs.join('\n')).toContain('Test Task');
    });

    it('должен парсить JSON контент', async () => {
      const content = '{"title":"Test Task","description":"Test Description"}';
      const services = createMockServices(content);
      const options: GetCommandOptions = {};

      await getCommand('1', options, services);

      expect(logs.join('\n')).toContain('Test Task');
    });

    it('должен правильно определять формат JSON vs markdown', async () => {
      // JSON format
      const jsonContent = '{"title":"Task"}';
      let services = createMockServices(jsonContent);
      await getCommand('1', {}, services);
      expect(logs.join('\n')).toContain('Task');

      // Markdown format
      logs = [];
      const mdContent = '# Title\nTask';
      services = createMockServices(mdContent);
      await getCommand('1', {}, services);
      expect(logs.join('\n')).toContain('Task');
    });

    it('не должен парсить невалидный JSON как JSON', async () => {
      // Invalid JSON that starts with { but is malformed
      // Should be detected as NOT JSON by isJsonContent, then fail markdown parsing
      const content = '{invalid json}';
      const services = createMockServices(content);
      const options: GetCommandOptions = {};

      // Should throw ParseError from markdown parser (not JSON parser)
      await expect(async () => await getCommand('1', options, services)).rejects.toThrow('Title');
    });
  });

  describe('опция --title', () => {
    it('должен выводить только заголовок с ID', async () => {
      const services = createMockServices('# Title\nMy Task Title');
      const options: GetCommandOptions = { title: true };

      await getCommand('5', options, services);

      expect(logs[0]).toBe('5. My Task Title');
      expect(logs.length).toBe(1);
    });
  });

  describe('опция --status', () => {
    it('должен выводить только статус из индекса', async () => {
      const indexData = { '1': { status: 'done', dependencies: [] } };
      const services = createMockServices('# Title\nTask', indexData);
      const options: GetCommandOptions = { status: true };

      await getCommand('1', options, services);

      expect(logs[0]).toBe('done');
      expect(logs.length).toBe(1);
    });

    it('должен выбрасывать ошибку если задачи нет в индексе', async () => {
      const services = createMockServices('# Title\nTask', {});
      const options: GetCommandOptions = { status: true };

      await expect(getCommand('1', options, services)).rejects.toThrow('не найдена в индексе');
    });
  });

  describe('опция --dependencies', () => {
    it('должен выводить зависимости через запятую', async () => {
      const indexData = { '1': { status: 'pending', dependencies: ['2', '3', '5'] } };
      const services = createMockServices('# Title\nTask', indexData);
      const options: GetCommandOptions = { dependencies: true };

      await getCommand('1', options, services);

      expect(logs[0]).toBe('2, 3, 5');
    });

    it('должен выводить "Нет зависимостей" если список пуст', async () => {
      const indexData = { '1': { status: 'pending', dependencies: [] } };
      const services = createMockServices('# Title\nTask', indexData);
      const options: GetCommandOptions = { dependencies: true };

      await getCommand('1', options, services);

      expect(logs[0]).toBe('Нет зависимостей');
    });

    it('должен выбрасывать ошибку если задачи нет в индексе', async () => {
      const services = createMockServices('# Title\nTask', {});
      const options: GetCommandOptions = { dependencies: true };

      await expect(getCommand('1', options, services)).rejects.toThrow('не найдена в индексе');
    });
  });

  describe('опция --json', () => {
    it('должен выводить валидный JSON', async () => {
      const content = '# Title\nTest Task\n# Description\nTest Description';
      const indexData = { '1': { status: 'done', dependencies: ['2'] } };
      const services = createMockServices(content, indexData);
      const options: GetCommandOptions = { json: true };

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('должен включать все поля в JSON', async () => {
      const content = '# Title\nTest Task\n# Description\nTest Description';
      const indexData = { '1': { status: 'done', dependencies: ['2', '3'] } };
      const services = createMockServices(content, indexData);
      const options: GetCommandOptions = { json: true };

      await getCommand('1', options, services);

      const parsed = JSON.parse(logs.join('\n'));
      expect(parsed).toHaveProperty('id', '1');
      expect(parsed).toHaveProperty('title', 'Test Task');
      expect(parsed).toHaveProperty('description', 'Test Description');
      expect(parsed).toHaveProperty('status', 'done');
      expect(parsed).toHaveProperty('dependencies', ['2', '3']);
    });

    it('JSON имеет приоритет над другими опциями', async () => {
      const services = createMockServices('# Title\nTask');
      const options: GetCommandOptions = { json: true, title: true };

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(() => JSON.parse(output)).not.toThrow();
      expect(output).not.toContain('1. Task'); // Not title format
    });
  });

  describe('опция --markdown', () => {
    it('должен выводить markdown с Title секцией', async () => {
      const content = '# Title\nTest Task\n# Description\nTest Description';
      const services = createMockServices(content);
      const options: GetCommandOptions = { markdown: true };

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(output).toContain('# Title');
      expect(output).toContain('Test Task');
    });

    it('должен выводить markdown с Description секцией', async () => {
      const content = '# Title\nTest Task\n# Description\nTest Description';
      const services = createMockServices(content);
      const options: GetCommandOptions = { markdown: true };

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(output).toContain('# Description');
      expect(output).toContain('Test Description');
    });

    it('НЕ должен включать Status в markdown (stored in index only)', async () => {
      const content = '# Title\nTest Task\n# Status\npending'; // Even if in file
      const indexData = { '1': { status: 'done', dependencies: [] } };
      const services = createMockServices(content, indexData);
      const options: GetCommandOptions = { markdown: true };

      await getCommand('1', options, services);

      const output = logs.join('\n');
      // Status should NOT be in markdown output
      expect(output).not.toContain('# Status');
    });

    it('markdown имеет приоритет над другими опциями', async () => {
      const services = createMockServices('# Title\nTask');
      const options: GetCommandOptions = { markdown: true, title: true };

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(output).toContain('# Title');
      expect(output).not.toMatch(/^1\. Task$/); // Not title format
    });
  });

  describe('полный вывод (без опций)', () => {
    it('должен выводить ID, Title, Status, Dependencies, Description', async () => {
      const content = '# Title\nTest Task\n# Description\nTest Description';
      const indexData = { '1': { status: 'done', dependencies: ['2', '3'] } };
      const services = createMockServices(content, indexData);
      const options: GetCommandOptions = {};

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(output).toContain('ID: 1');
      expect(output).toContain('Title: Test Task');
      expect(output).toContain('Status: done');
      expect(output).toContain('Dependencies: 2, 3');
      expect(output).toContain('Description: Test Description');
    });

    it('должен пропускать пустые зависимости', async () => {
      const content = '# Title\nTest Task';
      const indexData = { '1': { status: 'pending', dependencies: [] } };
      const services = createMockServices(content, indexData);
      const options: GetCommandOptions = {};

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(output).toContain('ID: 1');
      expect(output).toContain('Title: Test Task');
      expect(output).toContain('Status: pending');
      expect(output).not.toContain('Dependencies:');
    });

    it('должен выводить custom поля из конфига', async () => {
      const customConfig: Config = {
        tasksDir: '/tasks',
        fields: {
          Title: { name: 'title', required: true },
          Priority: { name: 'priority' },
        },
      };
      const content = '# Title\nTest Task\n# Priority\nhigh';
      const services = createMockServices(content);
      (services.config.load as ReturnType<typeof vi.fn>).mockResolvedValue(customConfig);
      const options: GetCommandOptions = {};

      await getCommand('1', options, services);

      const output = logs.join('\n');
      expect(output).toContain('Priority: high');
    });
  });

  describe('приоритет опций', () => {
    it('--markdow имеет приоритет над --title', async () => {
      const services = createMockServices('# Title\nTask');
      const options: GetCommandOptions = { markdown: true, title: true };

      await getCommand('1', options, services);

      expect(logs.join('\n')).toContain('# Title');
    });

    it('--json имеет приоритет над --title', async () => {
      const services = createMockServices('# Title\nTask');
      const options: GetCommandOptions = { json: true, title: true };

      await getCommand('1', options, services);

      expect(() => JSON.parse(logs.join('\n'))).not.toThrow();
    });

    it('--json имеет приоритет над --dependencies', async () => {
      const services = createMockServices('# Title\nTask');
      const options: GetCommandOptions = { json: true, dependencies: true };

      await getCommand('1', options, services);

      expect(() => JSON.parse(logs.join('\n'))).not.toThrow();
    });
  });
});

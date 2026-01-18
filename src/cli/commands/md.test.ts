import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Services } from '../services.js';
import type { FileIO } from './migrate-types.js';
import { ParserService } from '../../parser/parser.js';
import { mdCommand, type MdCommandOptions } from './md.js';
import { Volume } from 'memfs';
import { resolve } from 'node:path';

const createMockServices = (): Services => ({
  config: {
    load: vi.fn().mockResolvedValue({
      tasksDir: '/tasks',
      fields: {
        Title: { name: 'title', required: true },
        Description: { name: 'description' },
      },
    }),
    validate: vi.fn(),
    createDefault: vi.fn(),
  },
  storage: {
    read: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    exists: vi.fn(),
  },
  index: {
    load: vi.fn().mockResolvedValue({}),
    update: vi.fn(),
    getNextTasks: vi.fn(),
    remove: vi.fn(),
  },
  parser: ParserService,
});

const createMemfsFileIO = (vol: Volume): FileIO => ({
  readFile: vi
    .fn()
    .mockImplementation((path: string | URL, options: { encoding: BufferEncoding }) => {
      return vol.promises.readFile(path, { encoding: options.encoding }) as Promise<string>;
    }),
  writeFile: vi
    .fn()
    .mockImplementation(
      (path: string | URL, data: string, options: { encoding: BufferEncoding }) => {
        return vol.promises.writeFile(path, data, { encoding: options.encoding });
      },
    ),
  mkdir: vi.fn().mockImplementation((path: string | URL, options: { recursive: boolean }) => {
    return vol.promises.mkdir(path, options) as Promise<void>;
  }),
  rename: vi.fn().mockImplementation((oldPath: string | URL, newPath: string | URL) => {
    return vol.promises.rename(oldPath, newPath);
  }),
  unlink: vi.fn().mockImplementation((path: string | URL) => {
    return vol.promises.unlink(path);
  }),
});

describe('md command', () => {
  let logs: string[] = [];
  let errors: string[] = [];
  let vol: Volume;
  let services: Services;
  let memfsIO: FileIO;

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg)));
    vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg)));

    // Create a new memfs volume for each test
    vol = new Volume();
    services = createMockServices();
    memfsIO = createMemfsFileIO(vol);

    // Mock storage.read to return content from our virtual filesystem
    vi.spyOn(services.storage, 'read').mockImplementation(async (id: string) => {
      const tasksDir = (await services.config.load()).tasksDir;
      // Try .json first, then .md
      let filePath = resolve(tasksDir, `${id}.json`);
      try {
        const content = (await vol.promises.readFile(filePath, 'utf-8')) as string;
        return content;
      } catch {
        // Try .md file
        filePath = resolve(tasksDir, `${id}.md`);
        try {
          const content = (await vol.promises.readFile(filePath, 'utf-8')) as string;
          return content;
        } catch {
          // Neither file exists - throw proper storage error
          throw new Error(`Задача ${id} не найдена`);
        }
      }
    });
  });

  describe('валидация ID', () => {
    it('должен выбрасывать ошибку для невалидного ID', async () => {
      const options: MdCommandOptions = {};

      await expect(mdCommand('invalid-id', options, services, memfsIO)).rejects.toThrow(
        'Невалидный формат ID',
      );
    });

    it('должен выбрасывать ошибку для пустого ID', async () => {
      const options: MdCommandOptions = {};

      await expect(mdCommand('', options, services, memfsIO)).rejects.toThrow('ID');
    });

    it('должен выбрасывать ошибку для слишком длинного ID', async () => {
      const options: MdCommandOptions = {};
      const longId = '1'.repeat(51); // More than 50 characters

      await expect(mdCommand(longId, options, services, memfsIO)).rejects.toThrow();
    });

    it('должен принимать валидный ID', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      // Create a JSON task file
      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Test Task"}');

      await mdCommand(id, options, services, memfsIO);

      expect(logs.length).toBe(1);
      expect(logs[0]).toContain('# Title');
      expect(logs[0]).toContain('Test Task');
    });
  });

  describe('чтение задачи из storage', () => {
    it('должен выбрасывать ошибку если задача не найдена', async () => {
      const options: MdCommandOptions = {};

      await expect(mdCommand('999', options, services, memfsIO)).rejects.toThrow('не найдена');
    });

    it('должен читать задачу из JSON файла', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1","description":"Test"}');

      await mdCommand(id, options, services, memfsIO);

      expect(logs[0]).toContain('# Title');
      expect(logs[0]).toContain('Task 1');
      expect(logs[0]).toContain('# Description');
      expect(logs[0]).toContain('Test');
    });

    it('должен читать задачу из markdown файла', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.md`), '# Title\nTask 1\n# Description\nTest');

      await mdCommand(id, options, services, memfsIO);

      expect(logs[0]).toContain('# Title');
      expect(logs[0]).toContain('Task 1');
    });
  });

  describe('генерация markdown', () => {
    it('должен генерировать markdown с Dependencies из индекса', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      // Mock index to return dependencies
      services.index.load = vi.fn().mockResolvedValue({
        '1': { status: 'pending', dependencies: ['2', '3'] },
      });

      await mdCommand(id, options, services, memfsIO);

      expect(logs[0]).toContain('# Title');
      expect(logs[0]).toContain('Task 1');
      expect(logs[0]).toContain('# Dependencies');
      expect(logs[0]).toContain('2, 3');
    });

    it('должен генерировать markdown без Dependencies если их нет', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      // Mock index to return no dependencies
      services.index.load = vi.fn().mockResolvedValue({
        '1': { status: 'pending', dependencies: [] },
      });

      await mdCommand(id, options, services, memfsIO);

      expect(logs[0]).toContain('# Title');
      expect(logs[0]).toContain('Task 1');
      expect(logs[0]).not.toContain('# Dependencies');
    });

    it('должен генерировать markdown с кастомными полями', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(
        resolve(tasksDir, `${id}.json`),
        '{"title":"Task 1","priority":"high","tags":"urgent"}',
      );

      await mdCommand(id, options, services, memfsIO);

      expect(logs[0]).toContain('# Title');
      expect(logs[0]).toContain('Task 1');
      expect(logs[0]).toContain('# Priority');
      expect(logs[0]).toContain('high');
      expect(logs[0]).toContain('# Tags');
      expect(logs[0]).toContain('urgent');
    });
  });

  describe('вывод в файл', () => {
    it('должен записывать markdown в файл по умолчанию', async () => {
      const options: MdCommandOptions = {};
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      await mdCommand(id, options, services, memfsIO);

      const outputPath = resolve(tasksDir, `${id}.md`);
      const exists = vol.existsSync(outputPath);
      expect(exists).toBe(true);

      const content = vol.readFileSync(outputPath, 'utf-8') as string;
      expect(content).toContain('# Title');
      expect(content).toContain('Task 1');
      expect(logs.join('\n')).toContain('конвертирована');
    });

    it('должен использовать атомарную запись (temp файл + rename)', async () => {
      const options: MdCommandOptions = {};
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      await mdCommand(id, options, services, memfsIO);

      expect(memfsIO.rename).toHaveBeenCalledWith(
        expect.stringContaining('.md.tmp'),
        expect.stringContaining('.md'),
      );
    });

    it('должен использовать опцию --output для указания пути', async () => {
      const outputPath = '/custom/output.md';
      const options: MdCommandOptions = { output: outputPath };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      await mdCommand(id, options, services, memfsIO);

      const exists = vol.existsSync(outputPath);
      expect(exists).toBe(true);

      const content = vol.readFileSync(outputPath, 'utf-8') as string;
      expect(content).toContain('# Title');
      expect(content).toContain('Task 1');
    });

    it('должен создавать родительские директории для output', async () => {
      const outputPath = '/subdir/nested/task.md';
      const options: MdCommandOptions = { output: outputPath };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      await mdCommand(id, options, services, memfsIO);

      expect(memfsIO.mkdir).toHaveBeenCalledWith('/subdir/nested', { recursive: true });
      expect(vol.existsSync(outputPath)).toBe(true);
    });
  });

  describe('вывод в stdout', () => {
    it('должен выводить в stdout при опции --stdout', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      await mdCommand(id, options, services, memfsIO);

      expect(logs.length).toBe(1);
      expect(logs[0]).toContain('# Title');
      expect(logs[0]).toContain('Task 1');
    });

    it('при --stdout не должен создавать файл', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      await mdCommand(id, options, services, memfsIO);

      const outputPath = resolve(tasksDir, `${id}.md`);
      expect(vol.existsSync(outputPath)).toBe(false);
    });

    it('при --stdout и --output вместе, --stdout имеет приоритет', async () => {
      const options: MdCommandOptions = { stdout: true, output: '/custom.md' };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      await mdCommand(id, options, services, memfsIO);

      expect(logs.length).toBe(1);
      expect(logs[0]).toContain('# Title');
      expect(vol.existsSync('/custom.md')).toBe(false);
      expect(vol.existsSync(resolve(tasksDir, `${id}.md`))).toBe(false);
    });
  });

  describe('обработка ошибок', () => {
    it('должен выбрасывать ошибку при невалидном JSON (нет title)', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"description":"No title"}');

      await expect(mdCommand(id, options, services, memfsIO)).rejects.toThrow('title');
    });

    it('должен выбрасывать ошибку при пустом JSON объекте', async () => {
      const options: MdCommandOptions = { stdout: true };
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{}');

      await expect(mdCommand(id, options, services, memfsIO)).rejects.toThrow('title');
    });

    it('должен очищать временный файл при ошибке записи', async () => {
      const options: MdCommandOptions = {};
      const id = '1';

      const tasksDir = '/tasks';
      vol.mkdirSync(tasksDir, { recursive: true });
      vol.writeFileSync(resolve(tasksDir, `${id}.json`), '{"title":"Task 1"}');

      // Mock rename to fail after writeFile succeeds
      vi.mocked(memfsIO.rename).mockRejectedValue(new Error('Rename failed'));

      await expect(mdCommand(id, options, services, memfsIO)).rejects.toThrow('Rename failed');

      // Temp file should be cleaned up
      const tempPath = resolve(tasksDir, `${id}.md.tmp`);
      expect(vol.existsSync(tempPath)).toBe(false);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Services } from '../services.js';
import type { FileIO } from './migrate-types.js';
import { ParserService } from '../../parser/parser.js';
import { migrateCommand, type MigrateCommandOptions } from './migrate.js';
import { Volume } from 'memfs';

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

describe('migrate command', () => {
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
  });

  describe('файловые операции', () => {
    it('должен выбрасывать ошибку если файл не найден', async () => {
      const options: MigrateCommandOptions = {};

      await expect(migrateCommand('nonexistent.md', options, services, memfsIO)).rejects.toThrow(
        'Файл не найден',
      );
    });

    it('должен выбрасывать ошибку если файл не имеет расширение .md', async () => {
      const options: MigrateCommandOptions = {};

      const txtPath = '/task.txt';
      vol.writeFileSync(txtPath, '# Title\nTest Task');

      await expect(migrateCommand(txtPath, options, services, memfsIO)).rejects.toThrow(
        'Файл должен иметь расширение .md',
      );
    });

    it('должен выбрасывать ошибку если файл уже в формате JSON', async () => {
      const options: MigrateCommandOptions = {};

      const jsonPath = '/task.json';
      vol.writeFileSync(jsonPath, '{"title":"Test"}');

      await expect(migrateCommand(jsonPath, options, services, memfsIO)).rejects.toThrow(
        'Файл должен иметь расширение .md',
      );
    });

    it('должен конвертировать markdown в JSON', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      const mdContent = '# Title\nTest Task\n# Description\nTest Description';
      vol.writeFileSync(mdPath, mdContent);

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonPath = '/task.json';
      const exists = vol.existsSync(jsonPath);
      expect(exists).toBe(true);

      const jsonContent = vol.readFileSync(jsonPath, 'utf-8') as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed.title).toBe('Test Task');
      expect(parsed.description).toBe('Test Description');
      expect(logs.join('\n')).toContain('✓ Файл мигрирован');
    });

    it('должен использовать атомарную запись (temp файл + rename)', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTest Task');

      await migrateCommand(mdPath, options, services, memfsIO);

      // Verify rename was called
      expect(memfsIO.rename).toHaveBeenCalledWith(
        expect.stringContaining('.json.tmp'),
        expect.stringContaining('.json'),
      );

      // Temp file should not exist after successful rename
      const tempPath = '/task.json.tmp';
      expect(vol.existsSync(tempPath)).toBe(false);
    });

    it('должен использовать опцию --output для указания пути', async () => {
      const outputPath = '/custom-output.json';
      const options: MigrateCommandOptions = { output: outputPath };

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTest Task');

      await migrateCommand(mdPath, options, services, memfsIO);

      const exists = vol.existsSync(outputPath);
      expect(exists).toBe(true);

      const jsonContent = vol.readFileSync(outputPath, 'utf-8') as string;
      const parsed = JSON.parse(jsonContent);
      expect(parsed.title).toBe('Test Task');
    });

    it('должен создавать родительские директории для output', async () => {
      const outputPath = '/subdir/nested/task.json';
      const options: MigrateCommandOptions = { output: outputPath };

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTest Task');

      await migrateCommand(mdPath, options, services, memfsIO);

      // Verify mkdir was called for parent directory
      expect(memfsIO.mkdir).toHaveBeenCalledWith('/subdir/nested', { recursive: true });

      // File should exist
      const exists = vol.existsSync(outputPath);
      expect(exists).toBe(true);
    });

    it('должен выводить в stdout при опции --stdout', async () => {
      const options: MigrateCommandOptions = { stdout: true };

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTest Task\n# Priority\nhigh');

      await migrateCommand(mdPath, options, services, memfsIO);

      expect(logs.length).toBe(1);
      const output = logs[0];
      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed.title).toBe('Test Task');
      expect(parsed.priority).toBe('high');
    });

    it('при --stdout не должен создавать файл', async () => {
      const options: MigrateCommandOptions = { stdout: true };

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTest Task');

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonPath = '/task.json';
      const exists = vol.existsSync(jsonPath);
      expect(exists).toBe(false);
    });
  });

  describe('парсинг markdown', () => {
    it('должен парсить базовый markdown с Title', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nMy Task');

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonPath = '/task.json';
      const jsonContent = vol.readFileSync(jsonPath, 'utf-8') as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed.title).toBe('My Task');
    });

    it('должен парсить markdown с Description', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTask\n# Description\nLong description');

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonPath = '/task.json';
      const jsonContent = vol.readFileSync(jsonPath, 'utf-8') as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed.title).toBe('Task');
      expect(parsed.description).toBe('Long description');
    });

    it('должен парсить кастомные поля', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTask\n# Priority\nhigh\n# Tags\nurgent,important');

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonPath = '/task.json';
      const jsonContent = vol.readFileSync(jsonPath, 'utf-8') as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed.title).toBe('Task');
      expect(parsed.priority).toBe('high');
      expect(parsed.tags).toBe('urgent,important');
    });

    it('должен выбрасывать ошибку при невалидном markdown (нет Title)', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Description\nNo title here');

      await expect(migrateCommand(mdPath, options, services, memfsIO)).rejects.toThrow('Title');
    });

    it('должен выбрасывать ошибку при пустом markdown', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '');

      await expect(migrateCommand(mdPath, options, services, memfsIO)).rejects.toThrow();
    });

    it('должен выбрасывать ошибку при markdown с только пробелами', async () => {
      const options: MigrateCommandOptions = {};

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '   \n\n  ');

      await expect(migrateCommand(mdPath, options, services, memfsIO)).rejects.toThrow();
    });
  });

  describe('генерация JSON', () => {
    it('должен генерировать валидный JSON', async () => {
      const options: MigrateCommandOptions = { stdout: true };

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTest Task');

      await migrateCommand(mdPath, options, services, memfsIO);

      expect(() => JSON.parse(logs[0])).not.toThrow();
    });

    it('должен генерировать JSON с правильными отступами (2 пробела)', async () => {
      const options: MigrateCommandOptions = { stdout: true };

      const mdPath = '/task.md';
      vol.writeFileSync(mdPath, '# Title\nTest Task');

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonContent = logs[0];
      expect(jsonContent).toContain('  "title"'); // 2 spaces indentation
    });

    it('НЕ должен включать status и dependencies в JSON', async () => {
      const options: MigrateCommandOptions = { stdout: true };

      const mdPath = '/task.md';
      // Даже если в markdown есть Status/Dependencies
      vol.writeFileSync(mdPath, '# Title\nTest Task\n# Status\npending\n# Dependencies\n1,2');

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonContent = logs[0];
      const parsed = JSON.parse(jsonContent);

      expect(parsed).not.toHaveProperty('status');
      expect(parsed).not.toHaveProperty('dependencies');
    });
  });

  describe('обработка ошибок', () => {
    it('должен выбрасывать ошибку при проблемах с чтением файла (директория вместо файла)', async () => {
      const options: MigrateCommandOptions = {};

      // Create a directory
      vol.mkdirSync('/test-dir');

      await expect(migrateCommand('/test-dir.md', options, services, memfsIO)).rejects.toThrow();
    });

    it('должен очищать временный файл при ошибке записи', async () => {
      const options: MigrateCommandOptions = {};
      const mdPath = '/task.md';
      const mdContent = '# Title\nTest Task';
      vol.writeFileSync(mdPath, mdContent);

      // Mock rename to fail after writeFile succeeds
      vi.mocked(memfsIO.rename).mockRejectedValue(new Error('Rename failed'));

      await expect(migrateCommand(mdPath, options, services, memfsIO)).rejects.toThrow(
        'Rename failed',
      );

      // Temp file should be cleaned up
      const tempPath = '/task.json.tmp';
      expect(vol.existsSync(tempPath)).toBe(false);
    });
  });

  describe('ввод по ID задачи', () => {
    it('должен принимать ID задачи вместо пути к файлу', async () => {
      const options: MigrateCommandOptions = {};
      const taskId = '6';
      const mdContent = '# Title\nTest Task\n# Description\nTest Description';

      // Mock storage.read to return markdown content
      vi.mocked(services.storage.read).mockResolvedValue(mdContent);

      await migrateCommand(taskId, options, services, memfsIO);

      // Verify storage.read was called with the task ID
      expect(services.storage.read).toHaveBeenCalledWith(taskId);

      // Verify config was loaded to get tasksDir
      expect(services.config.load).toHaveBeenCalled();

      // The output should be in /tasks/6.json (from config.tasksDir)
      const jsonPath = '/tasks/6.json';
      const exists = vol.existsSync(jsonPath);
      expect(exists).toBe(true);

      const jsonContent = vol.readFileSync(jsonPath, 'utf-8') as string;
      const parsed = JSON.parse(jsonContent);

      expect(parsed.title).toBe('Test Task');
      expect(parsed.description).toBe('Test Description');
      expect(logs.join('\n')).toContain('✓ Файл мигрирован');
    });

    it('должен выбрасывать ошибку если задача с ID не найдена', async () => {
      const options: MigrateCommandOptions = {};
      const taskId = '999';

      // Mock storage.read to throw "не найден" error
      vi.mocked(services.storage.read).mockRejectedValue(new Error('Задача не найдена: 999'));

      await expect(migrateCommand(taskId, options, services, memfsIO)).rejects.toThrow(
        'Задача с ID "999" не найдена',
      );
    });

    it('должен выбрасывать ошибку если ID задачи имеет неверный формат (слишком длинный)', async () => {
      const options: MigrateCommandOptions = {};
      // Create an ID that looks like a task ID (digits.dots) but is too long (> 50 chars)
      const invalidId = '1.' + '1.'.repeat(25); // Creates a valid pattern but too long

      await expect(migrateCommand(invalidId, options, services, memfsIO)).rejects.toThrow(
        'ID задачи превышает максимальную длину',
      );
    });

    it('должен работать с подзадачами по ID', async () => {
      const options: MigrateCommandOptions = {};
      const taskId = '1.2';
      const mdContent = '# Title\nSubtask';

      // Mock storage.read to return markdown content
      vi.mocked(services.storage.read).mockResolvedValue(mdContent);

      await migrateCommand(taskId, options, services, memfsIO);

      // Verify storage.read was called with the task ID
      expect(services.storage.read).toHaveBeenCalledWith(taskId);

      // The output should be in /tasks/1.2.json
      const jsonPath = '/tasks/1.2.json';
      const exists = vol.existsSync(jsonPath);
      expect(exists).toBe(true);
    });

    it('должен выбрасывать ошибку если контент задачи уже в JSON', async () => {
      const options: MigrateCommandOptions = {};
      const taskId = '6';
      const jsonContent = '{"title":"Test"}';

      // Mock storage.read to return JSON content
      vi.mocked(services.storage.read).mockResolvedValue(jsonContent);

      await expect(migrateCommand(taskId, options, services, memfsIO)).rejects.toThrow(
        'Файл уже в формате JSON',
      );
    });

    it('с флагом --force должен перезаписывать JSON файл', async () => {
      const options: MigrateCommandOptions = { force: true };
      const taskId = '6';
      const jsonContent = '{"title":"Old Title"}';

      // Mock storage.read to return JSON content
      vi.mocked(services.storage.read).mockResolvedValue(jsonContent);

      await migrateCommand(taskId, options, services, memfsIO);

      // Verify the file was created/overwritten
      const jsonPath = '/tasks/6.json';
      const exists = vol.existsSync(jsonPath);
      expect(exists).toBe(true);

      const resultContent = vol.readFileSync(jsonPath, 'utf-8') as string;
      const parsed = JSON.parse(resultContent);
      expect(parsed.title).toBe('Old Title');
      expect(logs.join('\n')).toContain('✓ Файл мигрирован');
    });

    it('с флагом --force должен перезаписывать JSON файл из пути', async () => {
      const options: MigrateCommandOptions = { force: true };
      const mdPath = '/task.md';
      const jsonContent = '{"title":"Already JSON"}';

      vol.writeFileSync(mdPath, jsonContent);

      await migrateCommand(mdPath, options, services, memfsIO);

      const jsonPath = '/task.json';
      const exists = vol.existsSync(jsonPath);
      expect(exists).toBe(true);

      const resultContent = vol.readFileSync(jsonPath, 'utf-8') as string;
      const parsed = JSON.parse(resultContent);
      expect(parsed.title).toBe('Already JSON');
    });

    it('с флагом --force и --stdout должен выводить JSON даже если контент уже JSON', async () => {
      const options: MigrateCommandOptions = { force: true, stdout: true };
      const taskId = '6';
      const jsonContent = '{"title":"Test","description":"Desc"}';

      vi.mocked(services.storage.read).mockResolvedValue(jsonContent);

      await migrateCommand(taskId, options, services, memfsIO);

      expect(logs.length).toBe(1);
      const output = logs[0];
      const parsed = JSON.parse(output);
      expect(parsed.title).toBe('Test');
      expect(parsed.description).toBe('Desc');
    });

    it('должен выводить в stdout при использовании ID задачи с опцией --stdout', async () => {
      const options: MigrateCommandOptions = { stdout: true };
      const taskId = '6';
      const mdContent = '# Title\nTest Task\n# Priority\nhigh';

      // Mock storage.read to return markdown content
      vi.mocked(services.storage.read).mockResolvedValue(mdContent);

      await migrateCommand(taskId, options, services, memfsIO);

      expect(logs.length).toBe(1);
      const output = logs[0];
      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed.title).toBe('Test Task');
      expect(parsed.priority).toBe('high');

      // No file should be created when using stdout
      const jsonPath = '/tasks/6.json';
      expect(vol.existsSync(jsonPath)).toBe(false);
    });
  });
});

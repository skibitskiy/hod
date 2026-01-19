import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigServiceImpl } from './index.js';
import { ConfigLoadError, ConfigNotFoundError, ConfigValidationError } from './errors.js';
import type { Config } from './types.js';

describe('ConfigService', () => {
  let tempDir: string;
  let service: ConfigServiceImpl;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hod-test-'));
    service = new ConfigServiceImpl();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('load()', () => {
    it('должен загрузить конфиг из hod.config.yml', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
  Status:
    name: status
    default: pending
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      const config = await service.load(join(tempDir, 'hod.config.yml'));

      expect(config.tasksDir).toMatch(/\/tasks$/);
      expect(config.fields.Title).toEqual({ name: 'title', required: true });
      expect(config.fields.Status).toEqual({ name: 'status', default: 'pending' });
    });

    it('должен добавить description если его нет в конфиге', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      const config = await service.load(join(tempDir, 'hod.config.yml'));

      expect(config.fields.Description).toEqual({ name: 'description' });
    });

    it('должен выбросить ConfigNotFoundError если файл не найден (explicit path)', async () => {
      await expect(service.load(join(tempDir, 'nonexistent.yml'))).rejects.toThrow(
        ConfigNotFoundError,
      );
    });

    it('должен выбросить ConfigLoadError если YAML невалиден', async () => {
      const invalidYaml = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    invalid: [[[
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), invalidYaml);

      await expect(service.load(join(tempDir, 'hod.config.yml'))).rejects.toThrow(ConfigLoadError);
    });

    it('должен выбросить ConfigLoadError для пустого файла', async () => {
      writeFileSync(join(tempDir, 'hod.config.yml'), '');

      await expect(service.load(join(tempDir, 'hod.config.yml'))).rejects.toThrow(ConfigLoadError);
    });

    it('должен выбросить ConfigLoadError для файла с пробелами', async () => {
      writeFileSync(join(tempDir, 'hod.config.yml'), '   \n\n  ');

      await expect(service.load(join(tempDir, 'hod.config.yml'))).rejects.toThrow(ConfigLoadError);
    });
  });

  describe('validate()', () => {
    it('должен пройти валидацию с корректным конфигом', () => {
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          Title: { name: 'title', required: true },
          Description: { name: 'description' },
        },
      };

      expect(() => service.validate(config)).not.toThrow();
    });

    it('должен выбросить ошибку если tasksDir пустой', () => {
      const config: Config = {
        tasksDir: '',
        fields: {
          Title: { name: 'title', required: true },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку если fields пустой', () => {
      const config: Config = {
        tasksDir: './tasks',
        fields: {},
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку если markdown ключ содержит пробелы', () => {
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          'Invalid Key': { name: 'title', required: true },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку если markdown ключ содержит спецсимволы', () => {
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          'Invalid@Key': { name: 'title', required: true },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку если markdown ключ длиннее 50 символов', () => {
      const longKey = 'A'.repeat(51);
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          [longKey]: { name: 'title', required: true },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку если name содержит заглавные буквы', () => {
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          Title: { name: 'Title', required: true },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку если name содержит подчеркивания', () => {
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          Title: { name: 'title_name', required: true },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку если name длиннее 50 символов', () => {
      const longName = 'a'.repeat(51);
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          Title: { name: longName, required: true },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });

    it('должен выбросить ошибку для дубликатов name', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
  Alternative:
    name: title
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      await expect(service.load(join(tempDir, 'hod.config.yml'))).rejects.toThrow(
        ConfigValidationError,
      );
    });

    it('должен выбросить ошибку для неизвестных полей', () => {
      const config = {
        tasksDir: './tasks',
        fields: {
          Title: { name: 'title', required: true },
        },
        unknownField: 'value',
      };

      expect(() => service.validate(config as Config)).toThrow(ConfigValidationError);
    });
  });

  describe('разрешение путей', () => {
    it('должен разрешить относительный путь tasksDir относительно файла конфига', async () => {
      const subdir = join(tempDir, 'subdir');
      mkdirSync(subdir);
      const configContent = `
tasksDir: ../tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(subdir, 'hod.config.yml'), configContent);

      const config = await service.load(join(subdir, 'hod.config.yml'));

      expect(config.tasksDir).toEqual(join(tempDir, 'tasks'));
    });

    it('должен работать с абсолютным путем tasksDir', async () => {
      const absPath = join(tempDir, 'custom-tasks');
      const configContent = `
tasksDir: ${absPath}
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      const config = await service.load(join(tempDir, 'hod.config.yml'));

      expect(config.tasksDir).toEqual(absPath);
    });
  });

  describe('валидация противоречий (required + default)', () => {
    it('должен выбросить ошибку если required: true и default указаны вместе', () => {
      const config: Config = {
        tasksDir: './tasks',
        fields: {
          Title: { name: 'title', required: true, default: 'some default' },
        },
      };

      expect(() => service.validate(config)).toThrow(ConfigValidationError);
    });
  });

  describe('коллизия Description поля', () => {
    it('должен выбросить ошибку если Description имеет отличный от description name', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
  Description:
    name: summary
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      await expect(service.load(join(tempDir, 'hod.config.yml'))).rejects.toThrow(
        ConfigValidationError,
      );
    });
  });

  describe('path traversal защита', () => {
    it('должен выбросить ошибку для path traversal в /etc', async () => {
      const configContent = `
tasksDir: /etc
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      await expect(service.load(join(tempDir, 'hod.config.yml'))).rejects.toThrow(ConfigLoadError);
    });

    it('должен разрешить относительные пути внутри проекта', async () => {
      const subdir = join(tempDir, 'subdir');
      mkdirSync(subdir);
      const configContent = `
tasksDir: ../nested-tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(subdir, 'hod.config.yml'), configContent);

      const config = await service.load(join(subdir, 'hod.config.yml'));

      expect(config.tasksDir).toEqual(join(tempDir, 'nested-tasks'));
    });
  });

  describe('неизвестные поля в fieldConfig', () => {
    it('должен выбросить ошибку для неизвестных свойств в fieldConfig', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
    unknownProp: value
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      await expect(service.load(join(tempDir, 'hod.config.yml'))).rejects.toThrow(
        ConfigValidationError,
      );
    });
  });

  describe('поиск конфига вверх по дереву директорий', () => {
    it('должен найти конфиг в родительской директории', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      // Create a subdirectory and try to load from there
      const subdir = join(tempDir, 'deep', 'nested', 'dir');
      mkdirSync(subdir, { recursive: true });

      // Mock process.cwd() to simulate being in the subdirectory
      const originalCwd = process.cwd;
      process.cwd = () => subdir;

      try {
        const config = await service.load();
        expect(config.tasksDir).toEqual(join(tempDir, 'tasks'));
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('должен найти конфиг в текущей директории', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      try {
        const config = await service.load();
        expect(config.tasksDir).toEqual(join(tempDir, 'tasks'));
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('должен выбросить ConfigNotFoundError если конфиг не найден', async () => {
      const subdir = join(tempDir, 'nowhere');
      mkdirSync(subdir, { recursive: true });

      const originalCwd = process.cwd;
      process.cwd = () => subdir;

      try {
        await expect(service.load()).rejects.toThrow(ConfigNotFoundError);
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('должен остановиться на корневой директории', async () => {
      // Create a directory without config
      const rootlessDir = join(tempDir, 'rootless');
      mkdirSync(rootlessDir, { recursive: true });

      const originalCwd = process.cwd;
      process.cwd = () => rootlessDir;

      try {
        await expect(service.load()).rejects.toThrow(ConfigNotFoundError);
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('должен разрешить tasksDir относительно найденного конфига', async () => {
      const configContent = `
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), configContent);

      // Create a subdirectory
      const subdir = join(tempDir, 'subdir');
      mkdirSync(subdir, { recursive: true });

      const originalCwd = process.cwd;
      process.cwd = () => subdir;

      try {
        const config = await service.load();
        // tasksDir should be resolved relative to where hod.config.yml is (tempDir), not cwd
        expect(config.tasksDir).toEqual(join(tempDir, 'tasks'));
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('должен найти ближайший конфиг если их несколько', async () => {
      // Create config in root temp dir
      const rootConfigContent = `
tasksDir: ./root-tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(tempDir, 'hod.config.yml'), rootConfigContent);

      // Create a subdirectory with its own config
      const subdir = join(tempDir, 'subdir');
      mkdirSync(subdir, { recursive: true });

      const subConfigContent = `
tasksDir: ./sub-tasks
fields:
  Title:
    name: title
    required: true
`;
      writeFileSync(join(subdir, 'hod.config.yml'), subConfigContent);

      const originalCwd = process.cwd;
      process.cwd = () => subdir;

      try {
        const config = await service.load();
        // Should find the nearest config (in subdir)
        expect(config.tasksDir).toEqual(join(subdir, 'sub-tasks'));
      } finally {
        process.cwd = originalCwd;
      }
    });
  });
});

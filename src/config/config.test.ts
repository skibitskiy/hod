import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigServiceImpl } from './index.js';
import { ConfigLoadError, ConfigValidationError } from './errors.js';
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

    it('должен использовать дефолты если файл не найден', async () => {
      const config = await service.load(join(tempDir, 'nonexistent.yml'));

      expect(config.tasksDir).toMatch(/\/tasks$/);
      expect(config.fields.Title).toEqual({ name: 'title', required: true });
      expect(config.fields.Description).toEqual({ name: 'description' });
      expect(config.fields.Status).toEqual({ name: 'status', default: 'pending' });
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

    it('должен использовать дефолты для пустого файла', async () => {
      writeFileSync(join(tempDir, 'hod.config.yml'), '');

      const config = await service.load(join(tempDir, 'hod.config.yml'));

      expect(config.fields.Title).toEqual({ name: 'title', required: true });
    });

    it('должен использовать дефолты для файла с пробелами', async () => {
      writeFileSync(join(tempDir, 'hod.config.yml'), '   \n\n  ');

      const config = await service.load(join(tempDir, 'hod.config.yml'));

      expect(config.fields.Title).toEqual({ name: 'title', required: true });
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
});

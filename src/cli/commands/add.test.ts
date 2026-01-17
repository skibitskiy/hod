import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from '../../config/types.js';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { ParserService } from '../../parser/parser.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { addCommand, type AddCommandOptions } from './add.js';
import {
  collectFields,
  validateFieldNames,
  applyDefaults,
  validateRequired,
  generateMainTaskId,
  generateSubtaskId,
  validateParent,
  parseDependencies,
  fieldsToParsedTask,
} from './add.js';
import { CircularDependencyError } from '../../index/errors.js';
import { ParentValidationError } from '../errors.js';

interface NodeError extends Error {
  cause?: unknown;
}

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

describe('add command - helper functions (unit tests)', () => {
  describe('collectFields()', () => {
    it('должен собирать поля из аргументов согласно маппингу из config', () => {
      const args: AddCommandOptions = {
        title: 'Task title',
        description: 'Task description',
        priority: 'high',
      };

      const fields = collectFields(args, mockConfig);

      expect(fields).toEqual({
        Title: 'Task title',
        Description: 'Task description',
        Priority: 'high',
      });
    });

    it('должен trim пробелы из значений', () => {
      const args: AddCommandOptions = {
        title: '  Task title  ',
        description: ' Task description ',
      };

      const fields = collectFields(args, mockConfig);

      expect(fields.Title).toBe('Task title');
      expect(fields.Description).toBe('Task description');
    });

    it('должен игнорировать неизвестные аргументы', () => {
      const args: AddCommandOptions = {
        title: 'Task',
        unknownField: 'value',
      };

      const fields = collectFields(args, mockConfig);

      expect(fields.Title).toBe('Task');
      expect(fields.unknownField).toBeUndefined();
    });

    it('должен игнорировать undefined значения', () => {
      const args: AddCommandOptions = {
        title: 'Task',
        description: undefined,
      };

      const fields = collectFields(args, mockConfig);

      expect(fields.Title).toBe('Task');
      expect(fields.Description).toBeUndefined();
    });
  });

  describe('validateFieldNames()', () => {
    it('должен пропускать известные поля', () => {
      const args: AddCommandOptions = {
        title: 'Task',
        description: 'Desc',
        status: 'pending',
        priority: 'high',
      };

      // Should not throw
      expect(() => validateFieldNames(args, mockConfig)).not.toThrow();
    });

    it('должен пропускать dependencies (системное поле)', () => {
      const args: AddCommandOptions = {
        title: 'Task',
        dependencies: '1,2,3',
      };

      expect(() => validateFieldNames(args, mockConfig)).not.toThrow();
    });

    it('должен пропускать _ (позиционные аргументы commander.js)', () => {
      const args = {
        title: 'Task',
        _: ['positional'],
      } as unknown as AddCommandOptions;

      expect(() => validateFieldNames(args, mockConfig)).not.toThrow();
    });

    it('должен выбрасывать ошибку для неизвестного поля', () => {
      const args: AddCommandOptions = {
        title: 'Task',
        unknownField: 'value',
      };

      expect(() => validateFieldNames(args, mockConfig)).toThrow(
        'Неизвестное поле `unknownField`. Доступные поля: title, description, status, priority',
      );
    });

    it('должен показывать все доступные поля в сообщении об ошибке', () => {
      const args: AddCommandOptions = {
        badField: 'value',
      };

      expect(() => validateFieldNames(args, mockConfig)).toThrow(/Доступные поля:/);
    });
  });

  describe('applyDefaults()', () => {
    it('должен применять значения по умолчанию из config', () => {
      const fields: Record<string, string | undefined> = {
        Title: 'Task',
        Description: 'Description',
      };

      const result = applyDefaults(fields, mockConfig);

      expect(result).toEqual({
        Title: 'Task',
        Description: 'Description',
        Status: 'pending', // default applied
      });
    });

    it('не должен применять default если поле предоставлено', () => {
      const fields: Record<string, string | undefined> = {
        Title: 'Task',
        Status: 'in-progress',
      };

      const result = applyDefaults(fields, mockConfig);

      expect(result.Status).toBe('in-progress');
    });

    it('должен игнорировать пустые строки', () => {
      const fields: Record<string, string | undefined> = {
        Title: 'Task',
        Description: '',
      };

      const result = applyDefaults(fields, mockConfig);

      expect(result.Description).toBeUndefined();
      expect(result.Status).toBe('pending'); // default applied
    });

    it('должен включать только поля из config', () => {
      const fields: Record<string, string | undefined> = {
        Title: 'Task',
        ExtraField: 'value', // not in config
      };

      const result = applyDefaults(fields, mockConfig);

      expect(result.Title).toBe('Task');
      expect(result.ExtraField).toBeUndefined();
    });
  });

  describe('validateRequired()', () => {
    it('должен проверять обязательные поля', () => {
      const fields: Record<string, string> = {
        Title: 'Task',
        Status: 'pending',
      };

      // Should not throw
      expect(() => validateRequired(fields, mockConfig)).not.toThrow();
    });

    it('должен выбрасывать ошибку если обязательное поле отсутствует', () => {
      const fields: Record<string, string> = {
        Status: 'pending',
      };

      expect(() => validateRequired(fields, mockConfig)).toThrow(
        'Не указано обязательное поле \'Title\'. Используйте --title "Значение"',
      );
    });

    it('должен выбрасывать ошибку если обязательное поле - пустая строка', () => {
      const fields: Record<string, string> = {
        Title: '',
      };

      expect(() => validateRequired(fields, mockConfig)).toThrow();
    });
  });

  describe('parseDependencies()', () => {
    it('должен парсить зависимости из строки', () => {
      const deps = parseDependencies('1,2,3');
      expect(deps).toEqual(['1', '2', '3']);
    });

    it('должен возвращать пустой массив для пустой строки', () => {
      expect(parseDependencies('')).toEqual([]);
      expect(parseDependencies('   ')).toEqual([]);
    });

    it('должен возвращать пустой массив для undefined', () => {
      expect(parseDependencies(undefined)).toEqual([]);
    });

    it('должен trim пробелы', () => {
      const deps = parseDependencies('1, 2, 3');
      expect(deps).toEqual(['1', '2', '3']);
    });

    it('должен фильтровать пустые элементы', () => {
      const deps = parseDependencies('1,,2,  ,3');
      expect(deps).toEqual(['1', '2', '3']);
    });
  });

  describe('fieldsToParsedTask()', () => {
    it('должен конвертировать поля в ParsedTask', () => {
      const fields: Record<string, string> = {
        Title: 'My Task',
        Description: 'Task description',
        Status: 'in-progress',
      };

      const task = fieldsToParsedTask(fields);

      expect(task.title).toBe('My Task');
      expect(task.description).toBe('Task description');
      // Status теперь только в индексе, не в JSON файле
      expect(task.status).toBeUndefined();
    });

    it('должен добавлять кастомные поля', () => {
      const fields: Record<string, string> = {
        Title: 'Task',
        Priority: 'high',
        Tags: 'urgent,important',
      };

      const task = fieldsToParsedTask(fields);

      // Custom fields теперь lowercase для совместимости с parser
      expect(task.priority).toBe('high');
      expect(task.tags).toBe('urgent,important');
    });

    it('должен выбрасывать ошибку если значение кастомного поля не строка', () => {
      const fields = {
        Title: 'Task',
        Count: 42,
      } as unknown as Record<string, string>;

      expect(() => fieldsToParsedTask(fields)).toThrow('Невалидное значение для поля');
    });
  });

  describe('generateMainTaskId()', () => {
    it('должен генерировать "1" для пустого хранилища', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([]),
      } as unknown as StorageService;

      const id = await generateMainTaskId(storage);
      expect(id).toBe('1');
    });

    it('должен генерировать следующий ID после существующих', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: '1', content: '' },
          { id: '2', content: '' },
          { id: '3', content: '' },
        ]),
      } as unknown as StorageService;

      const id = await generateMainTaskId(storage);
      expect(id).toBe('4');
    });

    it('должен игнорировать подзадачи при генерации ID', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: '1', content: '' },
          { id: '1.1', content: '' },
          { id: '1.2', content: '' },
          { id: '2', content: '' },
        ]),
      } as unknown as StorageService;

      const id = await generateMainTaskId(storage);
      expect(id).toBe('3');
    });

    it('должен находить max ID при пропусках', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: '1', content: '' },
          { id: '3', content: '' },
          { id: '5', content: '' },
        ]),
      } as unknown as StorageService;

      const id = await generateMainTaskId(storage);
      expect(id).toBe('6');
    });

    it('должен обрабатывать невалидные ID в storage (защита от NaN)', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: 'abc', content: '' },
          { id: '1', content: '' },
        ]),
      } as unknown as StorageService;

      const id = await generateMainTaskId(storage);
      // "abc" is filtered out as invalid (NaN), only "1" is considered
      expect(id).toBe('2');
    });

    it('должен игнорировать невалидные ID при вычислении max', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: '1', content: '' },
          { id: '2', content: '' },
          { id: 'invalid', content: '' },
        ]),
      } as unknown as StorageService;

      const id = await generateMainTaskId(storage);
      // "invalid" is filtered out, max of [1, 2] is 2, so next is 3
      expect(id).toBe('3');
    });
  });

  describe('generateSubtaskId()', () => {
    it('должен генерировать "1.1" для первой подзадачи', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([{ id: '1', content: '' }]),
        read: vi.fn().mockRejectedValue(new StorageNotFoundError('Not found')),
      } as unknown as StorageService;

      const id = await generateSubtaskId('1', storage);
      expect(id).toBe('1.1');
    });

    it('должен генерировать "1.2" если 1.1 существует', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: '1', content: '' },
          { id: '1.1', content: '' },
        ]),
        read: vi.fn().mockImplementation((id: string) => {
          if (id === '1.1') return Promise.resolve({ content: '' });
          return Promise.reject(new StorageNotFoundError('Not found'));
        }),
      } as unknown as StorageService;

      const id = await generateSubtaskId('1', storage);
      expect(id).toBe('1.2');
    });

    it('должен находить max номер подзадачи', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: '1', content: '' },
          { id: '1.1', content: '' },
          { id: '1.5', content: '' },
          { id: '1.2', content: '' },
        ]),
        read: vi.fn().mockImplementation((id: string) => {
          if (['1.1', '1.2', '1.5'].includes(id)) return Promise.resolve({ content: '' });
          return Promise.reject(new StorageNotFoundError('Not found'));
        }),
      } as unknown as StorageService;

      const id = await generateSubtaskId('1', storage);
      expect(id).toBe('1.6');
    });

    it('должен фильтровать только прямые потомки', async () => {
      const storage = {
        list: vi.fn().mockResolvedValue([
          { id: '1', content: '' },
          { id: '1.1', content: '' },
          { id: '1.1.1', content: '' }, // should be ignored
          { id: '1.2', content: '' },
        ]),
        read: vi.fn().mockImplementation((id: string) => {
          if (['1.1', '1.1.1', '1.2'].includes(id)) return Promise.resolve({ content: '' });
          return Promise.reject(new StorageNotFoundError('Not found'));
        }),
      } as unknown as StorageService;

      const id = await generateSubtaskId('1', storage);
      // Should consider only 1.1 and 1.2, not 1.1.1
      expect(id).toBe('1.3');
    });

    it('должен выбрасывать ошибку если ID превышает 50 символов', async () => {
      // Create a parent ID that's 49 characters (one character short of max)
      const longParent = '1.' + '123456789'.repeat(5) + '1234'; // 49 chars

      const storage = {
        list: vi.fn().mockResolvedValue([{ id: longParent, content: '' }]),
        read: vi.fn().mockRejectedValue(new StorageNotFoundError('Not found')),
      } as unknown as StorageService;

      // Adding ".1" would make it 51 characters (over the limit)
      await expect(generateSubtaskId(longParent, storage)).rejects.toThrow(
        'превышает максимальную длину 50 символов',
      );
    });
  });

  describe('validateParent()', () => {
    it('должен выбрасывать ошибку для пустого parent', async () => {
      const storage = {
        read: vi.fn(),
      } as unknown as StorageService;

      await expect(validateParent('', storage)).rejects.toThrow(ParentValidationError);
      await expect(validateParent('   ', storage)).rejects.toThrow('не может быть пустым');
    });

    it('должен выбрасывать ошибку для невалидного формата', async () => {
      const storage = {
        read: vi.fn(),
      } as unknown as StorageService;

      await expect(validateParent('abc', storage)).rejects.toThrow('Неверный формат ID');
    });

    it('должен выбрасывать ошибку если parent является подзадачей', async () => {
      const storage = {
        read: vi.fn().mockResolvedValue({ content: '' }),
      } as unknown as StorageService;

      await expect(validateParent('1.1', storage)).rejects.toThrow('является подзадачей');
    });

    it('должен выбрасывать ошибку если parent не существует', async () => {
      const storage = {
        read: vi.fn().mockRejectedValue(new StorageNotFoundError('Task not found')),
      } as unknown as StorageService;

      await expect(validateParent('99', storage)).rejects.toThrow(ParentValidationError);
      await expect(validateParent('99', storage)).rejects.toThrow('не существует');
    });

    it('должен проходить валидацию для существующей main задачи', async () => {
      const storage = {
        read: vi.fn().mockResolvedValue({ content: '' }),
      } as unknown as StorageService;

      await expect(validateParent('1', storage)).resolves.not.toThrow();
    });
  });
});

describe('add command (integration with mocked services)', () => {
  let services: Services;

  beforeEach(() => {
    services = createMockServices();
  });

  it('должен создать задачу с минимальными полями', async () => {
    const options: AddCommandOptions = {
      title: 'Test task',
    };

    const id = await addCommand(options, services);

    expect(id).toBe('1');
    expect(services.storage.create).toHaveBeenCalledOnce();
    expect(services.index.update).toHaveBeenCalledWith('1', {
      status: 'pending',
      dependencies: [],
    });
  });

  it('должен создавать задачу с зависимостями', async () => {
    const options: AddCommandOptions = {
      title: 'Task with deps',
      dependencies: '1,2,3',
    };

    const id = await addCommand(options, services);

    expect(id).toBe('1');
    expect(services.index.update).toHaveBeenCalledWith('1', {
      status: 'pending',
      dependencies: ['1', '2', '3'],
    });
  });

  it('должен применять дефолтные значения', async () => {
    const options: AddCommandOptions = {
      title: 'Task',
    };

    await addCommand(options, services);

    const callArgs = (services.storage.create as ReturnType<typeof vi.fn>).mock.calls[0];
    const jsonContent = callArgs[1] as string;
    const parsed = JSON.parse(jsonContent);

    // Status пишется только в index, не в JSON
    expect(parsed.title).toBe('Task');
    expect(parsed.status).toBeUndefined();
  });

  it('должен выбрасывать ошибку для неизвестного поля', async () => {
    const options: AddCommandOptions = {
      title: 'Task',
      unknown: 'field',
    };

    await expect(addCommand(options, services)).rejects.toThrow('Неизвестное поле');
  });

  it('должен выбрасывать ошибку если отсутствует обязательное поле', async () => {
    const options: AddCommandOptions = {};

    await expect(addCommand(options, services)).rejects.toThrow('Не указано обязательное поле');
  });

  it('должен делать rollback при ошибке индекса', async () => {
    const options: AddCommandOptions = {
      title: 'Task',
      dependencies: '1',
    };

    const errorServices = createMockServices({
      index: {
        load: vi.fn().mockResolvedValue({}),
        update: vi
          .fn()
          .mockRejectedValue(new CircularDependencyError('Cycle detected', ['1', '1'])),
        remove: vi.fn().mockResolvedValue(undefined),
        rebuild: vi.fn().mockResolvedValue(undefined),
        getNextTasks: vi.fn().mockReturnValue([]),
      } as unknown as IndexService,
    });

    await expect(addCommand(options, errorServices)).rejects.toThrow(CircularDependencyError);
    expect(errorServices.storage.delete).toHaveBeenCalledWith('1');
  });

  it('должен trim значения полей', async () => {
    const options: AddCommandOptions = {
      title: '  Task  ',
      description: ' Description ',
    };

    await addCommand(options, services);

    const callArgs = (services.storage.create as ReturnType<typeof vi.fn>).mock.calls[0];
    const jsonContent = callArgs[1] as string;
    const parsed = JSON.parse(jsonContent);

    expect(parsed.title).toBe('Task');
    expect(parsed.description).toBe('Description');
  });

  it('должен логировать предупреждение при ошибке rollback', async () => {
    const options: AddCommandOptions = {
      title: 'Task',
      dependencies: '1',
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const errorServices = createMockServices({
      index: {
        load: vi.fn().mockResolvedValue({}),
        update: vi
          .fn()
          .mockRejectedValue(new CircularDependencyError('Cycle detected', ['1', '1'])),
        remove: vi.fn().mockResolvedValue(undefined),
        rebuild: vi.fn().mockResolvedValue(undefined),
        getNextTasks: vi.fn().mockReturnValue([]),
      } as unknown as IndexService,
      storage: {
        create: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockRejectedValue(new Error('Rollback failed')),
      } as unknown as StorageService,
    });

    await expect(addCommand(options, errorServices)).rejects.toThrow(CircularDependencyError);
    expect(warnSpy).toHaveBeenCalledWith(
      'Предупреждение: не удалось откатить создание задачи 1: Rollback failed',
    );

    warnSpy.mockRestore();
  });

  it('должен прикреплять rollback ошибку к cause цепочке', async () => {
    const options: AddCommandOptions = {
      title: 'Task',
      dependencies: '1',
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const rollbackError = new Error('Rollback failed');
    const indexError = new CircularDependencyError('Cycle detected', ['1', '1']);

    const errorServices = createMockServices({
      index: {
        load: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockRejectedValue(indexError),
        remove: vi.fn().mockResolvedValue(undefined),
        rebuild: vi.fn().mockResolvedValue(undefined),
        getNextTasks: vi.fn().mockReturnValue([]),
      } as unknown as IndexService,
      storage: {
        create: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockRejectedValue(rollbackError),
      } as unknown as StorageService,
    });

    let caughtError: Error | undefined;
    try {
      await addCommand(options, errorServices);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toBe(indexError);
    expect((caughtError as NodeError).cause).toBe(rollbackError);

    warnSpy.mockRestore();
  });
});

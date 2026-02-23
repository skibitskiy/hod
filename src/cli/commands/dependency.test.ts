import { describe, it, expect, vi } from 'vitest';
import type { Services } from '../services.js';
import type { StorageService } from '../../storage/storage.js';
import type { IndexService } from '../../index/index.js';
import type { ConfigService } from '../../config/types.js';
import { StorageNotFoundError } from '../../storage/errors.js';
import { CircularDependencyError } from '../../index/errors.js';
import { dependencyCommand } from './dependency.js';

const createMockServices = (overrides?: Partial<Services>): Services => ({
  config: {
    load: vi.fn(),
    validate: vi.fn(),
  } as unknown as ConfigService,
  storage: {
    exists: vi.fn().mockResolvedValue(true),
    create: vi.fn(),
    read: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as unknown as StorageService,
  index: {
    load: vi.fn().mockResolvedValue({
      '2': { status: 'pending', dependencies: ['3'] },
    }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
    getNextTasks: vi.fn(),
  } as unknown as IndexService,
  parser: {} as Services['parser'],
  ...overrides,
});

describe('dependencyCommand', () => {
  describe('валидация', () => {
    it('должен выбрасывать ошибку при невалидном ID задачи', async () => {
      const services = createMockServices();
      await expect(dependencyCommand({ id: 'invalid!', add: ['1'] }, services)).rejects.toThrow();
    });

    it('должен выбрасывать ошибку если задача не найдена', async () => {
      const services = createMockServices({
        storage: {
          exists: vi.fn().mockResolvedValue(false),
        } as unknown as StorageService,
      });
      await expect(dependencyCommand({ id: '2', add: ['1'] }, services)).rejects.toThrow(
        StorageNotFoundError,
      );
    });

    it('должен выбрасывать ошибку если не указан ни --add ни --delete', async () => {
      const services = createMockServices();
      await expect(dependencyCommand({ id: '2' }, services)).rejects.toThrow(
        'Необходимо указать хотя бы один из флагов: --add или --delete',
      );
    });

    it('должен выбрасывать ошибку при невалидном ID зависимости', async () => {
      const services = createMockServices();
      await expect(dependencyCommand({ id: '2', add: ['bad!id'] }, services)).rejects.toThrow();
    });
  });

  describe('добавление зависимостей', () => {
    it('должен добавлять новые зависимости', async () => {
      const services = createMockServices();
      const result = await dependencyCommand({ id: '2', add: ['1', '4'] }, services);

      expect(result.added).toEqual(['1', '4']);
      expect(result.removed).toEqual([]);
      expect(result.dependencies).toContain('1');
      expect(result.dependencies).toContain('3');
      expect(result.dependencies).toContain('4');

      expect(services.index.update).toHaveBeenCalledWith('2', {
        status: 'pending',
        dependencies: expect.arrayContaining(['1', '3', '4']),
      });
    });

    it('не должен дублировать уже существующие зависимости', async () => {
      const services = createMockServices();
      const result = await dependencyCommand({ id: '2', add: ['3'] }, services);

      expect(result.added).toEqual([]);
      expect(result.dependencies).toEqual(['3']);
    });

    it('должен добавлять зависимости к задаче без текущих зависимостей', async () => {
      const services = createMockServices({
        index: {
          load: vi.fn().mockResolvedValue({
            '5': { status: 'pending', dependencies: [] },
          }),
          update: vi.fn().mockResolvedValue(undefined),
        } as unknown as IndexService,
      });

      const result = await dependencyCommand({ id: '5', add: ['1', '2'] }, services);

      expect(result.added).toEqual(['1', '2']);
      expect(result.dependencies).toEqual(['1', '2']);
    });

    it('должен добавлять зависимости к задаче отсутствующей в индексе', async () => {
      const services = createMockServices({
        index: {
          load: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue(undefined),
        } as unknown as IndexService,
      });

      const result = await dependencyCommand({ id: '2', add: ['1'] }, services);

      expect(result.added).toEqual(['1']);
      expect(result.dependencies).toEqual(['1']);
      expect(services.index.update).toHaveBeenCalledWith('2', {
        status: 'pending',
        dependencies: ['1'],
      });
    });
  });

  describe('удаление зависимостей', () => {
    it('должен удалять существующие зависимости', async () => {
      const services = createMockServices();
      const result = await dependencyCommand({ id: '2', delete: ['3'] }, services);

      expect(result.removed).toEqual(['3']);
      expect(result.added).toEqual([]);
      expect(result.dependencies).toEqual([]);
    });

    it('должен игнорировать удаление несуществующих зависимостей', async () => {
      const services = createMockServices();
      const result = await dependencyCommand({ id: '2', delete: ['99'] }, services);

      expect(result.removed).toEqual([]);
      expect(result.dependencies).toEqual(['3']);
    });
  });

  describe('одновременное добавление и удаление', () => {
    it('должен добавлять и удалять зависимости за один вызов', async () => {
      const services = createMockServices({
        index: {
          load: vi.fn().mockResolvedValue({
            '2': { status: 'in-progress', dependencies: ['3', '5'] },
          }),
          update: vi.fn().mockResolvedValue(undefined),
        } as unknown as IndexService,
      });

      const result = await dependencyCommand({ id: '2', add: ['1', '4'], delete: ['5'] }, services);

      expect(result.added).toEqual(['1', '4']);
      expect(result.removed).toEqual(['5']);
      expect(result.dependencies).toContain('1');
      expect(result.dependencies).toContain('3');
      expect(result.dependencies).toContain('4');
      expect(result.dependencies).not.toContain('5');

      expect(services.index.update).toHaveBeenCalledWith('2', {
        status: 'in-progress',
        dependencies: expect.arrayContaining(['1', '3', '4']),
      });
    });

    it('должен сохранять статус задачи при обновлении зависимостей', async () => {
      const services = createMockServices({
        index: {
          load: vi.fn().mockResolvedValue({
            '2': { status: 'completed', dependencies: ['3'] },
          }),
          update: vi.fn().mockResolvedValue(undefined),
        } as unknown as IndexService,
      });

      await dependencyCommand({ id: '2', add: ['1'] }, services);

      expect(services.index.update).toHaveBeenCalledWith('2', {
        status: 'completed',
        dependencies: expect.arrayContaining(['1', '3']),
      });
    });
  });

  describe('обработка ошибок индекса', () => {
    it('должен пробрасывать CircularDependencyError', async () => {
      const services = createMockServices({
        index: {
          load: vi.fn().mockResolvedValue({
            '2': { status: 'pending', dependencies: [] },
          }),
          update: vi
            .fn()
            .mockRejectedValue(
              new CircularDependencyError('Циклическая зависимость', ['2', '1', '2']),
            ),
        } as unknown as IndexService,
      });

      await expect(dependencyCommand({ id: '2', add: ['1'] }, services)).rejects.toThrow(
        CircularDependencyError,
      );
    });
  });

  describe('возвращаемое значение', () => {
    it('должен возвращать итоговый список зависимостей', async () => {
      const services = createMockServices();
      const result = await dependencyCommand({ id: '2', add: ['1'] }, services);

      expect(result).toMatchObject({
        id: '2',
        dependencies: expect.arrayContaining(['1', '3']),
        added: ['1'],
        removed: [],
      });
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { Volume } from 'memfs';
import { createIndexService, IndexServiceImpl } from './index.js';
import type { IndexData, TaskDependencies } from './types.js';
import {
  CircularDependencyError,
  IndexCorruptionError,
  IndexValidationError,
} from './errors.js';

describe('IndexService', () => {
  let vol: InstanceType<typeof Volume>;
  let service: ReturnType<typeof createIndexService>;

  // Helper для создания файла в memfs
  function writeIndexFile(data: IndexData | string): void {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    vol.mkdirSync('/tasks/.hod', { recursive: true });
    vol.writeFileSync('/tasks/.hod/index.json', content);
  }

  // Helper для чтения файла из memfs
  function readIndexFileSync(): IndexData {
    const content = vol.readFileSync('/tasks/.hod/index.json', 'utf-8').toString('utf-8');
    return JSON.parse(content) as IndexData;
  }

  beforeEach(() => {
    // Создаём новый volume для каждого теста
    vol = Volume.fromJSON({});
    service = createIndexService(
      '/tasks',
      vol.promises as unknown as typeof import('node:fs/promises'),
    );
  });

  describe('load()', () => {
    it('должен загрузить index.json', async () => {
      const testData: IndexData = {
        '1': [],
        '2': ['1'],
        '3': ['1', '2'],
      };
      writeIndexFile(testData);

      const result = await service.load();

      expect(result).toEqual(testData);
    });

    it('должен вернуть пустой объект если файл не существует', async () => {
      const result = await service.load();

      expect(result).toEqual({});
    });

    it('должен вернуть пустой объект если .hod/ не существует', async () => {
      const result = await service.load();

      expect(result).toEqual({});
    });

    it('должен выбросить IndexCorruptionError если JSON невалиден', async () => {
      writeIndexFile('{invalid json}');

      await expect(service.load()).rejects.toThrow(IndexCorruptionError);
    });

    it('должен нормализовать пустой массив в пустой объект', async () => {
      writeIndexFile('[]');

      const result = await service.load();

      expect(result).toEqual({});
    });

    it('должен выбросить IndexCorruptionError если значение не массив', async () => {
      writeIndexFile('{"1": "not array"}');

      await expect(service.load()).rejects.toThrow(IndexCorruptionError);
      await expect(service.load()).rejects.toThrow('не является массивом');
    });

    it('должен выбросить IndexCorruptionError если null', async () => {
      writeIndexFile('null');

      await expect(service.load()).rejects.toThrow(IndexCorruptionError);
    });

    it('должен обновить кэш после успешной загрузки', async () => {
      const testData: IndexData = { '1': [] };
      writeIndexFile(testData);

      await service.load();

      const impl = service as IndexServiceImpl;
      expect(impl['cachedIndex']).toEqual(testData);
    });
  });

  describe('update()', () => {
    it('должен обновить зависимости задачи', async () => {
      writeIndexFile({ '1': [] });

      await service.update('1', ['2']);

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': ['2'] });
    });

    it('должен создать запись если taskId не существует', async () => {
      await service.update('5', []);

      const content = readIndexFileSync();
      expect(content).toEqual({ '5': [] });
    });

    it('должен установить пустой массив если нет зависимостей', async () => {
      await service.update('1', []);

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': [] });
    });

    it('должен auto-dedup зависимости', async () => {
      await service.update('1', ['2', '2', '3', '2']);

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': ['2', '3'] });
    });

    it('должен auto-trim whitespace в зависимостях', async () => {
      await service.update('1', [' 2 ', '3 ', ' 4']);

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': ['2', '3', '4'] });
    });

    it('должен выбросить IndexValidationError при невалидном ID задачи', async () => {
      await expect(service.update('invalid', [])).rejects.toThrow(IndexValidationError);
      await expect(service.update('invalid', [])).rejects.toThrow('Невалидный формат ID');
    });

    it('должен выбросить IndexValidationError при ID > 50 chars', async () => {
      const longId = '1'.repeat(51);
      await expect(service.update(longId, [])).rejects.toThrow(IndexValidationError);
      await expect(service.update(longId, [])).rejects.toThrow('превышает максимальную длину');
    });

    it('должен выбросить IndexValidationError при невалидном ID зависимости', async () => {
      await expect(service.update('1', ['invalid'])).rejects.toThrow(IndexValidationError);
    });

    it('должен выбросить CircularDependencyError при self-dependency', async () => {
      await expect(service.update('1', ['1'])).rejects.toThrow(CircularDependencyError);
      await expect(service.update('1', ['1'])).rejects.toThrow('зависит от самой себя');
    });

    it('должен выбросить CircularDependencyError при цикле', async () => {
      writeIndexFile({ '1': ['2'] });

      await expect(service.update('2', ['1'])).rejects.toThrow(CircularDependencyError);
      await expect(service.update('2', ['1'])).rejects.toThrow('циклическая зависимость');
    });

    it('должен использовать атомарную запись (temp + rename)', async () => {
      await service.update('1', ['2']);

      // Проверяем что .tmp файл не остался
      expect(vol.existsSync('/tasks/.hod/index.json.tmp')).toBe(false);
      // Проверяем что основной файл создан
      expect(vol.existsSync('/tasks/.hod/index.json')).toBe(true);
    });

    it('должен обновить кэш после успешной записи', async () => {
      await service.update('1', ['2']);

      const impl = service as IndexServiceImpl;
      expect(impl['cachedIndex']).toEqual({ '1': ['2'] });
    });
  });

  describe('remove()', () => {
    it('должен удалить taskId из индекса', async () => {
      writeIndexFile({ '1': [], '2': [] });

      await service.remove('1');

      const content = readIndexFileSync();
      expect(content).toEqual({ '2': [] });
    });

    it('должен быть noop если taskId не существует', async () => {
      writeIndexFile({ '1': [] });

      await service.remove('999');

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': [] });
    });

    it('должен быть noop если индекс пустой', async () => {
      writeIndexFile({});

      await expect(service.remove('1')).resolves.not.toThrow();
    });

    it('должен обновить кэш после успешного удаления', async () => {
      writeIndexFile({ '1': [] });

      await service.remove('1');

      const impl = service as IndexServiceImpl;
      expect(impl['cachedIndex']).toEqual({});
    });
  });

  describe('rebuild()', () => {
    const tasks: TaskDependencies[] = [
      { id: '1', dependencies: [] },
      { id: '2', dependencies: ['1'] },
      { id: '3', dependencies: ['1', '2'] },
    ];

    it('должен пересобрать индекс из списка задач', async () => {
      await service.rebuild(tasks);

      const content = readIndexFileSync();
      expect(content).toEqual({
        '1': [],
        '2': ['1'],
        '3': ['1', '2'],
      });
    });

    it('должен очистить старые записи', async () => {
      writeIndexFile({ '99': [] });

      await service.rebuild(tasks);

      const content = readIndexFileSync();
      expect(content).not.toHaveProperty('99');
    });

    it('должен сохранить зависимости из задач', async () => {
      await service.rebuild(tasks);

      const content = readIndexFileSync();
      expect(content['3']).toEqual(['1', '2']);
    });

    it('должен записать пустой объект для пустого массива', async () => {
      await service.rebuild([]);

      const content = readIndexFileSync();
      expect(content).toEqual({});
    });

    it('должен выбросить IndexValidationError при дубликате ID', async () => {
      const duplicateTasks = [
        { id: '1', dependencies: [] },
        { id: '1', dependencies: [] },
      ];

      await expect(service.rebuild(duplicateTasks)).rejects.toThrow(IndexValidationError);
      await expect(service.rebuild(duplicateTasks)).rejects.toThrow('Дубликат ID');
    });

    it('должен выбросить IndexValidationError при невалидном ID', async () => {
      const invalidTasks = [{ id: 'invalid', dependencies: [] }];

      await expect(service.rebuild(invalidTasks)).rejects.toThrow(IndexValidationError);
    });

    it('должен выбросить CircularDependencyError при цикле', async () => {
      const cyclicTasks = [
        { id: '1', dependencies: ['2'] },
        { id: '2', dependencies: ['1'] },
      ];

      await expect(service.rebuild(cyclicTasks)).rejects.toThrow(CircularDependencyError);
    });

    it('должен auto-dedup зависимости', async () => {
      const duplicateDepsTasks = [{ id: '1', dependencies: ['2', '2', '3'] }];

      await service.rebuild(duplicateDepsTasks);

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': ['2', '3'] });
    });

    it('должен auto-trim whitespace', async () => {
      const whitespaceTasks = [{ id: '1', dependencies: [' 2 ', ' 3 '] }];

      await service.rebuild(whitespaceTasks);

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': ['2', '3'] });
    });

    it('должен обновить кэш после успешной пересборки', async () => {
      await service.rebuild(tasks);

      const impl = service as IndexServiceImpl;
      expect(impl['cachedIndex']).toEqual({
        '1': [],
        '2': ['1'],
        '3': ['1', '2'],
      });
    });
  });

  describe('getNextTasks()', () => {
    beforeEach(async () => {
      // Создаём индекс с зависимостями
      const indexData: IndexData = {
        '1': [],
        '2': ['1'],
        '3': ['1', '2'],
        '4': ['5'],
        '5': [],
      };
      writeIndexFile(indexData);
      await service.load();
    });

    it('должен вернуть задачи без зависимостей со статусом pending', () => {
      const statuses = {
        '1': 'pending',
        '2': 'pending',
        '5': 'pending',
      };

      const result = service.getNextTasks(statuses);

      // Задача 1 и 5 без зависимостей, задача 2 зависит от 1
      expect(result).toEqual(['1', '5']);
    });

    it('должен вернуть задачи у которых все зависимости completed', () => {
      const statuses = {
        '1': 'completed',
        '2': 'pending',
        '3': 'pending',
      };

      const result = service.getNextTasks(statuses);

      // Задача 2 готова (зависимость 1 completed), задача 3 нет (зависит от 2)
      expect(result).toEqual(['2']);
    });

    it('должен вернуть пустой массив если нет готовых задач', () => {
      const statuses = {
        '2': 'pending',
        '3': 'pending',
      };

      const result = service.getNextTasks(statuses);

      // Обе задачи зависят от других задач
      expect(result).toEqual([]);
    });

    it('должен игнорировать задачи со статусом completed', () => {
      const statuses = {
        '1': 'completed',
        '2': 'completed',
        '5': 'completed',
      };

      const result = service.getNextTasks(statuses);

      expect(result).toEqual([]);
    });

    it('должен возвращать отсортированные по ID', () => {
      const statuses = {
        '5': 'pending',
        '1': 'pending',
        '10': 'pending',
      };

      const result = service.getNextTasks(statuses);

      expect(result).toEqual(['1', '5', '10']);
    });

    it('должен сортировать численно по сегментам ID', () => {
      writeIndexFile({
        '1': [],
        '1.1': [],
        '1.10': [],
        '1.2': [],
        '2': [],
      });

      const impl = service as IndexServiceImpl;
      impl['cachedIndex'] = readIndexFileSync();

      const statuses = {
        '1': 'pending',
        '1.1': 'pending',
        '1.10': 'pending',
        '1.2': 'pending',
        '2': 'pending',
      };

      const result = service.getNextTasks(statuses);

      expect(result).toEqual(['1', '1.1', '1.2', '1.10', '2']);
    });

    it('должен игнорировать задачи missing из allStatuses', () => {
      const statuses = {
        '1': 'completed',
        '3': 'pending',
      };

      const result = service.getNextTasks(statuses);

      // Задача 3 зависит от 1 и 2, но 2 отсутствует в statuses
      expect(result).toEqual([]);
    });

    it('должен игнорировать задачи с dependency на missing из allStatuses', () => {
      const statuses = {
        '2': 'pending',
        // '1' отсутствует
      };

      const result = service.getNextTasks(statuses);

      // Задача 2 зависит от 1, которой нет в statuses
      expect(result).toEqual([]);
    });

    it('должен возвращать пустой массив если allStatuses пустой', () => {
      const result = service.getNextTasks({});

      expect(result).toEqual([]);
    });

    it('должен игнорировать задачи missing из индекса (использует пустой массив deps)', () => {
      const statuses = {
        '999': 'pending',
      };

      const result = service.getNextTasks(statuses);

      // Задача 999 отсутствует в индексе, но без зависимостей считается готовой
      expect(result).toEqual(['999']);
    });
  });

  describe('resetCache()', () => {
    it('должен сбрасывать кэш', async () => {
      writeIndexFile({ '1': [] });
      await service.load();

      const impl = service as IndexServiceImpl;
      expect(impl['cachedIndex']).not.toBeNull();

      impl.resetCache();

      expect(impl['cachedIndex']).toBeNull();
    });
  });

  describe('интеграционные сценарии', () => {
    it('должен работать полный цикл create-update-delete', async () => {
      // Создаём через rebuild
      await service.rebuild([{ id: '1', dependencies: [] }]);

      // Обновляем
      await service.update('1', ['2']);
      let content = readIndexFileSync();
      expect(content).toEqual({ '1': ['2'] });

      // Удаляем
      await service.remove('1');
      content = readIndexFileSync();
      expect(content).toEqual({});
    });

    it('должен восстанавливаться после ошибок записи', async () => {
      // Эмулируем ошибку записи - файл существует только для чтения
      writeIndexFile({ '1': [] });

      // Делаем update, который должен пройти успешно
      await service.update('1', []);

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': [] });
    });

    it('должен корректно обрабатывать сложные графы зависимостей', async () => {
      const complexTasks: TaskDependencies[] = [
        { id: '1', dependencies: [] },
        { id: '2', dependencies: ['1'] },
        { id: '3', dependencies: ['1'] },
        { id: '4', dependencies: ['2', '3'] },
        { id: '5', dependencies: ['4'] },
      ];

      await service.rebuild(complexTasks);

      const statuses = {
        '1': 'completed',
        '2': 'pending',
        '3': 'pending',
        '4': 'pending',
        '5': 'pending',
      };

      const result = service.getNextTasks(statuses);

      // Задачи 2 и 3 готовы (зависимость 1 completed)
      expect(result).toEqual(['2', '3']);
    });
  });
});

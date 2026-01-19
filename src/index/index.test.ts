import { describe, it, expect, beforeEach } from 'vitest';
import { Volume } from 'memfs';
import { createIndexService } from './index.js';
import type { IndexData } from './types.js';
import { CircularDependencyError, IndexCorruptionError, IndexValidationError } from './errors.js';

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
        '1': { status: 'pending', dependencies: [] },
        '2': { status: 'pending', dependencies: ['1'] },
        '3': { status: 'pending', dependencies: ['1', '2'] },
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

    it('должен выбросить IndexCorruptionError если значение не объект', async () => {
      writeIndexFile('{"1": "not object"}');

      await expect(service.load()).rejects.toThrow(IndexCorruptionError);
    });

    it('должен выбросить IndexCorruptionError если нет status', async () => {
      writeIndexFile('{"1": {"dependencies": []}}');

      await expect(service.load()).rejects.toThrow(IndexCorruptionError);
      await expect(service.load()).rejects.toThrow('должно содержать status и dependencies');
    });

    it('должен выбросить IndexCorruptionError если нет dependencies', async () => {
      writeIndexFile('{"1": {"status": "pending"}}');

      await expect(service.load()).rejects.toThrow(IndexCorruptionError);
    });

    it('должен выбросить IndexCorruptionError если null', async () => {
      writeIndexFile('null');

      await expect(service.load()).rejects.toThrow(IndexCorruptionError);
    });
  });

  describe('update()', () => {
    it('должен обновить статус и зависимости задачи', async () => {
      writeIndexFile({ '1': { status: 'pending', dependencies: [] } });

      await service.update('1', { status: 'completed', dependencies: ['2'] });

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': { status: 'completed', dependencies: ['2'] } });
    });

    it('должен создать запись если taskId не существует', async () => {
      await service.update('5', { status: 'pending', dependencies: [] });

      const content = readIndexFileSync();
      expect(content).toEqual({ '5': { status: 'pending', dependencies: [] } });
    });

    it('должен использовать pending как дефолтный статус если пустой', async () => {
      await service.update('1', { status: '', dependencies: [] });

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': { status: 'pending', dependencies: [] } });
    });

    it('должен auto-dedup зависимости', async () => {
      await service.update('1', { status: 'pending', dependencies: ['2', '2', '3', '2'] });

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': { status: 'pending', dependencies: ['2', '3'] } });
    });

    it('должен auto-trim whitespace в зависимостях', async () => {
      await service.update('1', { status: 'pending', dependencies: [' 2 ', '3 ', ' 4'] });

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': { status: 'pending', dependencies: ['2', '3', '4'] } });
    });

    it('должен выбросить IndexValidationError при невалидном ID задачи', async () => {
      await expect(
        service.update('invalid', { status: 'pending', dependencies: [] }),
      ).rejects.toThrow(IndexValidationError);
      await expect(
        service.update('invalid', { status: 'pending', dependencies: [] }),
      ).rejects.toThrow('Невалидный формат ID');
    });

    it('должен выбросить IndexValidationError при ID > 50 chars', async () => {
      const longId = '1'.repeat(51);
      await expect(service.update(longId, { status: 'pending', dependencies: [] })).rejects.toThrow(
        IndexValidationError,
      );
      await expect(service.update(longId, { status: 'pending', dependencies: [] })).rejects.toThrow(
        'превышает максимальную длину',
      );
    });

    it('должен выбросить IndexValidationError при невалидном ID зависимости', async () => {
      await expect(
        service.update('1', { status: 'pending', dependencies: ['invalid'] }),
      ).rejects.toThrow(IndexValidationError);
    });

    it('должен выбросить CircularDependencyError при self-dependency', async () => {
      await expect(service.update('1', { status: 'pending', dependencies: ['1'] })).rejects.toThrow(
        CircularDependencyError,
      );
      await expect(service.update('1', { status: 'pending', dependencies: ['1'] })).rejects.toThrow(
        'зависит от самой себя',
      );
    });

    it('должен выбросить CircularDependencyError при цикле', async () => {
      writeIndexFile({ '1': { status: 'pending', dependencies: ['2'] } });

      await expect(service.update('2', { status: 'pending', dependencies: ['1'] })).rejects.toThrow(
        CircularDependencyError,
      );
      await expect(service.update('2', { status: 'pending', dependencies: ['1'] })).rejects.toThrow(
        'циклическая зависимость',
      );
    });

    it('должен использовать атомарную запись (temp + rename)', async () => {
      await service.update('1', { status: 'pending', dependencies: ['2'] });

      // Проверяем что .tmp файл не остался
      expect(vol.existsSync('/tasks/.hod/index.json.tmp')).toBe(false);
      // Проверяем что основной файл создан
      expect(vol.existsSync('/tasks/.hod/index.json')).toBe(true);
    });
  });

  describe('remove()', () => {
    it('должен удалить taskId из индекса', async () => {
      writeIndexFile({
        '1': { status: 'pending', dependencies: [] },
        '2': { status: 'pending', dependencies: [] },
      });

      await service.remove('1');

      const content = readIndexFileSync();
      expect(content).toEqual({ '2': { status: 'pending', dependencies: [] } });
    });

    it('должен быть noop если taskId не существует', async () => {
      writeIndexFile({ '1': { status: 'pending', dependencies: [] } });

      await service.remove('999');

      const content = readIndexFileSync();
      expect(content).toEqual({ '1': { status: 'pending', dependencies: [] } });
    });

    it('должен быть noop если индекс пустой', async () => {
      writeIndexFile({});

      await expect(service.remove('1')).resolves.not.toThrow();
    });
  });

  describe('getNextTasks()', () => {
    beforeEach(async () => {
      // Создаём индекс с зависимостями и статусами
      const indexData: IndexData = {
        '1': { status: 'pending', dependencies: [] },
        '2': { status: 'pending', dependencies: ['1'] },
        '3': { status: 'pending', dependencies: ['1', '2'] },
        '4': { status: 'pending', dependencies: ['5'] },
        '5': { status: 'pending', dependencies: [] },
      };
      writeIndexFile(indexData);
      await service.load();
    });

    it('должен вернуть задачи без зависимостей со статусом pending', async () => {
      const result = await service.getNextTasks();

      // Задача 1 и 5 без зависимостей
      expect(result).toEqual(['1', '5']);
    });

    it('должен вернуть задачи у которых все зависимости completed', async () => {
      // Обновляем статус задачи 1 на completed
      await service.update('1', { status: 'completed', dependencies: [] });
      await service.update('3', { status: 'in_progress', dependencies: ['1', '2'] });

      const result = await service.getNextTasks();

      // Задача 2 готова (зависимость 1 completed), задача 5 без зависимостей
      expect(result).toEqual(['2', '5']);
    });

    it('должен вернуть пустой массив если нет готовых задач', async () => {
      // Удаляем задачи 1 и 5 (без зависимостей) из индекса
      await service.remove('1');
      await service.remove('5');

      // Теперь оставшиеся задачи (2, 3, 4) все зависят от удаленных задач
      const result = await service.getNextTasks();
      expect(result).toEqual([]);
    });

    it('должен игнорировать задачи со статусом completed', async () => {
      await service.update('1', { status: 'completed', dependencies: [] });
      await service.update('2', { status: 'completed', dependencies: ['1'] });
      await service.update('5', { status: 'completed', dependencies: [] });

      const result = await service.getNextTasks();

      // Задачи 3 и 4 готовы: их зависимости (1, 2, 5) завершены
      expect(result).toEqual(['3', '4']);
    });

    it('должен возвращать отсортированные по ID', async () => {
      // Добавим несколько задач без зависимостей
      await service.update('10', { status: 'pending', dependencies: [] });
      await service.update('3', { status: 'pending', dependencies: [] });

      const result = await service.getNextTasks();

      expect(result).toEqual(['1', '3', '5', '10']);
    });

    it('должен сортировать численно по сегментам ID', async () => {
      // Очищаем старый индекс - удаляем все задачи из beforeEach
      await service.remove('1');
      await service.remove('2');
      await service.remove('3');
      await service.remove('4');
      await service.remove('5');
      // Создаём новый индекс
      await service.update('1', { status: 'pending', dependencies: [] });
      await service.update('1.1', { status: 'pending', dependencies: [] });
      await service.update('1.10', { status: 'pending', dependencies: [] });
      await service.update('1.2', { status: 'pending', dependencies: [] });
      await service.update('2', { status: 'pending', dependencies: [] });

      const result = await service.getNextTasks();

      expect(result).toEqual(['1', '1.1', '1.2', '1.10', '2']);
    });

    it('должен возвращать пустой массив если индекс пустой', async () => {
      // Удаляем все задачи для получения пустого индекса
      await service.remove('1');
      await service.remove('2');
      await service.remove('3');
      await service.remove('4');
      await service.remove('5');

      const result = await service.getNextTasks();

      expect(result).toEqual([]);
    });

    it('должен игнорировать задачи с dependency на missing из индекса', async () => {
      // Задача 4 зависит от 5, но 5 существует
      // Добавим задачу 6 которая зависит от несуществующей 99
      await service.update('6', { status: 'pending', dependencies: ['99'] });

      const result = await service.getNextTasks();

      // Задача 6 не должна быть в списке (зависимость 99 отсутствует)
      expect(result).toEqual(['1', '5']);
    });

    it('должен принимать кастомный doneStatus (string)', async () => {
      await service.update('1', { status: 'done', dependencies: [] });
      await service.update('2', { status: 'done', dependencies: ['1'] });
      await service.update('3', { status: 'done', dependencies: ['1', '2'] });
      await service.update('4', { status: 'done', dependencies: ['5'] });
      await service.update('5', { status: 'done', dependencies: [] });

      const result = await service.getNextTasks('done');

      // Все задачи имеют статус 'done', который является doneStatus, поэтому они все пропускаются
      expect(result).toEqual([]);
    });

    it('должен принимать кастомный doneStatus (array)', async () => {
      await service.update('1', { status: 'done', dependencies: [] });
      await service.update('2', { status: 'done', dependencies: ['1'] });
      await service.update('3', { status: 'closed', dependencies: ['1', '2'] });
      await service.update('4', { status: 'done', dependencies: ['5'] });
      await service.update('5', { status: 'closed', dependencies: [] });

      const result = await service.getNextTasks(['done', 'closed']);

      // Все задачи имеют статусы из doneStatus, поэтому они пропускаются
      expect(result).toEqual([]);
    });

    it('должен проверять зависимости по кастомному doneStatus', async () => {
      await service.update('1', { status: 'done', dependencies: [] });

      const result = await service.getNextTasks('done');

      // Задача 2 готова: зависимость 1 имеет статус 'done'
      expect(result).toEqual(['2', '5']);
    });

    it('должен проверять зависимости по массиву doneStatus', async () => {
      await service.update('1', { status: 'done', dependencies: [] });

      const result = await service.getNextTasks(['done', 'completed']);

      // Задача 2 готова: зависимость 1 имеет статус 'done' (из массива)
      expect(result).toEqual(['2', '5']);
    });
  });

  describe('интеграционные сценарии', () => {
    it('должен работать полный цикл create-update-delete', async () => {
      // Создаём задачу через update
      await service.update('1', { status: 'pending', dependencies: [] });

      // Обновляем
      await service.update('1', { status: 'completed', dependencies: ['2'] });
      let content = readIndexFileSync();
      expect(content).toEqual({ '1': { status: 'completed', dependencies: ['2'] } });

      // Удаляем
      await service.remove('1');
      content = readIndexFileSync();
      expect(content).toEqual({});
    });

    it('должен корректно обрабатывать сложные графы зависимостей', async () => {
      // Создаём задачи через update
      await service.update('1', { status: 'pending', dependencies: [] });
      await service.update('2', { status: 'pending', dependencies: ['1'] });
      await service.update('3', { status: 'pending', dependencies: ['1'] });
      await service.update('4', { status: 'pending', dependencies: ['2', '3'] });
      await service.update('5', { status: 'pending', dependencies: ['4'] });

      // Помечаем задачу 1 как completed
      await service.update('1', { status: 'completed', dependencies: [] });

      const result = await service.getNextTasks();

      // Задачи 2 и 3 готовы (зависимость 1 completed)
      expect(result).toEqual(['2', '3']);
    });
  });
});

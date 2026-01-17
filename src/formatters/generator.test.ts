import { describe, it, expect } from 'vitest';
import { generate, GenerationError } from './generator.js';
import type { TaskData } from '../types.js';
import type { IndexData } from '../index/types.js';

describe('MarkdownGenerator', () => {
  describe('генерация базовой структуры', () => {
    it('должен генерировать markdown с обязательной секцией Title', () => {
      const data: TaskData = { title: 'Test Task' };
      const result = generate('1', data);

      expect(result).toContain('# Title');
      expect(result).toContain('Test Task');
      expect(result).toMatchSnapshot();
    });

    it('должен добавлять пустые строки между секциями', () => {
      const data: TaskData = { title: 'Test Task', description: 'Test Description' };
      const result = generate('1', data);

      // Check that sections are separated by blank lines
      const lines = result.split('\n');
      const titleEnd = lines.indexOf('Test Task');
      const descStart = lines.indexOf('# Description');

      expect(descStart).toBeGreaterThan(titleEnd + 1);
    });
  });

  describe('валидация входных данных', () => {
    it('должен выбрасывать ошибку если title отсутствует', () => {
      const data: TaskData = {} as TaskData;

      expect(() => generate('1', data)).toThrow(GenerationError);
      expect(() => generate('1', data)).toThrow('Отсутствует обязательное поле title');
    });

    it('должен выбрасывать ошибку если title пустая строка', () => {
      const data: TaskData = { title: '   ' };

      expect(() => generate('1', data)).toThrow(GenerationError);
    });

    it('должен выбрасывать ошибку если title undefined', () => {
      const data = { title: undefined as unknown as string };

      expect(() => generate('1', data)).toThrow(GenerationError);
    });

    it('должен выбрасывать ошибку если значение кастомного поля не string', () => {
      const data: TaskData = {
        title: 'Test',
        priority: 123 as unknown as string,
      };

      expect(() => generate('1', data)).toThrow(GenerationError);
      expect(() => generate('1', data)).toThrow('Неверный тип поля priority');
    });

    it('должен trim значения title', () => {
      const data: TaskData = { title: '  Test Task  ' };
      const result = generate('1', data);

      expect(result).toContain('Test Task');
      expect(result).not.toContain('  Test Task  ');
    });
  });

  describe('секция Description', () => {
    it('должен включать Description если значение присутствует', () => {
      const data: TaskData = {
        title: 'Test Task',
        description: 'This is a description',
      };
      const result = generate('1', data);

      expect(result).toContain('# Description');
      expect(result).toContain('This is a description');
      expect(result).toMatchSnapshot();
    });

    it('должен пропускать Description если значение отсутствует', () => {
      const data: TaskData = { title: 'Test Task' };
      const result = generate('1', data);

      expect(result).not.toContain('# Description');
    });

    it('должен пропускать Description если значение пустая строка', () => {
      const data: TaskData = {
        title: 'Test Task',
        description: '   ',
      };
      const result = generate('1', data);

      expect(result).not.toContain('# Description');
    });

    it('должен пропускать Description если undefined', () => {
      const data: TaskData = {
        title: 'Test Task',
        description: undefined,
      };
      const result = generate('1', data);

      expect(result).not.toContain('# Description');
    });

    it('должен trim значение description', () => {
      const data: TaskData = {
        title: 'Test Task',
        description: '  This is a description  ',
      };
      const result = generate('1', data);

      expect(result).toContain('This is a description');
      expect(result).not.toContain('  This is a description  ');
    });
  });

  describe('секция Dependencies', () => {
    it('должен включать Dependencies из indexData если есть зависимости', () => {
      const data: TaskData = { title: 'Test Task' };
      const indexData = {
        '1': { status: 'pending', dependencies: ['2', '3', '5'] },
      };
      const result = generate('1', data, indexData);

      expect(result).toContain('# Dependencies');
      expect(result).toContain('2, 3, 5');
      expect(result).toMatchSnapshot();
    });

    it('должен пропускать Dependencies если список пуст', () => {
      const data: TaskData = { title: 'Test Task' };
      const indexData = {
        '1': { status: 'pending', dependencies: [] },
      };
      const result = generate('1', data, indexData);

      expect(result).not.toContain('# Dependencies');
    });

    it('должен пропускать Dependencies если задачи нет в indexData', () => {
      const data: TaskData = { title: 'Test Task' };
      const indexData = {
        '2': { status: 'pending', dependencies: ['1'] },
      };
      const result = generate('1', data, indexData);

      expect(result).not.toContain('# Dependencies');
    });

    it('должен пропускать Dependencies если indexData undefined', () => {
      const data: TaskData = { title: 'Test Task' };
      const result = generate('1', data, undefined);

      expect(result).not.toContain('# Dependencies');
    });

    it('НЕ должен включать Status из indexData', () => {
      const data: TaskData = { title: 'Test Task' };
      const indexData = {
        '1': { status: 'done', dependencies: [] },
      };
      const result = generate('1', data, indexData);

      expect(result).not.toContain('# Status');
      expect(result).not.toContain('done');
    });

    it('НЕ должен включать dependencies из data (только из indexData)', () => {
      const data: TaskData = {
        title: 'Test Task',
        dependencies: '1, 2, 3',
      } as TaskData;
      const result = generate('1', data);

      expect(result).not.toContain('# Dependencies');
    });
  });

  describe('кастомные поля', () => {
    it('должен включать кастомные поля в LOWERCASE', () => {
      const data: TaskData = {
        title: 'Test Task',
        Priority: 'high',
      };
      const result = generate('1', data);

      expect(result).toContain('# Priority');
      expect(result).toContain('high');
      expect(result).toMatchSnapshot();
    });

    it('должен капитализировать первую букву ключа', () => {
      const data: TaskData = {
        title: 'Test Task',
        priority: 'high',
        assignee: 'john',
      };
      const result = generate('1', data);

      expect(result).toContain('# Priority');
      expect(result).toContain('# Assignee');
    });

    it('должен сортировать кастомные поля по алфавиту', () => {
      const data: TaskData = {
        title: 'Test Task',
        zebra: 'last',
        apple: 'first',
        banana: 'middle',
      };
      const result = generate('1', data);

      const applePos = result.indexOf('# Apple');
      const bananaPos = result.indexOf('# Banana');
      const zebraPos = result.indexOf('# Zebra');

      expect(applePos).toBeLessThan(bananaPos);
      expect(bananaPos).toBeLessThan(zebraPos);
    });

    it('должен пропускать пустые кастомные поля', () => {
      const data: TaskData = {
        title: 'Test Task',
        priority: '',
        assignee: '   ',
      };
      const result = generate('1', data);

      expect(result).not.toContain('# Priority');
      expect(result).not.toContain('# Assignee');
    });

    it('должен пропускать undefined кастомные поля', () => {
      const data: TaskData = {
        title: 'Test Task',
        priority: undefined,
      };
      const result = generate('1', data);

      expect(result).not.toContain('# Priority');
    });

    it('должен trim значения кастомных полей', () => {
      const data: TaskData = {
        title: 'Test Task',
        priority: '  high  ',
      };
      const result = generate('1', data);

      expect(result).toContain('high');
      expect(result).not.toContain('  high  ');
    });

    it('должен пропускать status из data (системное поле)', () => {
      const data: TaskData = {
        title: 'Test Task',
        status: 'pending',
      };
      const result = generate('1', data);

      expect(result).not.toContain('# Status');
    });

    it('должен пропускать dependencies из data (системное поле)', () => {
      const data: TaskData = {
        title: 'Test Task',
        dependencies: '1, 2, 3',
      };
      const result = generate('1', data);

      expect(result).not.toContain('# Dependencies');
    });
  });

  describe('порядок секций', () => {
    it('должен следовать порядку: Title → Description → Dependencies → Custom', () => {
      const data: TaskData = {
        title: 'Test Task',
        description: 'Test Description',
        priority: 'high',
        assignee: 'john',
      };
      const indexData = {
        '1': { status: 'pending', dependencies: ['2', '3'] },
      };
      const result = generate('1', data, indexData);

      const titlePos = result.indexOf('# Title');
      const descPos = result.indexOf('# Description');
      const depsPos = result.indexOf('# Dependencies');
      const assigneePos = result.indexOf('# Assignee');
      const priorityPos = result.indexOf('# Priority');

      expect(titlePos).toBeLessThan(descPos);
      expect(descPos).toBeLessThan(depsPos);
      expect(depsPos).toBeLessThan(assigneePos);
      // Priority and Assignee are sorted alphabetically
      expect(assigneePos).toBeLessThan(priorityPos);
    });
  });

  describe('edge cases', () => {
    it('должен обрабатывать многострочные значения', () => {
      const data: TaskData = {
        title: 'Test Task',
        description: 'Line 1\nLine 2\nLine 3',
      };
      const result = generate('1', data);

      expect(result).toContain('Line 1\nLine 2\nLine 3');
      expect(result).toMatchSnapshot();
    });

    it('должен обрабатывать спецсимволы в значениях', () => {
      const data: TaskData = {
        title: 'Task with "quotes"',
        description: 'Description with <special> & characters',
      };
      const result = generate('1', data);

      expect(result).toContain('Task with "quotes"');
      expect(result).toContain('Description with <special> & characters');
    });

    it('должен работать только с Title (минимальная валидная задача)', () => {
      const data: TaskData = { title: 'Minimal Task' };
      const result = generate('1', data);

      const lines = result.split('\n').filter((line) => line.trim() !== '');
      expect(lines).toEqual(['# Title', 'Minimal Task']);
    });

    it('должен корректно обрабатывать task ID с точками', () => {
      const data: TaskData = { title: 'Subtask' };
      const indexData = {
        '1.2.3': { status: 'pending', dependencies: ['1', '1.2'] },
      };
      const result = generate('1.2.3', data, indexData);

      expect(result).toContain('# Dependencies');
      expect(result).toContain('1, 1.2');
    });
  });

  describe('полный пример', () => {
    it('должен генерировать полный markdown со всеми секциями', () => {
      const data: TaskData = {
        title: 'Implement feature',
        description: 'Detailed description of the feature',
        priority: 'high',
        assignee: 'john@example.com',
        estimate: '5h',
      };
      const indexData = {
        '1': { status: 'in_progress', dependencies: ['2', '3'] },
      };
      const result = generate('1', data, indexData);

      expect(result).toMatchSnapshot();
    });
  });
});

describe('MarkdownGenerator integration tests', () => {
  describe('валидация индекса', () => {
    it('должен выбрасывать ошибку если dependencies не массив', () => {
      const data: TaskData = { title: 'Test Task' };
      const malformedIndexData = {
        '1': { status: 'pending', dependencies: 'not-an-array' } as unknown as {
          status: string;
          dependencies: string[];
        },
      };

      expect(() => generate('1', data, malformedIndexData)).toThrow(GenerationError);
      expect(() => generate('1', data, malformedIndexData)).toThrow(
        'dependencies должен быть массивом строк',
      );
    });

    it('должен выбрасывать ошибку если dependencies содержит не-строки', () => {
      const data: TaskData = { title: 'Test Task' };
      const malformedIndexData = {
        '1': { status: 'pending', dependencies: [1, 2, 3] as unknown as string[] },
      };

      expect(() => generate('1', data, malformedIndexData)).toThrow(GenerationError);
      expect(() => generate('1', data, malformedIndexData)).toThrow(
        'dependencies должен быть массивом строк',
      );
    });

    it('должен выбрасывать ошибку если dependencies содержит mixed типы', () => {
      const data: TaskData = { title: 'Test Task' };
      const malformedIndexData = {
        '1': { status: 'pending', dependencies: ['1', 2 as unknown as string, '3'] },
      };

      expect(() => generate('1', data, malformedIndexData)).toThrow(GenerationError);
      expect(() => generate('1', data, malformedIndexData)).toThrow(
        'dependencies должен быть массивом строк',
      );
    });
  });

  describe('совместимость с IndexData из index модуля', () => {
    it('должен работать с валидной структурой IndexData', () => {
      const data: TaskData = {
        title: 'Integration Test',
        description: 'Testing with real IndexData structure',
        priority: 'high',
      };
      const validIndexData: IndexData = {
        '1': { status: 'pending', dependencies: ['2', '3'] },
      };

      const result = generate('1', data, validIndexData);

      expect(result).toContain('# Title');
      expect(result).toContain('Integration Test');
      expect(result).toContain('# Dependencies');
      expect(result).toContain('2, 3');
    });

    it('должен работать с пустыми dependencies', () => {
      const data: TaskData = { title: 'No Deps' };
      const validIndexData: IndexData = {
        '1': { status: 'pending', dependencies: [] },
      };

      const result = generate('1', data, validIndexData);

      expect(result).not.toContain('# Dependencies');
    });
  });

  describe('Unicode поддержка', () => {
    it('должен корректно капитализировать кириллицу', () => {
      const data: TaskData = {
        title: 'Задача с русским названием',
        приоритет: 'высокий', // lowercase Cyrillic input
        исполнитель: 'иван',
      };
      const result = generate('1', data);

      expect(result).toContain('# Приоритет');
      expect(result).toContain('# Исполнитель');
      expect(result).toContain('высокий');
      expect(result).toContain('иван');
      expect(result).toMatchSnapshot();
    });

    it('должен корректно обрабатывать смешанный ввод (латиница + кириллица)', () => {
      const data: TaskData = {
        title: 'Mixed Content',
        priority: 'high',
        приоритет: 'высокий',
      };
      const result = generate('1', data);

      expect(result).toContain('# Priority');
      expect(result).toContain('# Приоритет');
    });
  });
});

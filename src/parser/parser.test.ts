import { describe, it, expect } from 'vitest';
import { ParserService, ParseError } from './parser.js';

describe('ParserService', () => {
  describe('parse()', () => {
    it('должен распарсить все поля задачи', () => {
      const markdown = `# Title
Название задачи

# Description
Описание задачи

# Status
pending

# Dependencies
1, 2, 5`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('Название задачи');
      expect(result.description).toBe('Описание задачи');
      expect(result.status).toBe('pending');
      expect(result.dependencies).toEqual(['1', '2', '5']);
    });

    it('должен распарсить Dependencies как массив строк', () => {
      const markdown = `# Title
Task

# Dependencies
1, 2, 5`;

      const result = ParserService.parse(markdown);

      expect(result.dependencies).toEqual(['1', '2', '5']);
    });

    it('должен вернуть пустой массив если Dependencies пустой', () => {
      const markdown = `# Title
Task

# Dependencies
`;

      const result = ParserService.parse(markdown);

      expect(result.dependencies).toEqual([]);
    });

    it('должен вернуть пустой массив если Dependencies отсутствует (fallback)', () => {
      const markdown = `# Title
Task`;

      const result = ParserService.parse(markdown);

      expect(result.dependencies).toEqual([]);
    });

    it('должен работать с пустым description', () => {
      const markdown = `# Title
Task

# Status
done`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('Task');
      expect(result.description).toBeUndefined();
      expect(result.status).toBe('done');
    });

    it('должен работать с многострочными значениями', () => {
      const markdown = `# Title
строка1

строка2

# Status
done`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('строка1\n\nстрока2');
      expect(result.status).toBe('done');
    });

    it('должен игнорировать неизвестные поля', () => {
      const markdown = `# Title
Task

# CustomField
custom value

# Priority
high`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('Task');
      expect(result.CustomField).toBe('custom value');
      expect(result.Priority).toBe('high');
    });

    it('должен выбросить ParseError при пустом вводе', () => {
      expect(() => ParserService.parse('')).toThrow(ParseError);
      expect(() => ParserService.parse('   ')).toThrow(ParseError);
    });

    it('должен выбросить ParseError при отсутствии Title', () => {
      const markdown = `# Description
desc`;

      expect(() => ParserService.parse(markdown)).toThrow(ParseError);
    });

    it('должен выбросить ParseError при невалидном ID зависимости', () => {
      const markdown = `# Title
Task

# Dependencies
1, abc, 3`;

      expect(() => ParserService.parse(markdown)).toThrow(ParseError);
    });

    it('должен использовать дефолтный status "pending"', () => {
      const markdown = `# Title
Task`;

      const result = ParserService.parse(markdown);

      expect(result.status).toBe('pending');
    });

    it('должен trim-ить ID зависимостей', () => {
      const markdown = `# Title
Task

# Dependencies
1,  2 , 3`;

      const result = ParserService.parse(markdown);

      expect(result.dependencies).toEqual(['1', '2', '3']);
    });

    it('должен фильтровать пустые элементы в Dependencies', () => {
      const markdown = `# Title
Task

# Dependencies
1, , 3`;

      const result = ParserService.parse(markdown);

      expect(result.dependencies).toEqual(['1', '3']);
    });

    it('должен использовать первое вхождение секции', () => {
      const markdown = `# Title
First

# Title
Second`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('First');
    });
  });

  describe('serialize()', () => {
    it('должен сериализовать задачу в markdown', () => {
      const task = {
        title: 'Task',
        description: 'Desc',
        status: 'done',
        dependencies: ['1', '2'],
      };

      const result = ParserService.serialize(task);

      expect(result).toBe(`# Title
Task

# Description
Desc

# Status
done

# Dependencies
1, 2
`);
    });

    it('должен всегда добавлять #Dependencies (пустой если нет)', () => {
      const task = {
        title: 'Task',
        status: 'pending',
        dependencies: [],
      };

      const result = ParserService.serialize(task);

      expect(result).toContain('# Dependencies\n');
    });

    it('должен правильно сериализовать Dependencies (через запятую)', () => {
      const task = {
        title: 'Task',
        status: 'pending',
        dependencies: ['1', '2', '5'],
      };

      const result = ParserService.serialize(task);

      expect(result).toContain('1, 2, 5');
    });

    it('должен пропускать пустые поля кроме Dependencies', () => {
      const task = {
        title: 'Task',
        status: 'pending',
        dependencies: [],
        description: '',
      };

      const result = ParserService.serialize(task);

      expect(result).not.toContain('# Description');
      expect(result).toContain('# Dependencies');
    });

    it('должен пропускать undefined поля', () => {
      const task = {
        title: 'Task',
        status: 'pending',
        dependencies: [],
        description: undefined,
        priority: undefined,
      };

      const result = ParserService.serialize(task);

      expect(result).not.toContain('# Description');
      expect(result).not.toContain('# Priority');
    });

    it('должен сериализовать кастомные поля в алфавитном порядке', () => {
      const task = {
        title: 'Task',
        status: 'pending',
        dependencies: [],
        Priority: 'high',
        Assignee: 'user',
      };

      const result = ParserService.serialize(task);

      const priorityIndex = result.indexOf('# Priority');
      const assigneeIndex = result.indexOf('# Assignee');

      expect(assigneeIndex).toBeLessThan(priorityIndex);
    });
  });

  describe('ParseError', () => {
    it('должен содержать section в ошибке', () => {
      try {
        ParserService.parse(`# Description
desc`);
        expect.fail('Should throw ParseError');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        if (e instanceof ParseError) {
          expect(e.section).toBe('Title');
        }
      }
    });

    it('должен иметь правильное имя ошибки', () => {
      const error = new ParseError('test', 'Title');

      expect(error.name).toBe('ParseError');
      expect(error.message).toBe('test');
      expect(error.section).toBe('Title');
    });
  });
});

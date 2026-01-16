import { describe, it, expect } from 'vitest';
import { ParserService, ParseError } from './parser.js';

describe('ParserService', () => {
  describe('parse()', () => {
    it('должен распарсить все поля задачи', () => {
      const markdown = `# Title
Название задачи

# Description
Описание задачи

# CustomField
custom value`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('Название задачи');
      expect(result.description).toBe('Описание задачи');
      expect(result.customfield).toBe('custom value');
      // Status и dependencies теперь только в index, не в markdown
      expect(result.status).toBeUndefined();
      expect(result.dependencies).toBeUndefined();
    });

    it('должен работать с пустым description', () => {
      const markdown = `# Title
Task`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('Task');
      expect(result.description).toBeUndefined();
    });

    it('должен работать с многострочными значениями', () => {
      const markdown = `# Title
строка1

строка2`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('строка1\n\nстрока2');
    });

    it('должен игнорировать Status и Dependencies секции', () => {
      const markdown = `# Title
Task

# Status
completed

# Dependencies
1, 2, 5`;

      const result = ParserService.parse(markdown);

      expect(result.title).toBe('Task');
      // Status и dependencies игнорируются - они только в index
      expect(result.status).toBeUndefined();
      expect(result.dependencies).toBeUndefined();
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
      // Custom fields теперь lowercase для совместимости с CLI names
      expect(result.customfield).toBe('custom value');
      expect(result.priority).toBe('high');
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
      };

      const result = ParserService.serialize(task);

      // Status и dependencies больше не сериализуются в markdown
      expect(result).toBe(`# Title
Task

# Description
Desc
`);
    });

    it('должен пропускать пустые поля', () => {
      const task = {
        title: 'Task',
        description: '',
      };

      const result = ParserService.serialize(task);

      expect(result).not.toContain('# Description');
    });

    it('должен пропускать undefined поля', () => {
      const task = {
        title: 'Task',
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
        // Custom fields теперь lowercase для консистентности
        priority: 'high',
        assignee: 'user',
      };

      const result = ParserService.serialize(task);

      // Заголовки custom полей в lowercase при сериализации
      expect(result).toMatch(/# assignee/);
      expect(result).toMatch(/# priority/);

      // Алфавитный порядок
      const assigneeIndex = result.indexOf('# assignee');
      const priorityIndex = result.indexOf('# priority');
      expect(assigneeIndex).toBeLessThan(priorityIndex);

      // Также проверим что парсинг lowercase заголовков работает
      const parsed = ParserService.parse(result);
      expect(parsed.priority).toBe('high');
      expect(parsed.assignee).toBe('user');
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

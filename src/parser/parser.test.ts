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

  describe('parseJson()', () => {
    it('должен распарсить JSON с title и description', () => {
      const json = '{"title":"Task","description":"Desc"}';

      const result = ParserService.parseJson(json);

      expect(result.title).toBe('Task');
      expect(result.description).toBe('Desc');
    });

    it('должен распарсить JSON с кастомными полями', () => {
      const json = '{"title":"Task","priority":"high","assignee":"user"}';

      const result = ParserService.parseJson(json);

      expect(result.title).toBe('Task');
      expect(result.priority).toBe('high');
      expect(result.assignee).toBe('user');
    });

    it('должен выбросить ParseError при пустом вводе', () => {
      expect(() => ParserService.parseJson('')).toThrow(ParseError);
      expect(() => ParserService.parseJson('   ')).toThrow(ParseError);
    });

    it('должен выбросить ParseError при невалидном JSON', () => {
      expect(() => ParserService.parseJson('{invalid}')).toThrow(ParseError);
    });

    it('должен выбросить ParseError при отсутствии title', () => {
      const json = '{"description":"Desc"}';
      expect(() => ParserService.parseJson(json)).toThrow(ParseError);
    });

    it('должен выбросить ParseError при неверном типе title', () => {
      const json = '{"title":123}';
      expect(() => ParserService.parseJson(json)).toThrow(ParseError);
    });

    it('должен выбросить ParseError при неверном типе кастомного поля', () => {
      const json = '{"title":"Task","priority":123}';
      expect(() => ParserService.parseJson(json)).toThrow(ParseError);
    });

    it('должен обрабатывать null значения опциональных полей', () => {
      const json = '{"title":"Task","description":null}';

      const result = ParserService.parseJson(json);

      expect(result.title).toBe('Task');
      expect(result.description).toBeUndefined();
    });

    it('должен trim значения', () => {
      const json = '{"title":"  Task  ","description":"  Desc  "}';

      const result = ParserService.parseJson(json);

      expect(result.title).toBe('Task');
      expect(result.description).toBe('Desc');
    });

    it('должен игнорировать status и dependencies', () => {
      const json = '{"title":"Task","status":"completed","dependencies":["1","2"]}';

      const result = ParserService.parseJson(json);

      expect(result.title).toBe('Task');
      expect(result.status).toBeUndefined();
      expect(result.dependencies).toBeUndefined();
    });

    it('должен выбросить ParseError для массива', () => {
      const json = '[]';
      expect(() => ParserService.parseJson(json)).toThrow(ParseError);
    });

    it('должен выбросить ParseError для null', () => {
      const json = 'null';
      expect(() => ParserService.parseJson(json)).toThrow(ParseError);
    });

    it('должен выбросить ParseError для примитива', () => {
      const json = '"string"';
      expect(() => ParserService.parseJson(json)).toThrow(ParseError);
    });
  });

  describe('serializeToJson()', () => {
    it('должен сериализовать задачу в JSON', () => {
      const task = {
        title: 'Task',
        description: 'Desc',
      };

      const result = ParserService.serializeToJson(task);

      // Pretty-printed с 2 пробелами
      expect(result).toBe('{\n  "title": "Task",\n  "description": "Desc"\n}');
    });

    it('должен быть pretty-printed с 2 пробелами', () => {
      const task = {
        title: 'Task',
        description: 'Desc',
      };

      const result = ParserService.serializeToJson(task);

      expect(result).toBe('{\n  "title": "Task",\n  "description": "Desc"\n}');
    });

    it('должен пропускать пустые опциональные поля', () => {
      const task = {
        title: 'Task',
        description: '',
      };

      const result = ParserService.serializeToJson(task);

      expect(result).toBe('{\n  "title": "Task"\n}');
      expect(result).not.toContain('description');
    });

    it('должен пропускать undefined поля', () => {
      const task = {
        title: 'Task',
        description: undefined,
        priority: undefined,
      };

      const result = ParserService.serializeToJson(task);

      expect(result).not.toContain('description');
      expect(result).not.toContain('priority');
    });

    it('должен выбросить ParseError при отсутствии title', () => {
      const task = { title: undefined as unknown as string }; // Type assertion to test missing title

      expect(() => ParserService.serializeToJson(task)).toThrow(ParseError);
    });

    it('должен выбросить ParseError при неверном типе кастомного поля', () => {
      const task = {
        title: 'Task',
        priority: 123 as unknown as string, // Type assertion to bypass TS, runtime will fail
      };

      expect(() => ParserService.serializeToJson(task)).toThrow(ParseError);
    });

    it('round-trip: serializeToJson -> parseJson', () => {
      const original = {
        title: 'Task',
        description: 'Desc',
        priority: 'high',
      };

      const json = ParserService.serializeToJson(original);
      const restored = ParserService.parseJson(json);

      expect(restored.title).toBe(original.title);
      expect(restored.description).toBe(original.description);
      expect(restored.priority).toBe(original.priority);
    });

    it('round-trip: parseJson -> serializeToJson', () => {
      const json = '{\n  "title": "Task",\n  "description": "Desc",\n  "priority": "high"\n}';
      const parsed = ParserService.parseJson(json);
      const restoredJson = ParserService.serializeToJson(parsed);

      expect(restoredJson).toBe(json);
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

  describe('serializeJson()', () => {
    it('должен сериализовать задачу в JSON', () => {
      const task = {
        title: 'Task',
        description: 'Desc',
      };

      const result = ParserService.serializeJson(task);
      const parsed = JSON.parse(result);

      expect(parsed.title).toBe('Task');
      expect(parsed.description).toBe('Desc');
      // Status и dependencies не должны быть в JSON
      expect(parsed.status).toBeUndefined();
      expect(parsed.dependencies).toBeUndefined();
    });

    it('должен пропускать пустые поля', () => {
      const task = {
        title: 'Task',
        description: '',
      };

      const result = ParserService.serializeJson(task);
      const parsed = JSON.parse(result);

      expect(parsed.title).toBe('Task');
      expect(parsed.description).toBeUndefined();
    });

    it('должен пропускать undefined поля', () => {
      const task = {
        title: 'Task',
        description: undefined,
        priority: undefined,
      };

      const result = ParserService.serializeJson(task);
      const parsed = JSON.parse(result);

      expect(parsed.title).toBe('Task');
      expect(parsed.description).toBeUndefined();
      expect(parsed.priority).toBeUndefined();
    });

    it('должен сериализовать кастомные поля', () => {
      const task = {
        title: 'Task',
        priority: 'high',
        assignee: 'user',
      };

      const result = ParserService.serializeJson(task);
      const parsed = JSON.parse(result);

      expect(parsed.title).toBe('Task');
      expect(parsed.priority).toBe('high');
      expect(parsed.assignee).toBe('user');
    });

    it('должен выбросить ParseError при отсутствии title', () => {
      const task = {
        description: 'Desc',
      } as unknown as { title: string };

      expect(() => ParserService.serializeJson(task)).toThrow(ParseError);
    });

    it('должен выбросить ParseError при неверном типе title', () => {
      const task = {
        title: 123 as unknown as string,
      };

      expect(() => ParserService.serializeJson(task)).toThrow(ParseError);
    });

    it('должен выбросить ParseError при неверном типе кастомного поля', () => {
      const task = {
        title: 'Task',
        priority: ['high'] as unknown as string,
      };

      expect(() => ParserService.serializeJson(task)).toThrow(ParseError);
    });

    it('должен форматировать JSON с отступами', () => {
      const task = {
        title: 'Task',
        description: 'Desc',
      };

      const result = ParserService.serializeJson(task);

      expect(result).toBe('{\n  "title": "Task",\n  "description": "Desc"\n}\n');
    });

    it('должен корректно экранировать специальные символы', () => {
      const task = {
        title: 'Task with "quotes"',
        description: 'Line 1\nLine 2\tTabbed\\Backslash',
      };

      const result = ParserService.serializeJson(task);
      const parsed = JSON.parse(result);

      expect(parsed.title).toBe('Task with "quotes"');
      expect(parsed.description).toBe('Line 1\nLine 2\tTabbed\\Backslash');
    });

    it('должен поддерживать Unicode символы', () => {
      const task = {
        title: 'Задача с emoji 🎯 и 中文',
        description: 'Description with Ñ, é, and 日本語',
      };

      const result = ParserService.serializeJson(task);
      const parsed = JSON.parse(result);

      expect(parsed.title).toBe('Задача с emoji 🎯 и 中文');
      expect(parsed.description).toBe('Description with Ñ, é, and 日本語');
    });

    it('должен создавать валидный JSON для парсинга обратно', () => {
      const task = {
        title: 'Complex Task "with quotes"',
        description: 'Multi\nline\twith\\special',
        priority: 'high',
      };

      const result = ParserService.serializeJson(task);

      // Проверяем что результат является валидным JSON
      expect(() => JSON.parse(result)).not.toThrow();

      // Проверяем что данные сохраняются при round-trip
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({
        title: 'Complex Task "with quotes"',
        description: 'Multi\nline\twith\\special',
        priority: 'high',
      });
    });
  });
});

import type { ParsedTask } from './types.js';
import { ParseError } from './types.js';

export interface ParserService {
  parse(markdown: string): ParsedTask;
  serialize(task: ParsedTask): string;
  parseJson(jsonString: string): ParsedTask;
  serializeToJson(task: ParsedTask): string;
}

class ParserServiceImpl implements ParserService {
  parse(markdown: string): ParsedTask {
    const trimmed = markdown.trim();

    if (trimmed === '') {
      throw new ParseError('Empty input');
    }

    const sections = this.parseSections(trimmed);
    const task = this.buildTask(sections);

    return task;
  }

  serialize(task: ParsedTask): string {
    // Status и dependencies хранятся только в индексе, не в markdown
    const parts: string[] = [];

    // 1. Title (обязателен)
    if (task.title === undefined || task.title === null) {
      throw new ParseError('Missing required field: title');
    }
    parts.push('# Title', task.title);

    // 2. Description (если не пустой)
    if (task.description && task.description.trim() !== '') {
      parts.push('', '# Description', task.description.trim());
    }

    // 3. Кастомные поля в алфавитном порядке
    const customFields = this.getCustomFields(task);
    const sortedKeys = Object.keys(customFields).sort();

    for (const key of sortedKeys) {
      const value = customFields[key];
      if (value !== undefined && value !== null && value.trim() !== '') {
        parts.push('', `# ${key}`, value.trim());
      }
    }

    return parts.join('\n') + '\n';
  }

  parseJson(jsonString: string): ParsedTask {
    const trimmed = jsonString.trim();

    if (trimmed === '') {
      throw new ParseError('Empty input');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new ParseError(`Невалидный JSON: ${e.message}`);
      }
      throw new ParseError(`Ошибка парсинга JSON: ${String(e)}`);
    }

    // Validate that parsed is an object
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ParseError('JSON должен быть объектом');
    }

    const obj = parsed as Record<string, unknown>;

    // Title is required and must be a string
    const title = obj.title;
    if (typeof title !== 'string') {
      throw new ParseError('Отсутствует обязательное поле title или имеет неверный тип');
    }

    const task: ParsedTask = {
      title: title.trim(),
    };

    // Process optional fields
    if (obj.description !== undefined && obj.description !== null) {
      if (typeof obj.description !== 'string') {
        throw new ParseError('Поле description должно быть строкой');
      }
      task.description = obj.description.trim();
    }

    // Process custom fields (must be strings)
    const standardKeys = new Set(['title', 'description', 'status', 'dependencies']);
    for (const [key, value] of Object.entries(obj)) {
      if (standardKeys.has(key)) {
        continue; // Skip standard fields (except title which is already handled)
      }

      if (value !== undefined && value !== null) {
        if (typeof value !== 'string') {
          throw new ParseError(`Поле '${key}' должно быть строкой, получено ${typeof value}`);
        }
        // Store as lowercase (consistent with ParsedTask format)
        task[key.toLowerCase()] = value.trim();
      }
    }

    return task;
  }

  serializeToJson(task: ParsedTask): string {
    // Status и dependencies хранятся только в индексе, не в JSON
    const obj: Record<string, string> = {};

    // Title is required
    if (task.title === undefined || task.title === null) {
      throw new ParseError('Missing required field: title');
    }
    obj.title = task.title.trim();

    // Description (если не пустой)
    if (task.description && task.description.trim() !== '') {
      obj.description = task.description.trim();
    }

    // Кастомные поля (только string значения)
    const standardKeys = new Set(['title', 'description']);
    for (const [key, value] of Object.entries(task)) {
      if (standardKeys.has(key)) {
        continue;
      }
      if (value !== undefined && value !== null && typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed !== '') {
          obj[key] = trimmed;
        }
      } else if (value !== undefined && value !== null) {
        const type = Array.isArray(value) ? 'array' : typeof value;
        throw new ParseError(`Invalid custom field '${key}': expected string, got ${type}`);
      }
    }

    // Pretty-print с 2 пробелами
    return JSON.stringify(obj, null, 2);
  }

  private parseSections(markdown: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = markdown.split('\n');

    let currentKey: string | null = null;
    let currentValue: string[] = [];
    const seenKeys = new Set<string>();

    const saveSection = () => {
      if (currentKey !== null && !seenKeys.has(currentKey)) {
        const value = currentValue.join('\n').trim();
        if (value !== '') {
          sections.set(currentKey, value);
        }
        // Ключ добавляется в seenKeys даже при пустом значении,
        // чтобы дубликаты всегда игнорировались (первое вхождение используется)
        seenKeys.add(currentKey);
      }
    };

    for (const line of lines) {
      const sectionMatch = line.match(/^#\s+(.+)$/);

      if (sectionMatch) {
        // Сохраняем предыдущую секцию (только если ещё не видели этот ключ)
        saveSection();

        // Начинаем новую секцию
        currentKey = sectionMatch[1];
        currentValue = [];
      } else if (currentKey !== null) {
        currentValue.push(line);
      }
    }

    // Сохраняем последнюю секцию
    saveSection();

    return sections;
  }

  private buildTask(sections: Map<string, string>): ParsedTask {
    // Title обязателен
    const title = sections.get('Title');
    if (!title) {
      throw new ParseError('Missing required section: Title', 'Title');
    }

    // Description опционален
    const description = sections.get('Description');

    // Кастомные поля
    const task: ParsedTask = {
      title,
      description,
    };

    // Status и dependencies хранятся только в индексе
    const standardKeys = new Set(['Title', 'Description', 'Status', 'Dependencies']);
    for (const [key, value] of sections.entries()) {
      if (!standardKeys.has(key)) {
        // Custom fields: lowercase для совместимости с CLI names
        const lowerKey = key.toLowerCase();
        task[lowerKey] = value;
      }
    }

    return task;
  }

  private getCustomFields(task: Record<string, unknown>): Record<string, string> {
    const standardKeys = new Set(['title', 'description']);
    const custom: Record<string, string> = {};

    for (const [key, value] of Object.entries(task)) {
      if (!standardKeys.has(key) && value !== undefined && value !== null) {
        // Кастомные поля должны быть строками согласно спецификации
        if (typeof value === 'string') {
          custom[key] = value;
        } else {
          // Все остальные типы (number, boolean, object, array, etc.) не разрешены
          const type = Array.isArray(value) ? 'array' : typeof value;
          throw new ParseError(`Invalid custom field '${key}': expected string, got ${type}`);
        }
      }
    }

    return custom;
  }

  /**
   * Сериализует ParsedTask в JSON формат для хранения в файле.
   * Status и dependencies хранятся только в индексе, не в JSON файле.
   *
   * @param task - ParsedTask для сериализации
   * @returns JSON строка
   * @throws {ParseError} если title отсутствует или имеет неверный тип
   */
  serializeJson(task: ParsedTask): string {
    // Валидация обязательных полей
    if (task.title === undefined || task.title === null) {
      throw new ParseError('Missing required field: title');
    }
    if (typeof task.title !== 'string') {
      throw new ParseError(`Invalid field 'title': expected string, got ${typeof task.title}`);
    }

    // Собираем данные для JSON
    const jsonData: Record<string, string | undefined> = {
      title: task.title,
    };

    // Description (опционален, пропускаем пустые строки)
    if (task.description !== undefined && task.description.trim() !== '') {
      if (typeof task.description !== 'string') {
        throw new ParseError(
          `Invalid field 'description': expected string, got ${typeof task.description}`,
        );
      }
      jsonData.description = task.description;
    }

    // Кастомные поля (все остальные строковые поля)
    const standardKeys = new Set(['title', 'description']);
    for (const [key, value] of Object.entries(task)) {
      if (!standardKeys.has(key) && value !== undefined && value !== null) {
        if (typeof value === 'string') {
          // Пропускаем пустые строки
          if (value.trim() !== '') {
            jsonData[key] = value;
          }
        } else {
          const type = Array.isArray(value) ? 'array' : typeof value;
          throw new ParseError(`Invalid custom field '${key}': expected string, got ${type}`);
        }
      }
    }

    return JSON.stringify(jsonData, null, 2) + '\n';
  }
}

export const ParserService: ParserService = new ParserServiceImpl();
export { ParseError };
export type { ParsedTask };

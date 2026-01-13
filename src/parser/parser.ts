import type { ParsedTask } from './types.js';
import { ParseError } from './types.js';

const DEPENDENCY_ID_REGEX = /^\d+(\.\d+)*$/;

interface ParserService {
  parse(markdown: string): ParsedTask;
  serialize(task: ParsedTask): string;
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

    // 3. Status
    parts.push('', '# Status', task.status);

    // 4. Dependencies (всегда присутствует)
    const depsValue = this.serializeDependencies(task.dependencies);
    parts.push('', '# Dependencies', depsValue);

    // 5. Кастомные поля в алфавитном порядке
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

    // Status с дефолтом
    const status = sections.get('Status') || 'pending';

    // Dependencies с дефолтом и валидацией
    const dependencies = this.parseDependencies(sections.get('Dependencies'));

    // Кастомные поля
    const task: ParsedTask = {
      title,
      description,
      status,
      dependencies,
    };

    const standardKeys = new Set(['Title', 'Description', 'Status', 'Dependencies']);
    for (const [key, value] of sections.entries()) {
      if (!standardKeys.has(key)) {
        task[key] = value;
      }
    }

    return task;
  }

  private parseDependencies(value: string | undefined): string[] {
    if (!value || value.trim() === '') {
      return [];
    }

    const rawIds = value.split(',').map((id) => id.trim());
    const result: string[] = [];

    for (const id of rawIds) {
      if (id === '') {
        continue;
      }

      if (!DEPENDENCY_ID_REGEX.test(id)) {
        throw new ParseError(`Invalid dependency ID: '${id}'`, 'Dependencies');
      }

      result.push(id);
    }

    return result;
  }

  private serializeDependencies(deps: string[]): string {
    const validDeps = deps.filter((d) => {
      const trimmed = d.trim();
      if (trimmed === '') return false;
      if (!DEPENDENCY_ID_REGEX.test(trimmed)) {
        throw new ParseError(`Invalid dependency ID: '${trimmed}'`, 'Dependencies');
      }
      return true;
    });
    return validDeps.join(', ');
  }

  private getCustomFields(task: ParsedTask): Record<string, string> {
    const standardKeys = new Set(['title', 'description', 'status', 'dependencies']);
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
}

export const ParserService: ParserService = new ParserServiceImpl();
export { ParseError };
export type { ParsedTask };

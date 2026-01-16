import { describe, it, expect } from 'vitest';
import type { Task } from '../../storage/storage.js';
import { findDirectSubtasks, formatSubtaskList } from './subtasks.js';

describe('subtasks utilities', () => {
  describe('findDirectSubtasks', () => {
    it('должен находить прямых подзадач для основной задачи', () => {
      const allTasks: Task[] = [
        { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
        { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
        { id: '1.2', content: '# Title\nSubtask 1.2\n# Dependencies\n' },
        { id: '2', content: '# Title\nTask 2\n# Dependencies\n' },
      ];

      const result = findDirectSubtasks('1', allTasks);

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(['1.1', '1.2']);
    });

    it('должен находить прямых подзадач для подзадачи', () => {
      const allTasks: Task[] = [
        { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
        { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
        { id: '1.1.1', content: '# Title\nSubtask 1.1.1\n# Dependencies\n' },
        { id: '1.1.2', content: '# Title\nSubtask 1.1.2\n# Dependencies\n' },
      ];

      const result = findDirectSubtasks('1.1', allTasks);

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(['1.1.1', '1.1.2']);
    });

    it('не должен считать 1.10 подзадачей 1.1', () => {
      const allTasks: Task[] = [
        { id: '1.1', content: '# Title\nTask 1.1\n# Dependencies\n' },
        { id: '1.10', content: '# Title\nTask 1.10 (sibling of 1.1)\n# Dependencies\n' },
        { id: '1.1.1', content: '# Title\nTask 1.1.1 (child of 1.1)\n# Dependencies\n' },
      ];

      const result = findDirectSubtasks('1.1', allTasks);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1.1.1');
    });

    it('должен возвращать пустой массив если подзадач нет', () => {
      const allTasks: Task[] = [
        { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
        { id: '2', content: '# Title\nTask 2\n# Dependencies\n' },
      ];

      const result = findDirectSubtasks('1', allTasks);

      expect(result).toHaveLength(0);
    });

    it('должен правильно находить всех детей задачи 1', () => {
      const allTasks: Task[] = [
        { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
        { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
        { id: '1.2', content: '# Title\nSubtask 1.2\n# Dependencies\n' },
        { id: '1.10', content: '# Title\nSubtask 1.10\n# Dependencies\n' },
        { id: '2', content: '# Title\nTask 2\n# Dependencies\n' },
      ];

      const result = findDirectSubtasks('1', allTasks);

      expect(result).toHaveLength(3);
      expect(result.map((t) => t.id).sort()).toEqual(['1.1', '1.10', '1.2']);
    });

    it('должен находить только прямых потомков, не вложенные', () => {
      const allTasks: Task[] = [
        { id: '1', content: '# Title\nTask 1\n# Dependencies\n' },
        { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
        { id: '1.1.1', content: '# Title\nSubtask 1.1.1\n# Dependencies\n' },
        { id: '1.2', content: '# Title\nSubtask 1.2\n# Dependencies\n' },
      ];

      const result = findDirectSubtasks('1', allTasks);

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(['1.1', '1.2']);
    });
  });

  describe('formatSubtaskList', () => {
    it('должен форматировать список подзадач', () => {
      const subtasks: Task[] = [
        { id: '1.2', content: '# Title\nSubtask 1.2\n# Dependencies\n' },
        { id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' },
        { id: '1.10', content: '# Title\nSubtask 1.10\n# Dependencies\n' },
      ];

      const result = formatSubtaskList(subtasks);

      expect(result).toBe('1.1, 1.10, 1.2');
    });

    it('должен возвращать пустую строку для пустого списка', () => {
      const result = formatSubtaskList([]);

      expect(result).toBe('');
    });

    it('должен форматировать одну подзадачу', () => {
      const subtasks: Task[] = [{ id: '1.1', content: '# Title\nSubtask 1.1\n# Dependencies\n' }];

      const result = formatSubtaskList(subtasks);

      expect(result).toBe('1.1');
    });
  });
});

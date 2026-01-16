import { describe, it, expect } from 'vitest';
import type { ParsedTask } from '../parser/types.js';
import { buildTree, formatTree, detectOrphans, treeToJson } from './tree.js';

// Helper to create a parsed task (without status/deps since they're in index now)
const createTask = (_id: string, title: string): ParsedTask => ({
  title,
});

// Helper to create a task with ID
const createWithId = (id: string, title: string) => ({
  id,
  task: createTask(id, title),
});

describe('tree module', () => {
  describe('buildTree()', () => {
    it('должен строить плоское дерево без подзадач', () => {
      const tasks = [
        createWithId('1', 'Task 1'),
        createWithId('2', 'Task 2'),
        createWithId('3', 'Task 3'),
      ];

      const { tree, warnings } = buildTree(tasks);

      expect(warnings).toHaveLength(0);
      expect(tree).toHaveLength(3);
      expect(tree[0].task.id).toBe('1');
      expect(tree[0].children).toHaveLength(0);
    });

    it('должен строить дерево с подзадачами', () => {
      const tasks = [
        createWithId('1', 'Main task'),
        createWithId('1.1', 'Subtask 1'),
        createWithId('1.2', 'Subtask 2'),
        createWithId('2', 'Other task'),
      ];

      const { tree, warnings } = buildTree(tasks);

      expect(warnings).toHaveLength(0);
      expect(tree).toHaveLength(2);
      expect(tree[0].task.id).toBe('1');
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children[0].task.id).toBe('1.1');
      expect(tree[0].children[1].task.id).toBe('1.2');
      expect(tree[1].children).toHaveLength(0);
    });

    it('должен фильтровать невалидные ID и собирать предупреждения', () => {
      const tasks = [
        createWithId('1', 'Valid task'),
        createWithId('invalid', 'Invalid ID'),
        createWithId('1.', 'Another invalid'),
        createWithId('2', 'Another valid'),
      ];

      const { tree, warnings } = buildTree(tasks);

      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain("невалидным ID 'invalid'");
      expect(warnings[1]).toContain("невалидным ID '1.'");
      expect(tree).toHaveLength(2);
    });

    it('должен обрабатывать пустой список задач', () => {
      const { tree, warnings } = buildTree([]);

      expect(warnings).toHaveLength(0);
      expect(tree).toHaveLength(0);
    });

    it('должен обрабатывать сиротские подзадачи', () => {
      const tasks = [
        createWithId('1', 'Main task'),
        createWithId('1.1', 'Subtask'),
        createWithId('2.1', 'Orphaned subtask'), // parent 2 doesn't exist
      ];

      const { tree } = buildTree(tasks);

      // Orphaned subtasks are placed at root level
      expect(tree).toHaveLength(2);
      expect(tree[0].task.id).toBe('1');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].task.id).toBe('1.1');
      expect(tree[1].task.id).toBe('2.1'); // orphaned at root level
    });

    it('должен брать статус из индекса', () => {
      const tasks = [createWithId('1', 'Task 1'), createWithId('2', 'Task 2')];

      const indexData: Record<string, { status: string; dependencies: string[] }> = {
        '1': { status: 'done', dependencies: [] },
        '2': { status: 'in-progress', dependencies: [] },
      };

      const { tree } = buildTree(tasks, indexData);

      expect(tree[0].task.status).toBe('done');
      expect(tree[1].task.status).toBe('in-progress');
    });

    it('должен использовать дефолтный status pending если задачи нет в индексе', () => {
      const tasks = [createWithId('1', 'Task 1')];

      const { tree } = buildTree(tasks, {});

      expect(tree[0].task.status).toBe('pending');
    });
  });

  describe('formatTree()', () => {
    it('должен форматировать плоское дерево', () => {
      const tasks = [createWithId('1', 'Task 1'), createWithId('2', 'Task 2')];

      const indexData: Record<string, { status: string; dependencies: string[] }> = {
        '1': { status: 'pending', dependencies: [] },
        '2': { status: 'done', dependencies: [] },
      };

      const { tree } = buildTree(tasks, indexData);
      const result = formatTree(tree);

      expect(result).toContain('1');
      expect(result).toContain('pending');
      expect(result).toContain('Task 1');
      expect(result).toContain('2');
      expect(result).toContain('done');
      expect(result).toContain('Task 2');
    });

    it('должен форматировать дерево с подзадачами', () => {
      const tasks = [
        createWithId('1', 'Main task'),
        createWithId('1.1', 'Subtask 1'),
        createWithId('1.2', 'Subtask 2'),
      ];

      const indexData: Record<string, { status: string; dependencies: string[] }> = {
        '1': { status: 'pending', dependencies: [] },
        '1.1': { status: 'pending', dependencies: [] },
        '1.2': { status: 'done', dependencies: [] },
      };

      const { tree } = buildTree(tasks, indexData);
      const result = formatTree(tree);

      expect(result).toContain('├──');
      expect(result).toContain('└──');
      expect(result).toContain('1.1');
      expect(result).toContain('1.2');
    });

    it('должен обрабатывать пустое дерево', () => {
      const result = formatTree([]);
      expect(result).toBe('');
    });
  });

  describe('detectOrphans()', () => {
    it('должен находить сиротские подзадачи', () => {
      const tasks = [
        createWithId('1', 'Main task'),
        createWithId('1.1', 'Valid subtask'),
        createWithId('2.1', 'Orphaned subtask'),
        createWithId('3.1', 'Another orphan'),
      ];

      const { tree } = buildTree(tasks);
      const orphans = detectOrphans(tree);

      expect(orphans).toContain('2.1');
      expect(orphans).toContain('3.1');
      expect(orphans).toHaveLength(2);
    });

    it('не должен находить сирот в валидном дереве', () => {
      const tasks = [
        createWithId('1', 'Main task'),
        createWithId('1.1', 'Subtask 1'),
        createWithId('1.2', 'Subtask 2'),
        createWithId('2', 'Another task'),
      ];

      const { tree } = buildTree(tasks);
      const orphans = detectOrphans(tree);

      expect(orphans).toHaveLength(0);
    });

    it('должен обрабатывать пустое дерево', () => {
      const orphans = detectOrphans([]);
      expect(orphans).toHaveLength(0);
    });
  });

  describe('treeToJson()', () => {
    it('должен конвертировать дерево в JSON', () => {
      const tasks = [createWithId('1', 'Main task'), createWithId('1.1', 'Subtask')];

      const indexData: Record<string, { status: string; dependencies: string[] }> = {
        '1': { status: 'pending', dependencies: [] },
        '1.1': { status: 'done', dependencies: [] },
      };

      const { tree } = buildTree(tasks, indexData);
      const json = treeToJson(tree);

      expect(json).toHaveLength(1);
      expect(json[0]).toEqual({
        id: '1',
        title: 'Main task',
        status: 'pending',
        children: [
          {
            id: '1.1',
            title: 'Subtask',
            status: 'done',
            children: [],
          },
        ],
      });
    });

    it('должен включать только минимальный набор полей', () => {
      const tasks = [createWithId('1', 'Task')];

      const { tree } = buildTree(tasks);
      const json = treeToJson(tree);
      const keys = Object.keys(json[0]);

      expect(keys).toContain('id');
      expect(keys).toContain('title');
      expect(keys).toContain('status');
      expect(keys).toContain('children');
    });

    it('должен обрабатывать пустое дерево', () => {
      const json = treeToJson([]);
      expect(json).toHaveLength(0);
    });

    it('должен сохранять пустой массив children', () => {
      const tasks = [createWithId('1', 'Task without children')];

      const { tree } = buildTree(tasks);
      const json = treeToJson(tree);

      expect(json[0].children).toEqual([]);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Volume } from 'memfs';
import type { Config } from '../../config/types.js';
import type { ConfigService } from '../../config/types.js';
import { createStorageService } from '../../storage/storage.js';
import { createIndexService } from '../../index/index.js';
import { ParserService } from '../../parser/parser.js';
import type { UpdateCommandOptions } from './update.js';
import { updateCommand } from './update.js';
import type { AddCommandOptions } from './add.js';
import { addCommand } from './add.js';
import type { Services } from '../services.js';

// Mock config that works with memfs paths
const mockConfig: Config = {
  tasksDir: '/tasks',
  fields: {
    Title: { name: 'title', required: true },
    Description: { name: 'description' },
    Status: { name: 'status', default: 'pending' },
    Priority: { name: 'priority' },
  },
};

// Helper to create real services with memfs
async function createIntegrationServices(vol: Volume): Promise<Services> {
  // Create a mock config service that returns our mock config
  const configService: ConfigService = {
    load: vi.fn().mockResolvedValue(mockConfig),
    validate: vi.fn(),
  } as unknown as ConfigService;

  // Create storage and index with memfs
  const storageService = createStorageService(
    mockConfig.tasksDir,
    vol.promises as unknown as typeof import('node:fs/promises'),
  );
  const indexService = createIndexService(
    mockConfig.tasksDir,
    vol.promises as unknown as typeof import('node:fs/promises'),
  );

  return {
    config: configService,
    storage: storageService,
    index: indexService,
    parser: ParserService,
  };
}

describe('update command (integration tests with memfs)', () => {
  let services: Services;
  let vol: Volume;

  beforeEach(async () => {
    vol = Volume.fromJSON({});
    services = await createIntegrationServices(vol);
  });

  describe('JSON→JSON update cycle', () => {
    it('должен обновлять JSON задачу и сохранять JSON формат', async () => {
      // Create a new task as JSON (via add command)
      const addOptions: AddCommandOptions = {
        title: 'Original Title',
        description: 'Original description',
      };
      const taskId = await addCommand(addOptions, services);

      // Verify the task was created as JSON
      const contentBefore = await services.storage.read(taskId);
      const parsedBefore = JSON.parse(contentBefore);
      expect(parsedBefore.title).toBe('Original Title');
      expect(parsedBefore.description).toBe('Original description');

      // Update the task
      const updateOptions: UpdateCommandOptions = {
        id: taskId,
        title: 'Updated Title',
        description: 'Updated description',
      };
      await updateCommand(updateOptions, services);

      // Verify the task is still JSON after update
      const contentAfter = await services.storage.read(taskId);
      const parsedAfter = JSON.parse(contentAfter);

      expect(parsedAfter.title).toBe('Updated Title');
      expect(parsedAfter.description).toBe('Updated description');

      // Verify the file is still JSON (not markdown)
      expect(contentAfter).toMatch(/^\{/);
      expect(contentAfter).not.toContain('# Title');
    });

    it('должен сохранять кастомные поля при обновлении JSON задачи', async () => {
      // Create a task with custom fields
      await addCommand(
        {
          title: 'Task with priority',
          priority: 'high',
        },
        services,
      );

      // Update only the title
      await updateCommand({ id: '1', title: 'Updated title' }, services);

      // Verify priority is still there
      const content = await services.storage.read('1');
      const parsed = JSON.parse(content);

      expect(parsed.title).toBe('Updated title');
      expect(parsed.priority).toBe('high');
    });

    it('должен обновлять частично JSON задачу', async () => {
      // Create a task
      await addCommand(
        {
          title: 'Original',
          description: 'Original desc',
          priority: 'high',
        },
        services,
      );

      // Update only description
      await updateCommand({ id: '1', description: 'New description' }, services);

      const content = await services.storage.read('1');
      const parsed = JSON.parse(content);

      expect(parsed.title).toBe('Original');
      expect(parsed.description).toBe('New description');
      expect(parsed.priority).toBe('high');
    });

    it('должен корректно обрабатывать специальные символы в JSON', async () => {
      // Create a task with special characters
      await addCommand(
        {
          title: 'Task "with quotes"',
          description: 'Line 1\nLine 2',
        },
        services,
      );

      // Update to add more special characters
      await updateCommand({ id: '1', description: 'Multi\nline\twith\\backslash' }, services);

      const content = await services.storage.read('1');
      const parsed = JSON.parse(content);

      expect(parsed.title).toBe('Task "with quotes"');
      expect(parsed.description).toBe('Multi\nline\twith\\backslash');
    });
  });

  describe('markdown→JSON migration', () => {
    it('должен мигрировать markdown задачу в JSON при обновлении', async () => {
      // Create a markdown file directly (bypass storage.create() validation)
      const markdownContent = `# Title
Old Title
# Description
Old description
# Priority
high`;

      // Write directly to filesystem (create directory first)
      await vol.promises.mkdir('/tasks', { recursive: true });
      await vol.promises.mkdir('/tasks/.hod', { recursive: true });
      await vol.promises.writeFile('/tasks/1.md', markdownContent);
      await vol.promises.writeFile(
        '/tasks/.hod/index.json',
        '{"1":{"status":"pending","dependencies":[]}}',
      );

      // Verify it's markdown
      const beforeUpdate = await services.storage.read('1');
      expect(beforeUpdate).toContain('# Title');

      // Update the task
      await updateCommand({ id: '1', title: 'New Title' }, services);

      // Verify it's now JSON
      const afterUpdate = await services.storage.read('1');
      expect(afterUpdate).toMatch(/^\{/);
      expect(afterUpdate).not.toContain('# Title');

      const parsed = JSON.parse(afterUpdate);
      expect(parsed.title).toBe('New Title');
      expect(parsed.description).toBe('Old description');
      expect(parsed.priority).toBe('high');
    });

    it('должен сохранять все поля при миграции markdown→JSON', async () => {
      // Create a complex markdown task directly
      const markdownContent = `# Title
Complex Task
# Description
Multi-line
description
# CustomField
custom value
# Tags
urgent,important`;

      await vol.promises.mkdir('/tasks', { recursive: true });
      await vol.promises.mkdir('/tasks/.hod', { recursive: true });
      await vol.promises.writeFile('/tasks/1.md', markdownContent);
      await vol.promises.writeFile(
        '/tasks/.hod/index.json',
        '{"1":{"status":"pending","dependencies":[]}}',
      );

      // Update the task
      await updateCommand({ id: '1', title: 'Updated Complex Task' }, services);

      // Verify all fields are preserved
      const content = await services.storage.read('1');
      const parsed = JSON.parse(content);

      expect(parsed.title).toBe('Updated Complex Task');
      expect(parsed.description).toBe('Multi-line\ndescription');
      expect(parsed.customfield).toBe('custom value');
      expect(parsed.tags).toBe('urgent,important');
    });

    it('должен корректно парсить markdown с Unicode', async () => {
      // Create a markdown task with Unicode directly
      const markdownContent = `# Title
Задача с emoji 🎯
# Description
Описание с 中文 and Ñ`;

      await vol.promises.mkdir('/tasks', { recursive: true });
      await vol.promises.mkdir('/tasks/.hod', { recursive: true });
      await vol.promises.writeFile('/tasks/1.md', markdownContent);
      await vol.promises.writeFile(
        '/tasks/.hod/index.json',
        '{"1":{"status":"pending","dependencies":[]}}',
      );

      // Update the task
      await updateCommand({ id: '1', description: 'Updated описание' }, services);

      // Verify Unicode is preserved
      const content = await services.storage.read('1');
      const parsed = JSON.parse(content);

      expect(parsed.title).toBe('Задача с emoji 🎯');
      expect(parsed.description).toBe('Updated описание');
    });
  });

  describe('удаление опциональных полей', () => {
    it('должен удалять опциональное поле при передаче пустой строки', async () => {
      // Create a task with optional fields
      await addCommand(
        {
          title: 'Task',
          description: 'Description',
          priority: 'high',
        },
        services,
      );

      // Update with empty string for description
      await updateCommand({ id: '1', description: '' }, services);

      const content = await services.storage.read('1');
      const parsed = JSON.parse(content);

      expect(parsed.title).toBe('Task');
      expect(parsed.description).toBeUndefined();
      expect(parsed.priority).toBe('high');
    });
  });

  describe('rollback при ошибке индекса', () => {
    it('должен откатывать изменения при циклической зависимости', async () => {
      // Create two tasks
      await addCommand({ title: 'Task 1' }, services);
      await addCommand({ title: 'Task 2' }, services);

      // Get original content of task 2
      const originalContent = await services.storage.read('2');

      // Try to update task 2 to depend on itself (circular)
      await expect(updateCommand({ id: '2', dependencies: '2' }, services)).rejects.toThrow();

      // Verify the file was not changed
      const contentAfter = await services.storage.read('2');
      expect(contentAfter).toBe(originalContent);
    });
  });
});

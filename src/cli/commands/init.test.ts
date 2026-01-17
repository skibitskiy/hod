import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initCommand } from './init.js';
import type { Services } from '../services.js';

const mockCreateDefault = vi.fn();

const mockServices = {
  config: {
    createDefault: mockCreateDefault,
    load: vi.fn(),
    validate: vi.fn(),
  } as unknown as Services['config'],
  storage: {} as unknown as Services['storage'],
  index: {} as unknown as Services['index'],
  parser: {} as unknown as Services['parser'],
};

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('базовая функциональность', () => {
    it('должен возвращать сообщение об успешной инициализации', async () => {
      mockCreateDefault.mockResolvedValue({
        created: true,
        message: 'HOD проект инициализирован',
      });

      const result = await initCommand({}, mockServices);

      expect(result).toContain('проект');
      expect(mockCreateDefault).toHaveBeenCalledWith('./tasks');
    });

    it('должен возвращать сообщение если config уже существует', async () => {
      mockCreateDefault.mockResolvedValue({
        created: false,
        message: 'Конфигурация уже существует (hod.config.yml)',
      });

      const result = await initCommand({}, mockServices);

      expect(result).toContain('уже существует');
    });

    it('должен передавать кастомную директорию в config service', async () => {
      mockCreateDefault.mockResolvedValue({
        created: true,
        message: 'HOD проект инициализирован',
      });

      await initCommand({ dir: './custom-tasks' }, mockServices);

      expect(mockCreateDefault).toHaveBeenCalledWith('./custom-tasks');
    });

    it('должен прокидывать ошибки из config service', async () => {
      const error = new Error('Permission denied');
      mockCreateDefault.mockRejectedValue(error);

      await expect(initCommand({}, mockServices)).rejects.toThrow('Permission denied');
    });
  });
});

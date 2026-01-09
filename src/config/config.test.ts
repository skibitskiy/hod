import { describe, it } from 'vitest';

// Контракт
// interface Config {
//   tasksDir: string;
//   fields: {
//     title: { key: string; required: true };
//     description?: { key: string };
//     status?: { key: string; default: string };
//   };
// }
//
// interface ConfigService {
//   load(path?: string): Promise<Config>;
//   validate(config: Config): void;
// }

describe('ConfigService', () => {
  describe('load()', () => {
    it('должен загрузить конфиг из hod.config.yml');
    it('должен добавить description если его нет в конфиге');
    it('должен выбросить ошибку если файл не найден');
    it('должен выбросить ошибку если YAML невалиден');
  });

  describe('validate()', () => {
    it('должен пройти валидацию с корректным конфигом');
    it('должен выбросить ошибку если tasksDir не указан');
    it('должен выбросить ошибку если title не указан');
    it('должен выбросить ошибку если title.key пустой');
  });
});

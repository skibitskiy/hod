import { describe, it } from 'vitest';

// Контракт
// interface IndexData {
//   [taskId: string]: string[];  // "1.1": ["1"] - taskId -> dependencies
// }
//
// interface IndexService {
//   load(): Promise<IndexData>;
//   update(taskId: string, dependencies: string[]): Promise<void>;
//   remove(taskId: string): Promise<void>;
//   rebuild(tasks: Task[]): Promise<void>;  // пересборка из markdown
//   getNextTasks(allStatuses: Record<string, string>): string[];
// }

describe('IndexService', () => {
  describe('load()', () => {
    it('должен загрузить index.json');
    it('должен вернуть пустой объект если файл не существует');
    it('должен выбросить ошибку если JSON невалиден');
  });

  describe('update()', () => {
    it('должен обновить зависимости задачи');
    it('должен создать запись если taskId не существует');
    it('должен установить пустой массив если нет зависимостей');
  });

  describe('remove()', () => {
    it('должен удалить taskId из индекса');
    it('должен быть noop если taskId не существует');
  });

  describe('rebuild()', () => {
    it('должен пересобрать индекс из списка задач');
    it('должен очистить старые записи');
    it('должен сохранить зависимости из парсенных задач');
  });

  describe('getNextTasks()', () => {
    it('должен вернуть задачи без зависимостей со статусом pending');
    it('должен вернуть задачи у которых все зависимости completed');
    it('должен вернуть пустой массив если нет готовых задач');
    it('должен игнорировать задачи со статусом completed');
    it('должен корректно обрабатывать циклические зависимости');
  });
});

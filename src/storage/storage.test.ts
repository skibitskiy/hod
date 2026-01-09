import { describe, it } from 'vitest';

// Контракт
// interface Task {
//   id: string;
//   content: string;
// }
//
// interface StorageService {
//   create(id: string, content: string): Promise<void>;
//   read(id: string): Promise<string>;
//   update(id: string, content: string): Promise<void>;
//   delete(id: string): Promise<void>;
//   list(): Promise<Task[]>;
//   exists(id: string): Promise<boolean>;
// }

describe('StorageService', () => {
  describe('create()', () => {
    it('должен создать файл задачи {id}.md');
    it('должен выбросить ошибку если файл уже существует');
    it('должен создать директорию если её нет');
  });

  describe('read()', () => {
    it('должен прочитать содержимое файла');
    it('должен выбросить ошибку если файл не найден');
  });

  describe('update()', () => {
    it('должен обновить содержимое файла');
    it('должен выбросить ошибку если файл не найден');
  });

  describe('delete()', () => {
    it('должен удалить файл');
    it('должен быть noop если файл не существует');
  });

  describe('list()', () => {
    it('должен вернуть список всех задач');
    it('должен вернуть пустой массив если директория пуста');
    it('должен игнорировать .hod директорию');
    it('должен игнорировать файлы не подходящие под паттерн *.md');
  });

  describe('exists()', () => {
    it('должен вернуть true если файл существует');
    it('должен вернуть false если файл не существует');
  });
});

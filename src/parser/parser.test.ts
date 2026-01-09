import { describe, it } from 'vitest';

// Контракт
// interface ParsedTask {
//   id: string;
//   title: string;
//   description?: string;
//   status: string;
//   dependencies: string[];  // всегда есть, минимум []
//   [key: string]: string | string[] | undefined;
// }
//
// interface ParserService {
//   parse(id: string, markdown: string): ParsedTask;
//   serialize(task: ParsedTask): string;
// }

// Формат Markdown
// # Title
// Название задачи
//
// # Description
// Описание задачи
//
// # Status
// pending
//
// # Dependencies
// 1, 2, 5

describe('ParserService', () => {
  describe('parse()', () => {
    it('должен распарсить все поля задачи');
    it('должен распарсить Dependencies как массив строк');
    it('должен вернуть пустой массив если Dependencies пустой');
    it('должен вернуть пустой массив если Dependencies отсутствует (fallback)');
    it('должен работать с пустым description');
    it('должен работать с многострочными значениями');
    it('должен игнорировать неизвестные поля');
  });

  describe('serialize()', () => {
    it('должен сериализовать задачу в markdown');
    it('должен всегда добавлять #Dependencies (пустой если нет)');
    it('должен правильно сериализовать Dependencies (через запятую)');
    it('должен пропускать пустые поля кроме Dependencies');
  });
});

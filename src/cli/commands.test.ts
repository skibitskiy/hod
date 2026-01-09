import { describe, it } from 'vitest';

// CLI Commands contract:
//
// hod add --id 1 --title "Заголовок" --description "Описание"
//   - Создает markdown файл
//   - Обновляет index.json с dependencies=[]
//
// hod list [--status pending] [--json]
//   - Выводит список задач
//
// hod update --id 1 --status completed --title "Новое название"
// hod update --id 1 --dependencies 2,3
//   - Обновляет задачу
//   - Обновляет index.json при изменении dependencies
//
// hod delete --id 1 [--force]
//   - Удаляет файл и запись из index.json
//
// hod init [--dir ./tasks]
//   - Создает hod.config.yml
//   - Создает tasks/.hod/
//   - Создает пустой index.json
//
// hod next [--all]
//   - Читает статусы из markdown
//   - Читает зависимости из index.json
//   - Вычисляет доступные задачи
//
// hod sync
//   - Пересобирает index.json из markdown

describe('CLI Commands', () => {
  describe('hod add', () => {
    it('должен создать задачу с --id и --title');
    it('должен сгенерировать ID если не указан --id');
    it('должен использовать дефолтные поля из конфига');
    it('должен создать запись в index.json с dependencies=[]');
    it('должен выбросить ошибку если title не указан');
  });

  describe('hod list', () => {
    it('должен вывести список задач в табличном виде');
    it('должен фильтровать по --status');
    it('должен выводить JSON если указан --json');
    it('должен показывать пустой список если задач нет');
  });

  describe('hod update', () => {
    it('должен обновить указанные поля задачи');
    it('должен обновить index.json при изменении dependencies');
    it('должен выбросить ошибку если задача не найдена');
  });

  describe('hod delete', () => {
    it('должен удалить задачу по ID');
    it('должен удалить запись из index.json');
    it('должен запросить подтверждение если нет --force');
    it('должен выбросить ошибку если задача не найдена');
  });

  describe('hod init', () => {
    it('должен создать hod.config.yml с дефолтными значениями');
    it('должен создать tasks/.hod/ директорию');
    it('должен создать пустой index.json');
    it('должен использовать --dir если указан');
    it('должен быть noop если конфиг уже существует');
  });

  describe('hod next', () => {
    it('должен показать задачи с выполненными зависимостями');
    it('должен читать статусы из markdown');
    it('должен читать зависимости из index.json');
    it("должен показывать 'нет задач' если все выполнены");
  });

  describe('hod sync', () => {
    it('должен пересобрать index.json из всех markdown файлов');
    it('должен очистить несуществующие задачи из индекса');
  });
});

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# HOD — Задачник для Markdown

Утилита для управления задачами в текстовом виде (Markdown) с поддержкой подзадач и зависимостей.

## Development Commands

```bash
npm run build          # Build CLI to dist/
npm run build:prod     # Production build (minified, no sourcemap)
npm run build:watch    # Watch mode for development
npm run dev:link       # Build and npm link for local testing

npm run typecheck      # TypeScript type checking
npm run lint           # ESLint
npm run lint:fix       # ESLint auto-fix + Prettier format
npm run format         # Prettier format
npm run format:check   # Prettier check

npm test               # Run all tests
npm run test:ui        # Vitest UI
npm run test:coverage  # Coverage report
```

**Running single test:** `npx vitest run path/to/test.test.ts`

## Архитектура

```
src/
├── config/           # Конфигурация из YAML (hod.config.yml)
│   ├── index.ts      # ConfigService + фабрика
│   ├── types.ts      # Config, FieldConfig интерфейсы
│   └── errors.ts     # ConfigLoadError, ConfigValidationError
├── storage/          # CRUD для файлов задач
│   ├── storage.ts    # StorageService + фабрика
│   └── errors.ts     # StorageNotFoundError, StorageWriteError, etc.
├── parser/           # Markdown парсер
│   ├── parser.ts     # parse() для markdown → ParsedTask
│   └── types.ts      # ParsedTask интерфейс
├── index/            # Индекс зависимостей (tasks/.hod/index.json)
│   ├── index.ts      # IndexService + фабрика
│   ├── types.ts      # IndexData, TaskIndexData
│   └── errors.ts     # CircularDependencyError, IndexLoadError, etc.
├── formatters/       # Markdown генератор
│   ├── generator.ts  # generate() для TaskData → markdown
│   └── errors.ts     # GenerationError
├── utils/
│   ├── sort.ts       # sortIds() — числовая сортировка по сегментам
│   └── validation.ts # validateTaskId() — regex + length check
├── cli/              # CLI команды
│   ├── index.ts      # Commander entry point, динамические опции
│   ├── services.ts   # createServices() — DI контейнер
│   ├── tree.ts       # renderTree() для --tree вывода
│   ├── commands/     # Отдельные команды (add, list, update, delete, move, init, get)
│   └── utils/
│       └── subtasks.ts # generateSubtaskId(), findMainParent()
└── types.ts          # TaskData интерфейс
```

## Ключевые решения

### 1. Формат задач

**Файлы:** `{tasksDir}/{id}.md` — например `1.md`, `1.1.md`, `2.5.md`

**ID:** `^\d+(\.\d+)*$` — число или числа через точку (подзадачи)

**Markdown формат:**
```markdown
# Title
Название задачи

# Description
Описание задачи

# Priority
high
```

- `# Title` — обязателен
- `# Dependencies`, `# Status` — хранятся в индексе (`tasks/.hod/index.json`), НЕ в markdown
- Любой `# Key` начинает новую секцию (кастомные поля)

### 2. Конфигурация (hod.config.yml)

```yaml
tasksDir: ./tasks           # директория задач (от файла конфига)
fields:
  Title:                   # markdown ключ
    name: title            # CLI аргумент
    required: true
  Description:
    name: description
  Status:
    name: status
    default: pending
```

- Ключ объекта = markdown заголовок
- `name` = CLI аргумент (`--title`, `--description`)
- `description` предусмотрен системой, но не required
- `dependencies` — системное поле, не настраивается

### 3. Индекс зависимостей (tasks/.hod/index.json)

**Формат:**
```json
{
  "1": { "status": "pending", "dependencies": [] },
  "1.1": { "status": "completed", "dependencies": ["1"] },
  "2": { "status": "pending", "dependencies": ["1", "3"] }
}
```

- Хранит `status` и `dependencies` для быстрого `hod next`
- Обновляется при каждом `add/update/delete`
- Markdown файлы содержат только пользовательские поля (Title, Description, кастомные)

### 4. Модули

#### Config (задача 2)
```ts
interface FieldConfig {
  name: string;
  required?: boolean;
  default?: string;
}

interface Config {
  tasksDir: string;  // абсолютный путь
  fields: Record<string, FieldConfig>;
}

class ConfigLoadError extends Error { }
class ConfigValidationError extends Error { }
```

- **zod** для валидации
- `tasksDir` разрешается от файла конфига (или cwd)
- Встроенные дефолты если файл отсутствует
- Не кэширует

#### Storage (задача 3)
```ts
interface Task {
  id: string;
  content: string;
}

class StorageNotFoundError extends Error { }
class StorageWriteError extends Error { }
class StorageAlreadyExistsError extends Error { }
class StorageAccessError extends Error { }
```

- **POSIX-only** (atomic rename)
- Конструктор: `new StorageServiceImpl(tasksDir)`
- Атомарные `create()` и `update()` (temp + rename)
- `list()` — numeric сортировка по сегментам ID
- `.hod/` игнорируется везде

#### Parser (задача 4)
```ts
interface ParsedTask {
  title: string;
  description?: string;
  [key: string]: string | undefined;  // Только string поля
}

class ParseError extends Error {
  constructor(message: string, public section?: string);
}
```

- Любой `# ` начинает секцию
- Все поля = `string` (dependencies/status теперь в индексе)
- Пустой ввод → `ParseError`
- Trim значений

#### Formatters
```ts
function generate(id: string, data: TaskData, indexData?: IndexData): string;
```

- Генерирует markdown из `TaskData`
- Порядок секций: Title → Description → Dependencies (если есть в indexData) → Custom (alphabetically)
- Dependencies берутся из `indexData`, не из `data`

## CLI команды

```bash
hod init [--dir ./tasks]                    # Инициализация проекта
hod add --title "Задача" [options]          # Создать задачу
hod list [--json] [--tree] [--status val]   # Список задач
hod get <id> [options]                      # Получить задачу
hod update <id> [options]                   # Обновить задачу
hod move <id> --parent <id>                 # Переместить задачу
hod delete <id> [--recursive]               # Удалить задачу
```

**Динамические опции полей:**
- Опции для кастомных полей генерируются из `hod.config.yml`
- Формат: `--field-name` (kebab-case) → markdown ключ `FieldName`
- Пример: конфиг `Title: {name: title}` → CLI `--title "Value"`

## Общие паттерны

### Ошибки
- Кастомные классы для каждого модуля
- `cause` для технических деталей
- Русские сообщения для пользователя

### Валидация ID
- Regex: `^\d+(\.\d+)*$`
- Максимум 50 символов
- Path traversal защита через regex

### Атомарные операции
```ts
const tempPath = `${targetPath}.tmp`;
await fs.unlink(tempPath).catch(() => {});
await fs.writeFile(tempPath, content);
await fs.rename(tempPath, targetPath);  // atomic on POSIX
```

### Платформа
- **POSIX-only** в v1 (atomic rename для Storage и Index)
- UTF-8 encoding
- Логирования нет в v1
- Target: Node.js 18+

### Подзадачи
- ID формата `1.2`, `1.2.3` и т.д.
- `--parent <id>` создает подзадачу автоматически
- `hod move <id> --parent <new>` перемещает подзадачу
- `utils/subtasks.ts` содержит `generateSubtaskId()` для генерации ID

## Реализованные модули

- **Config** — загрузка из YAML с дефолтами, zod валидация
- **Storage** — файловый CRUD, атомарные операции, POSIX-only
- **Parser** — markdown → ParsedTask, поддержка кастомных полей
- **Index** — зависимости в JSON, цикловая детекция, getNextTasks()
- **Formatters** — TaskData → markdown генератор
- **CLI** — add, list, get, update, delete, move, init с динамическими опциями

## Тестирование

- **Vitest** + **memfs** для filesystem операций
- Интеграционные тесты: `*.integration.test.ts`
- Все модули тестируемы через внедрение `fs` параметра
- `createServices()` в `cli/services.ts` — DI контейнер для CLI команд

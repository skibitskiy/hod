# HOD — Задачник для Markdown

Утилита для управления задачами в текстовом виде (Markdown) с поддержкой подзадач и зависимостей.

## Архитектура

```
src/
├── config/           # Задача 2 ✓
│   └── config.ts     # Конфигурация из YAML
├── storage/          # Задача 3 ✓
│   └── storage.ts    # CRUD для файлов задач
├── parser/           # Задача 4 ✓
│   └── parser.ts     # Markdown парсер
├── index/            # Задача 13
│   └── index.ts      # Индекс зависимостей
└── cli/              # Задачи 5-9, 12
    └── cli.ts        # CLI команды
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

# Status
pending

# Dependencies
1, 2, 5
```

- `# Title` — обязателен
- `# Dependencies` — всегда присутствует (пустой если `[]`)
- `# Description`, `# Status` — опциональны
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

**Формат:** только зависимости
```json
{
  "1": [],
  "1.1": ["1"],
  "2": ["1", "3"],
  "3": ["1", "2"]
}
```

- Хранит только `dependencies` для быстрого `hod next`
- Обновляется при каждом `add/update/delete`
- Пересобирается через `hod sync`

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
  status: string;
  dependencies: string[];
  [key: string]: string | string[] | undefined;
}

class ParseError extends Error {
  constructor(message: string, public section?: string);
}
```

- Любой `# ` начинает секцию
- Только `Dependencies` = `string[]`, остальные = `string`
- Пустой ввод → `ParseError`
- Trim значений, фильтрация пустых элементов

## CLI команды

```bash
hod add --Title "Задача" --Description "Описание"
hod list [--status pending] [--json]
hod update --id 1 --Status completed
hod delete --id 1 [--force]
hod init [--dir ./tasks]
hod next [--all]
hod sync
```

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
- **POSIX-only** в v1
- UTF-8 encoding
- Логирование нет в v1

## Зависимости задач

```json
{
  "1": [],              // init project
  "11": ["1"],          // vitest
  "10": ["11"],         // tests
  "2": ["1", "11"],     // config
  "13": ["2"],          // index ← следующий
  "3": ["2"],           // storage ✓
  "4": ["3"],           // parser ✓
  "5": ["4", "13"],     // cli add
  "6": ["4", "13"],     // cli list
  "7": ["5", "6"],      // subtasks
  "8": ["6"],           // cli update/delete
  "9": ["2"],           // cli init
  "12": ["13"]          // cli next
}
```

## Статус

- **Задача 2** (Config) — готова ✓
- **Задача 3** (Storage) — готова ✓
- **Задача 4** (Parser) — готова ✓
- **Задача 13** (Index) — следующая
- **Задачи 5-9, 12** (CLI) — ожидают 13

# HOD — AI Agent Guide

HOD is a CLI task manager that stores tasks as text files (JSON/Markdown) with support for subtasks and dependencies. This guide provides everything an AI agent needs to read, create, and update tasks.

---

## Setup

HOD requires a `hod.config.yml` file in the working directory. To initialize a new project:

```bash
hod init                   # creates hod.config.yml + ./tasks/
hod init --dir ./my-tasks  # custom tasks directory
```

The config file controls the tasks directory and which fields each task has.

---

## Configuration (`hod.config.yml`)

```yaml
tasksDir: ./tasks        # path relative to this config file
doneStatus: completed    # status set by `hod done` (default: "completed")
doneStatuses:            # statuses treated as "done" for dependency resolution
  - completed
  - cancelled
fields:
  Title:                 # markdown section key (PascalCase)
    name: title          # CLI flag name (--title)
    required: true
  Description:
    name: description    # --description
  Status:
    name: status
    default: pending
  Priority:
    name: priority       # --priority (custom field example)
```

**Rules:**
- `Title` field is always required
- `Status` and `Dependencies` are stored in the index file, not in the task file itself
- Any `fields` entry with a `name` becomes a `--<name>` CLI flag
- Field keys are PascalCase in config; CLI flags are the `name` value (kebab-case supported)

---

## Task IDs

- Format: `^\d+(\.\d+)*$` — integers separated by dots
- Examples: `1`, `2`, `1.1`, `1.2.3`, `10.5.2`
- Subtask IDs are nested under their parent: `1.1` is a subtask of `1`
- Maximum 50 characters
- IDs are assigned automatically on creation (sequential within the level)

---

## Task Storage

Tasks are stored as JSON files in `tasksDir`:
- `tasks/1.json`, `tasks/2.json`, `tasks/1.1.json`

The index file `tasks/.hod/index.json` stores status and dependencies for every task:
```json
{
  "1": { "status": "pending", "dependencies": [] },
  "1.1": { "status": "completed", "dependencies": ["1"] },
  "2": { "status": "pending", "dependencies": ["1", "3"] }
}
```

---

## Commands Reference

### `hod add` — Create a task

```bash
hod add --title "Task title"
hod add --title "Task title" --description "Details"
hod add --title "Subtask" --parent 1          # creates task 1.1 (or next available)
hod add --title "Task" --dependencies 1,2,3   # comma-separated dependency IDs
hod add --title "Task" --status in-progress   # set initial status
hod add --title "Task" --priority high        # custom field (if in config)
```

**Output:** `✓ Задача создана: <id>`

---

### `hod list` — List tasks

```bash
hod list                          # all tasks, table format
hod list --json                   # JSON array output
hod list --tree                   # hierarchical tree view
hod list --status pending         # filter by any field value
hod list --status pending --json  # combine filters with output format
```

**JSON output format:**
```json
[
  {
    "id": "1",
    "title": "Task title",
    "status": "pending",
    "dependencies": [],
    "description": "optional"
  }
]
```

---

### `hod get` — Retrieve a task

```bash
hod get 1                   # full task details (table format)
hod get 1 --json            # full task as JSON
hod get 1 --markdown        # raw markdown representation
hod get 1 --title           # only the title value
hod get 1 --status          # only the status value
hod get 1 --dependencies    # only the dependencies list
```

**JSON output format:**
```json
{
  "id": "1",
  "title": "Task title",
  "status": "pending",
  "dependencies": ["2", "3"],
  "description": "optional text",
  "priority": "high"
}
```

---

### `hod update` — Update task fields

```bash
hod update 1 --title "New title"
hod update 1 --description "New description"
hod update 1 --status in-progress
hod update 1 --dependencies 2,3,4    # replaces all dependencies
hod update 1 --dependencies ""       # clears all dependencies
hod update 1 --description ""        # removes optional field
```

**Output:** `✓ Задача <id> обновлена`

> **Note:** `--dependencies` in `update` **replaces** the entire dependency list. Use `hod dependency` to add/remove individual dependencies.

---

### `hod dependency` — Manage dependencies incrementally

```bash
hod dependency 2 --add 1            # add task 1 as a dependency of task 2
hod dependency 2 --add 1 3 4        # add multiple dependencies (space-separated)
hod dependency 2 --delete 5         # remove dependency 5
hod dependency 2 --add 1 3 --delete 5  # add and remove in one call
```

- At least one of `--add` or `--delete` is required
- Adding an already-existing dependency is a no-op (no error, no duplicate)
- Deleting a non-existent dependency is a no-op
- Circular dependency detection is enforced

**Output:** `✓ Зависимости задачи <id> обновлены (добавлены: 1, 3; удалены: 5)`

---

### `hod done` — Mark task as completed

```bash
hod done 1       # sets status to configured doneStatus (default: "completed")
hod done 1.2     # works with subtasks
```

**Output:** `✓ Задача <id> выполнена`

> If the task is already done, outputs a warning but does not error.

---

### `hod next` — Show tasks ready to work on

```bash
hod next                        # show the single highest-priority ready task
hod next --all                  # show all tasks with all dependencies completed
hod next --all --limit 3        # show at most 3 ready tasks
hod next --json                 # JSON array output
hod next --title                # show only title for each ready task
hod next --status               # show only status for each ready task
hod next --dependencies         # show only dependencies for each ready task
hod next --title --status       # combine field flags (shows both fields)
hod next --all --title --json   # combine with --all and --json
```

A task is "ready" when:
1. Its status is not in `doneStatuses`
2. All of its dependencies have a "done" status
3. It has no pending subtasks

**Field flags:** Pass any combination of `--title`, `--status`, `--dependencies`, or any custom field from config to show only those fields. Without field flags, all fields are shown.

**`--limit <n>`** limits the number of tasks returned by `--all`. Without `--all`, it has no effect.

**Output (default, same format as `hod get`):**
```
ID: 1.2
Title: Task title
Status: pending
```

**Output with `--title --status`:**
```
ID: 1.2
Title: Task title
Status: pending
---
ID: 2
Title: Another task
Status: pending
```

---

### `hod append` — Append to task fields

```bash
hod append 1 --description "Additional notes"   # appends with \n separator
hod append 1 --title "More context"             # appends to title
```

- Cannot append to `Status` or `Dependencies` (use `hod update`/`hod dependency`)
- If the field is empty, sets the value directly (no leading newline)

**Output:** `✓ Задача <id> обновлена`

---

### `hod delete` — Delete a task

```bash
hod delete 1            # delete task (fails if it has subtasks)
hod delete 1 --recursive  # delete task and all subtasks
```

**Output:** `✓ Задача <id> удалена`

---

### `hod move` — Move a task under a new parent

```bash
hod move 1.2 --parent 3    # move task 1.2 to become a subtask of task 3
hod move 1.2 --parent ""   # promote to top-level task
```

**Output:** `✓ Задача 1.2 перемещена в 3.1`

---

### `hod migrate` — Convert task file from Markdown to JSON

```bash
hod migrate 1              # converts tasks/1.md → tasks/1.json (in-place)
hod migrate 1 --stdout     # print JSON to stdout
hod migrate 1 -o out.json  # write to specific file
hod migrate 1 --force      # overwrite if already JSON
```

---

### `hod md` — Convert task file from JSON to Markdown

```bash
hod md 1              # converts tasks/1.json → tasks/1.md (stdout by default)
hod md 1 -o out.md    # write to specific file
hod md 1 --stdout     # explicit stdout
```

---

## Common Workflows

### Creating a task with dependencies

```bash
# Create parent tasks
hod add --title "Design API"
# → created: 1

hod add --title "Implement API"
# → created: 2

# Create a task that depends on both
hod add --title "Write API docs" --dependencies 1,2
# → created: 3

# Check what's ready to work on
hod next --all
# → 1, 2 (no pending deps)
```

### Working through tasks in order

```bash
hod next               # see what to work on first
hod done 1             # complete it
hod next               # next task now unblocked
```

### Managing a feature with subtasks

```bash
hod add --title "Implement login feature"
# → created: 5

hod add --title "Create login form" --parent 5
# → created: 5.1

hod add --title "Implement auth logic" --parent 5
# → created: 5.2

hod add --title "Write tests" --parent 5 --dependencies 5.1,5.2
# → created: 5.3

hod next --all
# → 5.1, 5.2 (no deps, no pending subtasks blocking them)

hod done 5.1
hod done 5.2
hod next
# → 5.3 (now unblocked)
```

### Updating dependencies without losing existing ones

```bash
# Task 2 currently depends on [1, 3]
hod dependency 2 --add 4 5    # now depends on [1, 3, 4, 5]
hod dependency 2 --delete 3   # now depends on [1, 4, 5]
```

---

## Output Conventions

- CLI output is in Russian (user-facing messages)
- `--json` flag is available on `list`, `get`, `next` for machine-readable output
- Error messages are printed to stderr; process exits with code 1 on error
- Success messages are printed to stdout

---

## Error Cases

| Situation | Error |
|---|---|
| Task ID not found | `StorageNotFoundError` |
| Invalid ID format | validation error (must match `^\d+(\.\d+)*$`) |
| Circular dependency | `CircularDependencyError` with cycle path |
| Required field empty | field cannot be empty error |
| `hod dependency` with no flags | must specify `--add` or `--delete` |
| `hod delete` with subtasks (no `--recursive`) | error listing subtask IDs |

---

## Commit Message Convention

Commit messages follow this format:

```
<type>(<scope>): <subject in Russian>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

**Rules:**
- Subject in **Russian**, imperative mood (повелительное наклонение)
- No capital letter at the start of subject
- No period at the end
- Max 72 characters in subject

**Examples:**
```
feat(cli): добавить команду dependency
fix(index): исправить обнаружение циклических зависимостей
test(commands): добавить тесты для команды done
docs: обновить список CLI команд в CLAUDE.md
refactor(storage): упростить атомарную запись файлов
```

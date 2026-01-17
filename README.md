# HOD — Markdown-based Task Manager

A CLI tool for managing tasks in Markdown format with support for subtasks and dependencies.

## Features

- **Markdown-based**: Tasks stored as human-readable `.md` files
- **Subtasks**: Hierarchical task organization (e.g., `1`, `1.1`, `1.1.1`)
- **Dependencies**: Track task dependencies with cycle detection
- **Fast**: Efficient index-based queries
- **Configurable**: Customize task fields via YAML config

## Installation

### Global (recommended)
```bash
npm install -g hod
```

### Via npx (no installation)
```bash
npx hod add --title "My task"
```

## Quick Start

```bash
# Initialize in current directory
hod init

# Add a task
hod add --title "Build feature" --description "Implement the core feature"

# List all tasks
hod list

# Update a task
hod update 1 --status completed

# Add a subtask
hod add --title "Write tests" --parent 1

# Show next available tasks
hod next
```

## Commands

### `hod init [--dir ./tasks]`
Initialize a new HOD project. Creates `hod.config.yml` and tasks directory.

### `hod add`
Create a new task.

**Options:**
- `--title <value>` (required): Task title
- `--description <value>`: Task description
- `--status <value>`: Task status (default: "pending")
- `--dependencies <ids>`: Comma-separated dependency IDs (e.g., "1,2,3")
- `--parent <id>`: Parent task ID (creates subtask)

**Example:**
```bash
hod add --title "Fix bug" --description "Fix login issue" --status "in-progress" --dependencies "1,2"
```

### `hod list`
Display all tasks.

**Options:**
- `--json`: Output in JSON format
- `--tree`: Show as hierarchical tree
- `--status <value>`: Filter by status

**Examples:**
```bash
hod list
hod list --tree
hod list --status pending
hod list --json
```

### `hod update <id>`
Update an existing task.

**Options:**
- Same as `hod add` plus `<id>` positional argument

**Example:**
```bash
hod update 1 --status completed
hod update 2 --description "New description"
```

### `hod delete <id>`
Delete a task.

**Options:**
- `-f, --force`: Delete without confirmation

**Example:**
```bash
hod delete 1
hod delete 1 --force
```

### `hod move <id> --parent <id>`
Move task under different parent.

**Options:**
- `--parent <id>` (required): New parent ID (empty for root level)

**Example:**
```bash
# Move task 2.1 to be a child of task 3
hod move 2.1 --parent 3
```

### `hod next`
Show next available tasks (all dependencies completed).

**Options:**
- `--all`: Show all ready tasks (not just first)

**Example:**
```bash
hod next
hod next --all
```

### `hod sync`
Rebuild the dependency index from task files. Run this if you manually edit task files.

## Configuration

Create `hod.config.yml` in your project root:

```yaml
tasksDir: ./tasks  # Directory for task files
fields:
  Title:
    name: title
    required: true
  Description:
    name: description
  Status:
    name: status
    default: pending
  Priority:  # Custom field
    name: priority
```

## Task File Format

Tasks are stored as `{tasksDir}/{id}.md`:

```markdown
# Title
Build feature

# Description
Implement the core feature with tests

# Priority
high
```

**Note:** `Status` and `Dependencies` are stored in the index (`tasks/.hod/index.json`), not in the markdown files.

## Project Structure

```
your-project/
├── hod.config.yml    # HOD configuration
├── tasks/
│   ├── .hod/
│   │   └── index.json  # Dependency index
│   ├── 1.md           # Task files
│   ├── 2.md
│   └── 1.1.md         # Subtask
```

## Development

```bash
git clone https://github.com/yourusername/hod.git
cd hod
npm install
npm run build
npm link
```

## License

ISC

```yaml
name: task-management
description: Guide for HOD CLI - a Markdown-based task manager with subtasks and dependencies. Use this skill when working with tasks, managing TODOs, or organizing development work in projects that use HOD.
```

# HOD — Markdown-based Task Manager

HOD is a CLI tool for managing tasks stored as Markdown files with support for hierarchical subtasks and dependency tracking.

## When to Use HOD

- Managing development tasks, bugs, or features
- Planning projects with dependencies between tasks
- Organizing work with hierarchical breakdown (main tasks → subtasks)
- Tracking task status and dependencies
- Maintaining human-readable task files in version control

## Quick Reference

```bash
# Initialize project
hod init [--dir ./tasks]

# Create tasks
hod add --title "Task name" --description "Details"
hod add --title "Subtask" --parent 1                    # Creates 1.1
hod add --title "With deps" --dependencies "1,2"        # Depends on tasks 1 and 2

# View tasks
hod list                                                # All tasks
hod list --tree                                         # Hierarchical view
hod list --status pending                               # Filter by status
hod list --json                                         # JSON output
hod get 1                                               # Get single task

# Modify tasks
hod update 1 --status completed                         # Change status
hod update 2 --description "New description"            # Update field
hod move 2.1 --parent 3                                 # Reassign parent
hod delete 1 --recursive                                # Delete with subtasks
```

## Task Format

**Files:** `{tasksDir}/{id}.md` (e.g., `1.md`, `1.1.md`, `2.5.md`)

**ID format:** `^\d+(\.\d+)*$` — numbers with dots for subtasks

**Markdown structure:**
```markdown
# Title
Task name

# Description
Details...

# CustomField
Custom value
```

**Status and Dependencies** are stored in `tasks/.hod/index.json`, not in markdown files.

## Project Structure

```
your-project/
├── hod.config.yml          # HOD configuration
├── tasks/
│   ├── .hod/
│   │   └── index.json      # Status + dependencies index
│   ├── 1.md               # Task files
│   ├── 2.md
│   └── 1.1.md             # Subtask
```

## Key Concepts

### Subtasks
- IDs like `1.1`, `1.1.1` indicate hierarchy
- `--parent <id>` automatically generates subtask ID
- Move subtasks with `hod move <id> --parent <new>`

### Dependencies
- Specified during creation: `--dependencies "1,2,3"`
- Stored separately in index for fast queries
- Prevents circular dependencies
- Use when tasks must be completed in specific order

### Dynamic Fields
- Custom fields defined in `hod.config.yml`
- Format: `--field-name` maps to `# FieldName` in markdown
- Example: `--priority "high"` → `# Priority\nhigh`

## Configuration (hod.config.yml)

```yaml
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
  Description:
    name: description
  Priority:
    name: priority
  Status:
    name: status
    default: pending
```

---

## Detailed Command Examples

### Example 1: Project Initialization

```bash
$ hod init --dir ./tasks
```

**Creates:**
```
./hod.config.yml
./tasks/.hod/index.json
```

**hod.config.yml:**
```yaml
tasksDir: ./tasks
fields:
  Title:
    name: title
    required: true
  Description:
    name: description
  Status:
    name: status
    default: pending
```

---

### Example 2: Creating Tasks with Hierarchy

```bash
# Create main task
$ hod add --title "Implement authentication" --description "Add login and logout functionality"

# Create subtasks
$ hod add --title "Design login form" --parent 1 --priority high
$ hod add --title "Implement JWT tokens" --parent 1 --priority high
$ hod add --title "Add session management" --parent 1 --priority medium
```

**Resulting files:**
```
tasks/
├── 1.md
├── 1.1.md
├── 1.2.md
└── 1.3.md
```

**tasks/1.md:**
```markdown
# Title
Implement authentication

# Description
Add login and logout functionality
```

**tasks/1.1.md:**
```markdown
# Title
Design login form

# Priority
high
```

---

### Example 3: Listing Tasks

```bash
$ hod list
```

**Output:**
```
ID     Title                                Status
1      Implement authentication             pending
1.1    Design login form                    pending
1.2    Implement JWT tokens                 pending
1.3    Add session management               pending
```

```bash
$ hod list --tree
```

**Output:**
```
1: Implement authentication (pending)
├── 1.1: Design login form (pending)
├── 1.2: Implement JWT tokens (pending)
└── 1.3: Add session management (pending)
```

```bash
$ hod list --status pending --json
```

**Output:**
```json
[
  {"id": "1", "title": "Implement authentication", "status": "pending"},
  {"id": "1.1", "title": "Design login form", "status": "pending"},
  {"id": "1.2", "title": "Implement JWT tokens", "status": "pending"},
  {"id": "1.3", "title": "Add session management", "status": "pending"}
]
```

---

### Example 4: Tasks with Dependencies

```bash
# Create independent tasks first
$ hod add --title "Setup database schema"
$ hod add --title "Create ORM models"

# Create dependent tasks
$ hod add --title "Build user API" --dependencies "1,2"
$ hod add --title "Add authentication" --dependencies "1,3"
$ hod add --title "Write tests" --dependencies "3,4"
```

**tasks/.hod/index.json:**
```json
{
  "1": {"status": "pending", "dependencies": []},
  "2": {"status": "pending", "dependencies": []},
  "3": {"status": "pending", "dependencies": ["1", "2"]},
  "4": {"status": "pending", "dependencies": ["1", "3"]},
  "5": {"status": "pending", "dependencies": ["3", "4"]}
}
```

---

### Example 5: Getting a Specific Task

```bash
$ hod get 1.2
```

**Output:**
```
ID: 1.2
Title: Implement JWT tokens

# Priority
high
```

```bash
$ hod get 1 --json
```

**Output:**
```json
{
  "id": "1",
  "title": "Implement authentication",
  "description": "Add login and logout functionality",
  "status": "pending",
  "dependencies": []
}
```

---

### Example 6: Updating Tasks

```bash
# Mark task as in progress
$ hod update 1 --status in-progress

# Mark subtask as completed
$ hod update 1.1 --status completed

# Update description
$ hod update 1 --description "Add login, logout, and password reset functionality"

# Update multiple fields
$ hod update 1.2 --priority urgent --status in-progress
```

---

### Example 7: Moving Subtasks

```bash
# Move subtask 1.3 to become child of 2 (reassigns ID)
$ hod move 1.3 --parent 2
```

**Before:**
```
1: Implement authentication
└── 1.3: Add session management
2: Setup database schema
```

**After:**
```
1: Implement authentication
2: Setup database schema
└── 2.1: Add session management
```

---

### Example 8: Deleting Tasks

```bash
# Delete single task (fails if has subtasks)
$ hod delete 1.1

# Delete with all subtasks
$ hod delete 1 --recursive
```

---

## Common Patterns

### Feature Breakdown Workflow

```bash
# 1. Create epic
hod add --title "User Management" --description "CRUD operations for users"

# 2. Break down into stories
hod add --title "Create user" --parent 1 --priority high
hod add --title "Read user" --parent 1 --priority high
hod add --title "Update user" --parent 1 --priority medium
hod add --title "Delete user" --parent 1 --priority medium

# 3. Add technical subtasks
hod add --title "Design database schema" --parent 1.1
hod add --title "Implement API endpoint" --parent 1.1
hod add --title "Add input validation" --parent 1.1
hod add --title "Write unit tests" --parent 1.1

# 4. Review hierarchy
hod list --tree
```

### Dependent Tasks Workflow

```bash
# Create sequential tasks
hod add --title "Design database schema" --priority high
hod add --title "Implement migrations" --dependencies "1" --priority high
hod add --title "Create base models" --dependencies "2" --priority high
hod add --title "Implement repositories" --dependencies "3" --priority medium
hod add --title "Build API endpoints" --dependencies "4" --priority medium
hod add --title "Add integration tests" --dependencies "5" --priority low

# Check what can be started (no dependencies)
hod list --status pending

# Work on task 1, mark complete
hod update 1 --status completed

# Now task 2 is unblocked
hod get 2
```

### Sprint Planning Workflow

```bash
# Create sprint tasks
hod add --title "Sprint 1: Auth Module" --description "Implement complete authentication"
hod add --title "Login form" --parent 1 --priority high
hod add --title "Registration flow" --parent 1 --priority high
hod add --title "Password reset" --parent 1 --priority medium

# Start work
hod update 1.1 --status in-progress

# Track progress
hod list --tree --status pending,in-progress
hod list --status completed
```

---

## Development Commands

When working on HOD itself:
- `npm run build` - Build CLI to `dist/`
- `npm run dev:link` - Build and npm link for local testing
- `npm test` - Run all tests
- `npm run test:ui` - Vitest UI
- `npm run lint:fix` - Format code with ESLint + Prettier
- `npm run typecheck` - TypeScript type checking

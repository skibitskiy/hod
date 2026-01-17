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

# View tasks
hod list                                                # All tasks
hod list --tree                                         # Hierarchical view
hod list --status pending                               # Filter by status
hod get 1                                               # Get single task

# Modify tasks
hod update 1 --status completed                         # Change status
hod move 2.1 --parent 3                                 # Reassign parent
hod delete 1 --recursive                                # Delete with subtasks

# Dependencies (stored in index, not markdown)
# Use --dependencies when creating: hod add --title "X" --dependencies "1,2"
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
```

## Common Patterns

### Feature breakdown
```bash
hod add --title "Implement auth" --description "Add login/logout"
hod add --title "Add login form" --parent 1
hod add --title "Add token storage" --parent 1
```

### Dependent tasks
```bash
hod add --title "Setup DB"
hod add --title "Migrate schema" --dependencies "1"
hod add --title "Seed data" --dependencies "1,2"
```

### Workflow
```bash
hod list --status pending      # See what to work on
hod update 3 --status "in-progress"
hod update 3 --status completed
hod list --tree               # Review progress
```

## Development Commands

When working on HOD itself:
- `npm run build` - Build CLI
- `npm run dev:link` - Test locally
- `npm test` - Run tests
- `npm run lint:fix` - Format code

import type { ParsedTask } from '../parser/types.js';

/**
 * Tree node representation.
 * Each node contains a task with minimal fields and its children.
 */
export interface TreeNode {
  task: { id: string; title: string; status: string };
  children: TreeNode[];
}

/**
 * Result of tree building with warnings for malformed IDs.
 */
export interface TreeBuildResult {
  tree: TreeNode[];
  warnings: string[];
}

/**
 * Builds a hierarchical tree structure from a flat list of tasks.
 * Filters out tasks with malformed IDs and collects warnings.
 * Orphaned subtasks (whose parent doesn't exist) are placed at root level.
 *
 * @param tasks - Array of tasks with their IDs and parsed content
 * @param indexData - Index data containing status and dependencies for each task
 * @returns Tree structure with root nodes and any warnings
 */
export function buildTree(
  tasks: Array<{ id: string; task: ParsedTask }>,
  indexData?: Record<string, { status: string; dependencies: string[] }>,
): TreeBuildResult {
  const warnings: string[] = [];

  // Pre-filter: validate IDs before tree building
  const validTasks = tasks.filter(({ id }) => {
    // Skip malformed IDs (data consistency issue)
    if (!/^\d+(\.\d+)*$/.test(id)) {
      warnings.push(
        `Предупреждение: задача с невалидным ID '${id}' пропущена при построении дерева`,
      );
      return false;
    }
    return true;
  });

  const map = new Map<string, TreeNode[]>();
  const rootTasks: TreeNode[] = [];
  const existingIds = new Set<string>();

  for (const { id, task } of validTasks) {
    // Get status from index (with fallback to 'pending' if not in index)
    const status = indexData?.[id]?.status ?? 'pending';

    const node = {
      task: { id, title: task.title, status },
      children: [],
    };

    existingIds.add(id);

    if (!id.includes('.')) {
      rootTasks.push(node);
    } else {
      const parentId = id.substring(0, id.lastIndexOf('.'));
      if (!map.has(parentId)) {
        map.set(parentId, []);
      }
      map.get(parentId)!.push(node);
    }
  }

  function attachChildren(nodes: TreeNode[]): TreeNode[] {
    for (const node of nodes) {
      const children = map.get(node.task.id) || [];
      node.children = attachChildren(children);
    }
    return nodes;
  }

  // Attach children to existing nodes
  const tree = attachChildren(rootTasks);

  // Add orphaned subtasks (children whose parent doesn't exist) to root level
  for (const [parentId, children] of map.entries()) {
    if (!existingIds.has(parentId)) {
      // Parent doesn't exist, add children to root
      tree.push(...children);
    }
  }

  return {
    tree,
    warnings,
  };
}

/**
 * Formats a tree structure as text with box-drawing characters.
 *
 * @param nodes - Tree nodes to format
 * @param prefix - Current line prefix (for recursion)
 * @param _isLast - Whether current node is the last sibling (unused)
 * @returns Formatted tree string
 */
export function formatTree(nodes: TreeNode[], prefix = ''): string {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLastChild = i === nodes.length - 1;

    // Choose connector based on position
    const connector = isLastChild ? '└──' : '├──';
    const childPrefix = prefix + (isLastChild ? '   ' : '│  ');

    // Format: ID status title
    const line =
      prefix + connector + node.task.id + '  ' + node.task.status + '    ' + node.task.title;
    lines.push(line);

    // Recursively format children
    if (node.children.length > 0) {
      const childrenStr = formatTree(node.children, childPrefix);
      if (childrenStr) {
        lines.push(childrenStr);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Detects orphaned subtasks (subtasks whose parent doesn't exist in the tree).
 * Orphaned subtasks are those with IDs containing dots whose parent ID doesn't exist.
 *
 * @param nodes - Tree nodes to check
 * @returns Array of orphaned task IDs
 */
export function detectOrphans(nodes: TreeNode[]): string[] {
  const orphans: string[] = [];
  const existingIds = new Set<string>();

  // Collect all IDs that exist in the tree
  function collectIds(nodes: TreeNode[]): void {
    for (const node of nodes) {
      existingIds.add(node.task.id);
      collectIds(node.children);
    }
  }
  collectIds(nodes);

  // Check for orphaned subtasks at any level
  function checkOrphans(nodes: TreeNode[]): void {
    for (const node of nodes) {
      const nodeId = node.task.id;
      // If this is a subtask (contains dot), check if parent exists
      if (nodeId.includes('.')) {
        const parentId = nodeId.substring(0, nodeId.lastIndexOf('.'));
        if (!existingIds.has(parentId)) {
          orphans.push(nodeId);
        }
      }
      // Recursively check children
      checkOrphans(node.children);
    }
  }
  checkOrphans(nodes);

  return orphans;
}

/**
 * Converts tree nodes to minimal JSON schema (id, title, status, children).
 *
 * @param nodes - Tree nodes to convert
 * @returns Array of JSON-serializable objects
 */
export function treeToJson(nodes: TreeNode[]): Array<Record<string, unknown>> {
  return nodes.map((node) => ({
    id: node.task.id,
    title: node.task.title,
    status: node.task.status,
    children: treeToJson(node.children),
  }));
}

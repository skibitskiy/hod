/**
 * Error thrown when parent task validation fails.
 * Used in the add command when --parent option is provided.
 */
export class ParentValidationError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'ParentValidationError';
  }
}

/**
 * Error thrown when a circular dependency is detected.
 * Used in the add command when a subtask depends on its parent.
 */
export class CircularDependencyError extends Error {
  /**
   * @param message - Human-readable error message
   * @param cycle - Array of task IDs forming the cycle
   */
  constructor(
    message: string,
    public cycle: string[],
  ) {
    super(message);
    this.name = 'CircularDependencyError';
  }
}

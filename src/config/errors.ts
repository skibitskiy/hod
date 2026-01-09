export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

export class ConfigValidationError extends Error {
  constructor(public issues: unknown[]) {
    super('Configuration validation failed');
    this.name = 'ConfigValidationError';
  }
}

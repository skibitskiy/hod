export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

export class ConfigNotFoundError extends Error {
  constructor() {
    super('Configuration file not found (hod.config.yml). Run "hod init" to create a new project.');
    this.name = 'ConfigNotFoundError';
  }
}

export class ConfigValidationError extends Error {
  constructor(public issues: unknown[]) {
    super('Configuration validation failed');
    this.name = 'ConfigValidationError';
  }
}

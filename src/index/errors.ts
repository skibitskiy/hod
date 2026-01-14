/**
 * Ошибка загрузки индекса.
 */
export class IndexLoadError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'IndexLoadError';
  }
}

/**
 * Ошибка записи индекса.
 */
export class IndexWriteError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'IndexWriteError';
  }
}

/**
 * Повреждение индекса (невалидный JSON).
 */
export class IndexCorruptionError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'IndexCorruptionError';
  }
}

/**
 * Ошибка валидации данных индекса.
 */
export class IndexValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexValidationError';
  }
}

/**
 * Обнаружена циклическая зависимость.
 */
export class CircularDependencyError extends Error {
  constructor(
    message: string,
    public cycle: string[],
  ) {
    super(message);
    this.name = 'CircularDependencyError';
  }
}

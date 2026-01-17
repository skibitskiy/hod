export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class StorageNotFoundError extends Error {
  constructor(
    id: string,
    public cause?: Error,
  ) {
    super(`Задача не найдена: ${id}`);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageWriteError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'StorageWriteError';
  }
}

export class StorageAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Задача уже существует: ${id}`);
    this.name = 'StorageAlreadyExistsError';
  }
}

export class StorageAccessError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'StorageAccessError';
  }
}

export class StorageParseError extends StorageError {
  constructor(
    message: string,
    public readonly fileId: string,
    public readonly parseMessage: string,
    public readonly position?: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'StorageParseError';
  }
}

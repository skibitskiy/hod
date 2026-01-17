/**
 * Базовый класс ошибок генератора markdown.
 */
export class GenerationError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

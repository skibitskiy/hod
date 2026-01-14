import { IndexValidationError } from '../index/errors.js';

/**
 * Regex для валидации ID: число или числа через точку
 */
export const ID_REGEX = /^\d+(\.\d+)*$/;

/**
 * Максимальная длина ID задачи
 */
export const MAX_ID_LENGTH = 50;

/**
 * Проверяет формат ID задачи.
 * @throws {IndexValidationError} при невалидном ID
 */
export function validateTaskId(id: string): void {
  if (id.length > MAX_ID_LENGTH) {
    throw new IndexValidationError(`ID задачи превышает максимальную длину ${MAX_ID_LENGTH} символов: ${id}`);
  }
  if (!ID_REGEX.test(id)) {
    throw new IndexValidationError(`Невалидный формат ID задачи: ${id}`);
  }
}

/**
 * Проверяет формат ID задачи без выбрасывания ошибки.
 * @returns true если ID валиден, иначе false
 */
export function isValidTaskId(id: string): boolean {
  if (id.length > MAX_ID_LENGTH) {
    return false;
  }
  return ID_REGEX.test(id);
}

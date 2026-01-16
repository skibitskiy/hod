import { describe, it, expect } from 'vitest';
import { ID_REGEX, MAX_ID_LENGTH, validateCliId } from './validation.js';

describe('validation utilities', () => {
  describe('ID_REGEX', () => {
    it('должен принимать валидные ID', () => {
      expect(ID_REGEX.test('1')).toBe(true);
      expect(ID_REGEX.test('123')).toBe(true);
      expect(ID_REGEX.test('1.1')).toBe(true);
      expect(ID_REGEX.test('1.2.3')).toBe(true);
      expect(ID_REGEX.test('10.20.30')).toBe(true);
    });

    it('должен отклонять невалидные ID', () => {
      expect(ID_REGEX.test('')).toBe(false);
      expect(ID_REGEX.test('abc')).toBe(false);
      expect(ID_REGEX.test('1a')).toBe(false);
      expect(ID_REGEX.test('.1')).toBe(false);
      expect(ID_REGEX.test('1.')).toBe(false);
      expect(ID_REGEX.test('1..1')).toBe(false);
      expect(ID_REGEX.test('1.1.1.')).toBe(false);
      // Note: '1.1.1.1.1.1.1.1.1.1' is valid format (multiple segments), rejected only by length check
    });
  });

  describe('MAX_ID_LENGTH', () => {
    it('должен быть равен 50', () => {
      expect(MAX_ID_LENGTH).toBe(50);
    });
  });

  describe('validateCliId', () => {
    it('должен принимать валидные ID', () => {
      expect(() => validateCliId('1')).not.toThrow();
      expect(() => validateCliId('123')).not.toThrow();
      expect(() => validateCliId('1.1')).not.toThrow();
      expect(() => validateCliId('1.2.3')).not.toThrow();
      expect(() => validateCliId('10.20.30')).not.toThrow();
    });

    it('должен выбрасывать ошибку для невалидного формата ID', () => {
      expect(() => validateCliId('')).toThrow("Невалидный формат ID: ''");
      expect(() => validateCliId('abc')).toThrow("Невалидный формат ID: 'abc'");
      expect(() => validateCliId('1a')).toThrow("Невалидный формат ID: '1a'");
      expect(() => validateCliId('.1')).toThrow("Невалидный формат ID: '.1'");
      expect(() => validateCliId('1.')).toThrow("Невалидный формат ID: '1.'");
      expect(() => validateCliId('1..1')).toThrow("Невалидный формат ID: '1..1'");
    });

    it('должен выбрасывать ошибку для ID превышающего MAX_ID_LENGTH', () => {
      // Create a 51-character ID
      const longId = '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1';
      expect(longId.length).toBeGreaterThan(50);

      expect(() => validateCliId(longId)).toThrow(
        `ID задачи превышает максимальную длину ${MAX_ID_LENGTH} символов: '${longId}'`,
      );
    });

    it('должен принимать ID равный MAX_ID_LENGTH', () => {
      // Create a 50-character ID: '1' repeated 50 times
      const maxLengthId = '1'.repeat(50);
      expect(maxLengthId.length).toBe(50);

      expect(() => validateCliId(maxLengthId)).not.toThrow();
    });

    it('должен проверять длину перед форматом', () => {
      // Если ID слишком длинный, проверка длины должна сработать первой
      const longInvalidId = 'a'.repeat(51); // 51 символов, невалидный формат

      expect(() => validateCliId(longInvalidId)).toThrow(
        `ID задачи превышает максимальную длину ${MAX_ID_LENGTH} символов: '${longInvalidId}'`,
      );
    });
  });
});

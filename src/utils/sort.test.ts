import { describe, it, expect } from 'vitest';
import { sortIds } from './sort.js';

describe('sortIds', () => {
  it('должен сортировать числовые ID', () => {
    const input = ['3', '1', '2'];
    const result = sortIds(input);

    expect(result).toEqual(['1', '2', '3']);
  });

  it('должен сортировать ID с точками (подзадачи)', () => {
    const input = ['2', '1.10', '1.2', '10', '1.1'];
    const result = sortIds(input);

    expect(result).toEqual(['1.1', '1.2', '1.10', '2', '10']);
  });

  it('не должен мутировать входной массив', () => {
    const input = ['3', '1', '2'];
    const originalOrder = [...input];

    sortIds(input);

    // Входной массив не должен измениться
    expect(input).toEqual(originalOrder);
  });

  it('должен возвращать новый массив (не ссылку на входной)', () => {
    const input = ['3', '1', '2'];
    const result = sortIds(input);

    // Результат должен быть новым массивом
    expect(result).not.toBe(input);
  });

  it('должен обрабатывать пустой массив', () => {
    const result = sortIds([]);

    expect(result).toEqual([]);
  });

  it('должен обрабатывать ID с разным количеством сегментов', () => {
    const input = ['1', '1.1', '1.1.1', '2'];
    const result = sortIds(input);

    expect(result).toEqual(['1', '1.1', '1.1.1', '2']);
  });
});

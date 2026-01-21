import type { TaskData } from '../types.js';
import type { IndexData } from '../index/types.js';
import { GenerationError } from './errors.js';

// Re-export for convenience
export { GenerationError };

/**
 * Standard fields that are handled specially.
 */
const STANDARD_FIELDS = ['title', 'description', 'dependencies', 'status'];

/**
 * Generate markdown from task data.
 *
 * Output format: flat markdown with # Key followed by value.
 * Field ordering: Title → Description → Dependencies → Custom (alphabetically)
 *
 * @param id - Task ID (used for Dependencies section if present in indexData)
 * @param data - Task data with title and optional fields
 * @param indexData - Optional index data for dependencies lookup
 * @returns Markdown string
 * @throws {GenerationError} If title is missing or empty
 * @throws {GenerationError} If a custom field value is not a string
 * @throws {GenerationError} If indexData has invalid structure (dependencies not an array of strings)
 */
export function generate(id: string, data: TaskData, indexData?: IndexData): string {
  const sections: string[] = [];

  // Validate required title field
  if (!data.title || data.title.trim() === '') {
    throw new GenerationError(`Отсутствует обязательное поле title для задачи ${id}`);
  }

  // Title section (always first, required)
  sections.push('# Title');
  sections.push(data.title.trim());
  sections.push('');

  // Description section (if present)
  if (data.description && data.description.trim() !== '') {
    sections.push('# Description');
    sections.push(data.description.trim());
    sections.push('');
  }

  // Dependencies section (from indexData, if present)
  // Note: dependencies are managed in index, this is just for display
  const indexEntry = indexData?.[id];
  if (indexEntry) {
    // Validate indexEntry structure
    if (
      !Array.isArray(indexEntry.dependencies) ||
      indexEntry.dependencies.some((d) => typeof d !== 'string')
    ) {
      throw new GenerationError(
        `Неверная структура индекса для задачи ${id}: dependencies должен быть массивом строк`,
      );
    }
    if (indexEntry.dependencies.length > 0) {
      sections.push('# Dependencies');
      sections.push(indexEntry.dependencies.join(', '));
      sections.push('');
    }
  }

  // Custom fields (sorted alphabetically by key)
  // Only include non-standard fields with non-empty values
  const customFields: Array<{ key: string; value: string }> = [];

  for (const [key, value] of Object.entries(data)) {
    // Skip standard fields
    if (STANDARD_FIELDS.includes(key)) continue;

    // Skip undefined values
    if (value === undefined) continue;

    // Validate that value is a string
    if (typeof value !== 'string') {
      throw new GenerationError(
        `Неверный тип поля ${key} для задачи ${id}: ожидается string, получено ${typeof value}`,
      );
    }

    // Skip empty values after type validation
    if (value === '' || value.trim() === '') continue;

    // Capitalize each segment: "test-strategy" -> "Test-Strategy"
    // Split by hyphens, capitalize each part, then join back
    const titleCaseKey = key
      .split('-')
      .map((part) => {
        if (part.length === 0) return '';
        const chars = Array.from(part);
        return chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase();
      })
      .join('-');

    customFields.push({
      key: titleCaseKey,
      value: value.trim(),
    });
  }

  // Output custom fields sorted by key
  customFields.sort((a, b) => a.key.localeCompare(b.key));
  for (const { key, value } of customFields) {
    sections.push(`# ${key}`);
    sections.push(value);
    sections.push('');
  }

  return sections.join('\n');
}

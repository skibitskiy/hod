/**
 * Данные задачи для генерации markdown.
 *
 * Note: title is semantically required and validated at runtime in the generator.
 * The index signature allows arbitrary custom fields, but TypeScript doesn't enforce
 * that title is non-undefined due to the string | undefined union.
 */
export interface TaskData {
  title: string;
  description?: string;
  [key: string]: string | undefined;
}

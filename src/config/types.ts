/** Default status value used when doneStatus is not configured */
export const DEFAULT_DONE_STATUS = 'completed';

export interface FieldConfig {
  name: string;
  required?: boolean;
  default?: string;
}

export interface Config {
  tasksDir: string;
  fields: Record<string, FieldConfig>;
  /** Status value to set when marking task as done */
  doneStatus?: string;
  /** Array of statuses considered "done" for filtering (e.g. in next command) */
  doneStatuses?: string[];
}

export interface ConfigService {
  load(path?: string): Promise<Config>;
  validate(config: Config): void;
  createDefault(tasksDir?: string): Promise<{ created: boolean; message: string }>;
}

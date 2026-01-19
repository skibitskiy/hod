export interface FieldConfig {
  name: string;
  required?: boolean;
  default?: string;
}

export interface Config {
  tasksDir: string;
  fields: Record<string, FieldConfig>;
  doneStatus?: string | string[];
}

export interface ConfigService {
  load(path?: string): Promise<Config>;
  validate(config: Config): void;
  createDefault(tasksDir?: string): Promise<{ created: boolean; message: string }>;
}

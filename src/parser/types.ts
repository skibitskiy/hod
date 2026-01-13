export interface ParsedTask {
  title: string;
  description?: string;
  status: string;
  dependencies: string[];
  [key: string]: string | string[] | undefined;
}

export class ParseError extends Error {
  constructor(
    message: string,
    public section?: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

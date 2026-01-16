export interface ParsedTask {
  title: string;
  description?: string;
  [key: string]: string | undefined;
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

/**
 * File I/O interface for dependency injection.
 * Used by migrate command for testing with memfs.
 */
export interface FileIO {
  readFile(path: string | URL, options: { encoding: BufferEncoding }): Promise<string>;
  writeFile(path: string | URL, data: string, options: { encoding: BufferEncoding }): Promise<void>;
  mkdir(path: string | URL, options: { recursive: boolean }): Promise<string | undefined>;
  rename(oldPath: string | URL, newPath: string | URL): Promise<void>;
  unlink?(path: string | URL): Promise<void>;
}

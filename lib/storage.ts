import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonFile<T>(relativePath: string, defaultValue: T): Promise<T> {
  const filePath = path.join(DATA_DIR, relativePath);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await ensureDir(path.dirname(filePath));
      await writeJsonFile(relativePath, defaultValue);
      return defaultValue;
    }
    throw error;
  }
}

export async function writeJsonFile<T>(relativePath: string, data: T): Promise<void> {
  const filePath = path.join(DATA_DIR, relativePath);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function listFiles(relativeDir: string): Promise<string[]> {
  const dirPath = path.join(DATA_DIR, relativeDir);
  try {
    await ensureDir(dirPath);
    const files = await fs.readdir(dirPath);
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function resolveDataPath(relativePath: string): string {
  return path.join(DATA_DIR, relativePath);
}

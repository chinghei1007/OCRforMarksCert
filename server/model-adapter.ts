import { randomUUID } from 'node:crypto';
import { demoFields } from './db';

export async function extractDocument(_storageKey: string) {
  await new Promise(resolve => setTimeout(resolve, 900));
  return demoFields.map(field => ({ ...field, id: randomUUID() }));
}

import type { ListOptions, OrderBy, Page, Stored, Where } from './types';

/**
 * In-memory evaluation of declarative queries. Used by the local provider and available
 * to remote providers as a fallback for operators their backend cannot run server-side.
 */

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

export function matchesWhere<T>(record: Stored<T>, where: Where<T>): boolean {
  const actual = (record as Record<string, unknown>)[where.field];
  switch (where.op) {
    case 'eq':
      return actual === where.value;
    case 'ne':
      return actual !== where.value;
    case 'in':
      return Array.isArray(where.value) && where.value.includes(actual);
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(where.value);
      return typeof actual === 'string' && typeof where.value === 'string'
        && actual.toLowerCase().includes(where.value.toLowerCase());
    case 'gt':
      return compare(actual, where.value) > 0;
    case 'gte':
      return compare(actual, where.value) >= 0;
    case 'lt':
      return compare(actual, where.value) < 0;
    case 'lte':
      return compare(actual, where.value) <= 0;
  }
}

export function sortRecords<T>(records: Stored<T>[], orderBy: OrderBy<T>[]): Stored<T>[] {
  if (orderBy.length === 0) return records;
  return [...records].sort((a, b) => {
    for (const { field, direction } of orderBy) {
      const result = compare(
        (a as Record<string, unknown>)[field],
        (b as Record<string, unknown>)[field],
      );
      if (result !== 0) return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

export const DEFAULT_PAGE_SIZE = 100;

export function queryRecords<T>(records: Stored<T>[], options: ListOptions<T> = {}): Page<T> {
  const where = options.where ?? [];
  const filtered = records.filter((record) => where.every((clause) => matchesWhere(record, clause)));
  const sorted = sortRecords(filtered, options.orderBy ?? [{ field: 'createdAt' }]);
  const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
  const limit = Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE);
  const items = sorted.slice(offset, offset + limit);
  const next = offset + limit;
  return next < sorted.length ? { items, nextCursor: String(next) } : { items };
}

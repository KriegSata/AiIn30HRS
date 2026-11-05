import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Queryable } from './database.js';
import type { Role } from '../../../contracts/domain.js';

export class ApiFault extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) { super(message); }
}
export function requireThat(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new ApiFault(status, code, message);
}
export interface Actor { id: string; email: string; name: string; role: Role; organizationId: string; sessionId: string }
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const scryptAsync = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt);
  return `scrypt$16384$${salt}$${key.toString('hex')}`;
}
export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, cost, salt, encoded] = stored.split('$');
  if (algorithm !== 'scrypt' || cost !== '16384' || !salt || !encoded || encoded.length !== 128) return false;
  const key = await scryptAsync(password, salt);
  return timingSafeEqual(key, Buffer.from(encoded, 'hex'));
}
export function units(value: string, allowNegative = false): bigint {
  requireThat(typeof value === 'string' && (allowNegative ? /^-?(0|[1-9]\d{0,6})(\.\d{1,3})?$/ : /^(0|[1-9]\d{0,6})(\.\d{1,3})?$/).test(value), 400, 'INVALID_QUANTITY', 'Quantity must be a decimal string with at most three decimal places.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const amount = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  requireThat(amount <= 1_000_000_000n && (allowNegative || amount > 0n), 422, 'INVALID_QUANTITY', 'Quantity must be positive and at most 1,000,000.');
  return negative ? -amount : amount;
}
export const decimal = (amount: bigint) => `${amount / 1000n}.${(amount % 1000n).toString().padStart(3, '0')}`;
export const money = (quantity: string, price: number) => {
  const amount = (units(quantity) * BigInt(price) + 500n) / 1000n;
  requireThat(amount > 0n && amount <= 100_000_000_000_000n, 422, 'INVALID_TOTAL', 'Order amount is outside supported bounds.');
  return Number(amount);
};
export const iso = (value: any): string => new Date(value).toISOString();
export const nullableIso = (value: any) => value ? iso(value) : null;
export const location = (r: any, prefix = '') => ({ label: r[`${prefix}label`], latitude: Number(r[`${prefix}latitude`]), longitude: Number(r[`${prefix}longitude`]) });
export const coarse = (p: any) => ({ ...p, latitude: Math.round(p.latitude * 10) / 10, longitude: Math.round(p.longitude * 10) / 10 });
export async function one(db: Queryable, sql: string, params: unknown[] = []): Promise<any> { return (await db.query(sql, params)).rows[0]; }
export function role(actor: Actor, ...roles: Role[]) { requireThat(roles.includes(actor.role), 403, 'FORBIDDEN', 'Your role cannot perform this action.'); }
export function version(row: any, expected: number) { requireThat(row.version === expected, 409, 'VERSION_CONFLICT', 'This record changed. Refresh before trying again.'); }
export function found<T>(row: T | undefined): T { requireThat(row, 404, 'NOT_FOUND', 'This resource is not available.'); return row; }
export function future(value: string) { requireThat(Date.parse(value) > Date.now(), 422, 'INVALID_DATE', 'The date must be in the future.'); }
export function page(query: any) {
  const pageNumber = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 20);
  requireThat(Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100000 && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100, 400, 'INVALID_PAGE', 'Page and pageSize are outside supported limits.');
  return { page: pageNumber, pageSize };
}
export function paginate<T>(rows: T[], query: any) { const p = page(query); return { data: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize), meta: { ...p, total: rows.length } }; }
export function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

const specification = JSON.parse(readFileSync(resolve('contracts/openapi.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'harvestlink', components: specification.components });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
const queryAjv = new Ajv({ strict: false, allErrors: true, coerceTypes: true });
const queryValidators = new Map<string, ReturnType<typeof queryAjv.compile>>();
export function validateQuery(operation: any, query: any) {
  let validator = queryValidators.get(operation.operationId);
  if (!validator) { validator = queryAjv.compile({ type: 'object', additionalProperties: false, properties: Object.fromEntries((operation.parameters ?? []).filter((p: any) => p.in === 'query').map((p: any) => [p.name, p.schema])) }); queryValidators.set(operation.operationId, validator); }
  requireThat(validator({ ...query }), 400, 'INVALID_QUERY', 'Search parameters are missing, invalid, or unsupported.');
}
export function validate(name: string, body: unknown) {
  let validator = validators.get(name);
  if (!validator) { validator = ajv.compile({ $ref: `harvestlink#/components/schemas/${name}` }); validators.set(name, validator); }
  if (!validator(body)) throw new ApiFault(400, 'VALIDATION_ERROR', 'Some fields are missing or invalid.', Object.fromEntries((validator.errors ?? []).map(e => [e.instancePath || 'request', [e.message ?? 'Invalid value']])));
}
export const spec = specification;

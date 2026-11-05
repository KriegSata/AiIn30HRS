import type { CreateOrderRequest, Order, User } from '../../../contracts/domain';
import { api, ApiFailure } from './api';
export interface PendingOrder { id: string; owner: string; label: string; body: CreateOrderRequest; createdAt: number; attempts: number; retryAt: number; status: 'pending' | 'conflict' | 'expired'; error?: string }
const ownerKey = (user: User) => `${user.organizationId}:${user.id}`;
function db(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open('harvestlink-private-drafts', 1); request.onupgradeneeded = () => { request.result.createObjectStore('orders', { keyPath: 'id' }); request.result.createObjectStore('drafts'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function transaction<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> { const database = await db(); return new Promise((resolve, reject) => { const tx = database.transaction(store, mode); const request = work(tx.objectStore(store)); tx.oncomplete = () => { database.close(); resolve(request.result); }; const failed = () => { database.close(); reject(tx.error || new Error('Local draft storage could not complete.')); }; tx.onerror = failed; tx.onabort = failed; }); }
export async function pendingOrders(user: User) { return (await transaction<PendingOrder[]>('orders', 'readonly', store => store.getAll())).filter(item => item.owner === ownerKey(user)); }
export async function enqueueOrder(user: User, body: CreateOrderRequest, label: string): Promise<PendingOrder> { const item: PendingOrder = { id: crypto.randomUUID(), owner: ownerKey(user), body, label, createdAt: Date.now(), attempts: 0, retryAt: 0, status: 'pending' }; await transaction('orders', 'readwrite', store => store.put(item)); return item; }
export async function discardOrder(id: string) { await transaction('orders', 'readwrite', store => store.delete(id)); }
let sending = false;
let generation = 0;
export async function drainOrders(user: User, success: (order: Order) => void): Promise<void> {
  if (sending || !navigator.onLine) return;
  sending = true; const currentGeneration = generation;
  try {
    for (const item of await pendingOrders(user)) {
      if (generation !== currentGeneration) break;
      if (item.status !== 'pending' || item.retryAt > Date.now()) continue;
      if (Date.now() - item.createdAt > 86400000) { item.status = 'expired'; item.error = 'This draft is over 24 hours old. Review current price and stock before placing a new order.'; await transaction('orders', 'readwrite', store => store.put(item)); continue; }
      try {
        const order = await api<Order>('/orders', { method: 'POST', body: item.body, key: item.id, expectedOwner: item.owner });
        await discardOrder(item.id); if (generation === currentGeneration) success(order);
      } catch (error) {
        if (generation !== currentGeneration) break;
        item.attempts += 1;
        if (error instanceof ApiFailure && [400, 403, 404, 409, 422].includes(error.status)) { item.status = 'conflict'; item.error = error.message; }
        else { item.error = error instanceof Error ? error.message : 'Waiting for a connection'; item.retryAt = Date.now() + Math.min(300000, 2000 * 2 ** Math.min(item.attempts, 7)); }
        await transaction('orders', 'readwrite', store => store.put(item));
        if (error instanceof ApiFailure && error.status === 401) break;
      }
    }
  } finally { sending = false; }
}
export async function clearPrivateData(user: User) { generation++; const items = await pendingOrders(user); for (const item of items) await discardOrder(item.id); await transaction('drafts', 'readwrite', store => store.delete(ownerKey(user))); }
export async function saveDraft(user: User, values: Record<string, string>) { await transaction('drafts', 'readwrite', store => store.put(values, ownerKey(user))); }
export async function readDraft(user: User) { return transaction<Record<string, string> | undefined>('drafts', 'readonly', store => store.get(ownerKey(user))); }

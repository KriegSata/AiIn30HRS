import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { AuthService, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import { ApiFault, type Actor, iso, requireThat, spec, validate, validateQuery } from './core.js';
import { Marketplace } from './marketplace.js';

class ApiModule {}
Module({})(ApiModule);
export interface ServerOptions extends AuthConfig { sandbox: boolean; port?: number; host?: string; jobs?: boolean }
export async function createServer(db: Database, options: ServerOptions) {
  const app = await NestFactory.create(ApiModule, { logger: false, bodyParser: false });
  const http = app.getHttpAdapter().getInstance() as express.Express;
  const auth = new AuthService(db, options), market = new Marketplace(db, auth, options.sandbox);
  http.disable('x-powered-by'); http.use(helmet());
  http.use((req, res, next) => {
    res.setHeader('X-Request-Id', randomUUID()); res.setHeader('Cache-Control', 'no-store');
    if (req.headers.origin === options.uiOrigin) { res.setHeader('Access-Control-Allow-Origin', options.uiOrigin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS'); }
    if (req.method === 'OPTIONS') { res.status(req.headers.origin === options.uiOrigin ? 204 : 403).end(); return; }
    next();
  });
  http.use(express.json({ limit: '128kb', strict: true })); http.use(cookieParser());
  const limits = new Map<string, { count: number; until: number }>();
  function throttle(req: Request, identity: string, cap: number) {
    const now = Date.now(), key = `${identity}:${req.ip}`, old = limits.get(key), row = old && old.until > now ? old : { count: 0, until: now + 60000 };
    row.count++; limits.set(key, row);
    if (limits.size > 10000) for (const [k, r] of limits) if (r.until < now) limits.delete(k);
    requireThat(row.count <= cap, 429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.');
  }
  const cookieName = spec.components.securitySchemes.refreshCookie.name;
  function cookie(res: Response, value: string) { res.cookie(cookieName, value, { httpOnly: true, secure: options.production, sameSite: 'lax', path: '/api/v1/auth', maxAge: 14 * 86400000 }); }
  function origin(req: Request) { requireThat(req.headers.origin === options.uiOrigin, 403, 'ORIGIN_DENIED', 'This browser origin is not allowed.'); }
  type Context = { req: Request; res: Response; actor: Actor; body: any; id: string; query: any; key: string | undefined };
  const handlers: Record<string, (c: Context) => Promise<any>> = {
    getHealth: async () => { let database = true; try { await db.query('SELECT 1'); } catch { database = false; } return { status: database ? 'ok' : 'degraded', version: spec.info.version, checks: { database, redis: false } }; },
    register: async c => { origin(c.req); const session = await auth.register(c.body); cookie(c.res, session.refreshToken); return session.data; },
    login: async c => { origin(c.req); const session = await auth.login(c.body); cookie(c.res, session.refreshToken); return session.data; },
    refresh: async c => { origin(c.req); const session = await auth.refresh(c.req.cookies[cookieName]); cookie(c.res, session.refreshToken); return session.data; },
    logout: async c => { origin(c.req); await auth.logout(c.req.cookies[cookieName]); c.res.clearCookie(cookieName, { path: '/api/v1/auth', httpOnly: true, secure: options.production, sameSite: 'lax' }); return { loggedOut: true }; },
    getMe: async c => auth.me(c.actor),
    listOrganizations: async c => market.organizations(c.actor, c.query),
    listPartners: async c => market.partners(c.actor, c.query),
    getMyOrganization: async c => auth.org(c.actor.organizationId),
    updateMyOrganization: async c => market.updateOrganization(c.actor, c.body),
    verifyOrganization: async c => market.verifyOrganization(c.actor, c.id, c.body),
    listListings: async c => market.listings(c.actor, c.query),
    createListing: async c => market.createListing(c.actor, c.body),
    getListing: async c => market.getListing(c.actor, c.id),
    updateListing: async c => market.updateListing(c.actor, c.id, c.body),
    listRfqs: async c => market.rfqs(c.actor, c.query),
    createRfq: async c => market.createRfq(c.actor, c.body),
    createQuote: async c => market.createQuote(c.actor, c.id, c.body),
    acceptQuote: async c => market.acceptQuote(c.actor, c.id, c.key),
    listOrders: async c => market.orders(c.actor, c.query),
    createOrder: async c => market.createOrder(c.actor, c.body, c.key),
    getOrder: async c => market.getOrder(c.actor, c.id),
    changeOrderStatus: async c => market.changeOrderStatus(c.actor, c.id, c.body),
    listShipments: async c => market.shipments(c.actor, c.query),
    createShipment: async c => market.createShipment(c.actor, c.body),
    getShipment: async c => market.getShipment(c.actor, c.id),
    changeShipmentStatus: async c => market.changeShipmentStatus(c.actor, c.id, c.body),
    listTemperatureReadings: async c => market.temperatures(c.actor, c.id, c.query),
    createTemperatureReading: async c => market.addTemperature(c.actor, c.id, c.body),
    getPayment: async c => market.getPayment(c.actor, c.id),
    actOnPayment: async c => market.paymentAction(c.actor, c.id, c.body, c.key),
    listDisputes: async c => market.disputes(c.actor, c.query),
    createDispute: async c => market.createDispute(c.actor, c.body),
    resolveDispute: async c => market.resolveDispute(c.actor, c.id, c.body),
    listAgreements: async c => market.agreements(c.actor, c.query),
    createAgreement: async c => market.createAgreement(c.actor, c.body),
    getAnalytics: async c => market.analytics(c.actor),
    listAuditEvents: async c => market.auditLog(c.actor, c.query),
  };
  for (const [path, methods] of Object.entries(spec.paths) as any) for (const [method, operation] of Object.entries(methods) as any) {
    const handler = handlers[operation.operationId];
    requireThat(handler, 500, 'CONTRACT_MISMATCH', `No handler for ${operation.operationId}.`);
    (http as any)[method]('/api/v1' + path.replace(/\{(\w+)\}/g, ':$1'), async (req: Request, res: Response, next: NextFunction) => {
      try {
        throttle(req, path.startsWith('/auth/') ? 'auth' : 'api', path.startsWith('/auth/') ? 30 : 300);
        const bearerRequired = (operation.security ?? spec.security).some((scheme: any) => 'bearerAuth' in scheme);
        const actor = bearerRequired ? await auth.authenticate(req.headers.authorization?.replace(/^Bearer /, '')) : undefined;
        const schema = operation.requestBody?.content?.['application/json']?.schema?.$ref?.split('/').pop();
        if (schema) validate(schema, req.body); else requireThat(!req.body || Object.keys(req.body).length === 0, 400, 'UNEXPECTED_BODY', 'This endpoint does not accept request fields.');
        for (const value of Object.values(req.params)) requireThat(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 400, 'INVALID_ID', 'A valid record identifier is required.');
        const allowed = (operation.parameters ?? []).filter((p: any) => p.in === 'query').map((p: any) => p.name);
        requireThat(Object.keys(req.query).every(k => allowed.includes(k)) && Object.values(req.query).every(v => typeof v === 'string'), 400, 'INVALID_QUERY', 'Search parameters are not supported.');
        validateQuery(operation, req.query);
        const result = await handler({ req, res, actor: actor as Actor, body: req.body, id: req.params.id as string, query: req.query, key: req.headers['idempotency-key'] as string | undefined });
        const success = Object.keys(operation.responses).find(s => /^2\d\d$/.test(s)) ?? '200';
        if (success === '204') res.status(204).end(); else res.status(Number(success)).json(result && 'meta' in result ? result : { data: result });
      } catch (error) { next(error); }
    });
  }
  http.use((_req: Request, _res: Response, next: NextFunction) => next(new ApiFault(404, 'NOT_FOUND', 'This endpoint is not available.')));
  http.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const fault = error instanceof ApiFault ? error : error.type === 'entity.too.large' ? new ApiFault(413, 'BODY_TOO_LARGE', 'Request is too large.') : error instanceof SyntaxError ? new ApiFault(400, 'INVALID_JSON', 'Request body must be valid JSON.') : ['23505', '23514', '23503', '40001', '40P01'].includes(error.code) ? new ApiFault(409, 'DATA_CONFLICT', 'This operation conflicts with the current record. Refresh and try again.') : new ApiFault(500, 'INTERNAL_ERROR', 'The request could not be completed.');
    if (fault.status === 500) console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId: res.getHeader('X-Request-Id'), errorType: error.name, code: error.code }));
    res.status(fault.status).json({ error: { code: fault.code, message: fault.message, requestId: res.getHeader('X-Request-Id'), ...(fault.details ? { details: fault.details } : {}) } });
  });
  await app.init();
  const io = new Server(app.getHttpServer(), { cors: { origin: options.uiOrigin, credentials: true }, maxHttpBufferSize: 16384, transports: ['websocket'] });
  const eventsNamespace = io.of('/events');
  eventsNamespace.use(async (socket, next) => { try { requireThat(socket.handshake.headers.origin === options.uiOrigin, 403, 'ORIGIN_DENIED', 'Origin denied.'); socket.data.actor = await auth.authenticate(socket.handshake.auth?.accessToken); socket.data.token = socket.handshake.auth?.accessToken; next(); } catch { next(new Error('UNAUTHORIZED')); } });
  eventsNamespace.on('connection', socket => { socket.join(`organization:${socket.data.actor.organizationId}`); socket.emit('ready', { refetch: true }); });
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      await market.runMaintenance();
      for (const socket of eventsNamespace.sockets.values()) try { await auth.authenticate(socket.data.token); } catch { socket.disconnect(true); }
      const events = (await db.query('SELECT * FROM outbox_events WHERE published_at IS NULL AND attempts<5 ORDER BY occurred_at LIMIT 100')).rows as any[];
      for (const event of events) {
        eventsNamespace.to(`organization:${event.organization_id}`).emit('domain.event', { id: event.id, type: event.event_type, schemaVersion: '1.0.0', aggregateId: event.aggregate_id, aggregateVersion: event.aggregate_version, occurredAt: iso(event.occurred_at), correlationId: event.correlation_id, audienceOrgIds: [event.organization_id], data: event.payload });
        await db.query('UPDATE outbox_events SET published_at=now(),attempts=attempts+1 WHERE id=$1', [event.id]);
      }
    } catch (error) { console.error(JSON.stringify({ level: 'error', event: 'maintenance_failed', errorType: (error as Error).name })); } finally { busy = false; }
  };
  const timer = options.jobs === false ? undefined : setInterval(tick, 15000); timer?.unref();
  await app.listen(options.port ?? 4000, options.host ?? '127.0.0.1');
  return { app, http, io, auth, market, tick, url: await app.getUrl(), close: async () => { if (timer) clearInterval(timer); await new Promise<void>(resolve => io.close(() => resolve())); await app.close(); } };
}

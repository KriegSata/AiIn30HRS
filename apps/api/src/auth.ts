import { randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Database, Queryable } from './database.js';
import { ApiFault, type Actor, checkPassword, found, hashPassword, hashToken, one, requireThat } from './core.js';
import { organization } from './mappers.js';

export interface AuthConfig { secret: string; production: boolean; uiOrigin: string }
export class AuthService {
  constructor(readonly db: Database, readonly config: AuthConfig) { requireThat(config.secret.length >= 32, 500, 'CONFIGURATION_ERROR', 'JWT_SECRET must contain at least 32 characters.'); }
  async org(id: string, db: Queryable = this.db) {
    const r = found(await one(db, 'SELECT * FROM organizations WHERE id=$1', [id]));
    r.certificates = (await db.query('SELECT id,name,reference,expires_at,document_url FROM organization_certificates WHERE organization_id=$1 ORDER BY created_at', [id])).rows.map((c: any) => ({ id: c.id, name: c.name, reference: c.reference, expiresAt: c.expires_at ? new Date(c.expires_at).toISOString() : null, documentUrl: c.document_url }));
    return organization(r);
  }
  token(actor: Actor) { return jwt.sign({ sub: actor.id, sid: actor.sessionId }, this.config.secret, { algorithm: 'HS256', expiresIn: 900, issuer: 'harvestlink', audience: 'harvestlink-web' }); }
  async session(user: any, familyId?: string, db: Queryable = this.db) {
    const sessionId = randomUUID(), raw = randomBytes(48).toString('base64url');
    await db.query('INSERT INTO refresh_sessions(id,user_id,family_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [sessionId, user.id, familyId ?? randomUUID(), hashToken(raw), new Date(Date.now() + 14 * 86400000)]);
    const actor: Actor = { id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organization_id, sessionId };
    return { refreshToken: raw, sessionId, data: { user: { id: actor.id, email: actor.email, name: actor.name, role: actor.role, organizationId: actor.organizationId }, organization: await this.org(actor.organizationId, db), accessToken: this.token(actor), expiresIn: 900 } };
  }
  async login(body: any) {
    const user = await one(this.db, 'SELECT u.*,o.verification_status FROM users u JOIN organizations o ON o.id=u.organization_id WHERE lower(u.email)=lower($1)', [body.email]);
    // Always perform the password work, including nonexistent identities.
    const dummy = 'scrypt$16384$00000000000000000000000000000000$' + '0'.repeat(128);
    const valid = await checkPassword(body.password, user?.password_hash ?? dummy);
    requireThat(user && valid && !user.disabled && user.verification_status !== 'suspended', 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return this.db.transaction(tx => this.session(user, undefined, tx));
  }
  async register(body: any) {
    const passwordHash = await hashPassword(body.password);
    return this.db.transaction(async tx => {
      requireThat(!await one(tx, 'SELECT id FROM users WHERE lower(email)=lower($1)', [body.email]), 409, 'ACCOUNT_EXISTS', 'This account cannot be registered. Try signing in.');
      const orgId = randomUUID(), userId = randomUUID();
      await tx.query('INSERT INTO organizations(id,name,role,verification_status,contact_name,email,phone,location_label,latitude,longitude,license_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [orgId, body.organizationName, body.role, body.role === 'buyer' ? 'verified' : 'pending', body.name, body.email.toLowerCase(), body.phone, body.location.label, body.location.latitude, body.location.longitude, body.licenseNumber ?? null]);
      await tx.query('INSERT INTO users(id,organization_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)', [userId, orgId, body.email.toLowerCase(), body.name, body.role, passwordHash]);
      await tx.query('INSERT INTO audit_events(id,actor_user_id,organization_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), userId, orgId, 'organization.registered', 'organization', orgId]);
      return this.session({ id: userId, organization_id: orgId, email: body.email.toLowerCase(), name: body.name, role: body.role }, undefined, tx);
    });
  }
  async authenticate(token: string | undefined): Promise<Actor> {
    let claims: jwt.JwtPayload;
    try { claims = jwt.verify(token ?? '', this.config.secret, { algorithms: ['HS256'], issuer: 'harvestlink', audience: 'harvestlink-web' }) as jwt.JwtPayload; } catch { throw new ApiFault(401, 'UNAUTHORIZED', 'Sign in to continue.'); }
    requireThat(typeof claims.sub === 'string' && typeof claims.sid === 'string', 401, 'UNAUTHORIZED', 'Sign in to continue.');
    const row = await one(this.db, 'SELECT u.*,s.id AS session_id,o.verification_status FROM users u JOIN refresh_sessions s ON s.user_id=u.id JOIN organizations o ON o.id=u.organization_id WHERE u.id=$1 AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT u.disabled', [claims.sub, claims.sid]);
    requireThat(row && row.verification_status !== 'suspended', 401, 'UNAUTHORIZED', 'This session is no longer active.');
    return { id: row.id, email: row.email, name: row.name, role: row.role, organizationId: row.organization_id, sessionId: row.session_id };
  }
  async refresh(token: string | undefined) {
    requireThat(token, 401, 'UNAUTHORIZED', 'Sign in to continue.');
    const result = await this.db.transaction(async tx => {
      const previous = await one(tx, 'SELECT * FROM refresh_sessions WHERE refresh_token_hash=$1 FOR UPDATE', [hashToken(token)]);
      if (!previous) return null;
      if (previous.revoked_at || previous.replaced_by || new Date(previous.expires_at).getTime() <= Date.now()) {
        await tx.query('UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1', [previous.family_id]);
        return null;
      }
      const user = await one(tx, 'SELECT u.*,o.verification_status FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.id=$1', [previous.user_id]);
      if (!user || user.disabled || user.verification_status === 'suspended') {
        await tx.query('UPDATE refresh_sessions SET revoked_at=now() WHERE family_id=$1', [previous.family_id]);
        return null;
      }
      const next = await this.session(user, previous.family_id, tx);
      await tx.query('UPDATE refresh_sessions SET revoked_at=now(),replaced_by=$1 WHERE id=$2', [next.sessionId, previous.id]);
      return next;
    });
    requireThat(result, 401, 'UNAUTHORIZED', 'This session expired. Sign in again.');
    return result;
  }
  async logout(token: string | undefined) { if (token) await this.db.query('UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id IN (SELECT family_id FROM refresh_sessions WHERE refresh_token_hash=$1)', [hashToken(token)]); }
  async me(actor: Actor) { const { sessionId, ...user } = actor; return { user, organization: await this.org(actor.organizationId), accessToken: this.token(actor), expiresIn: 900 }; }
}

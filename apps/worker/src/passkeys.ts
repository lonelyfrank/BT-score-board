import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { DomainError } from '../../../packages/domain/src/index.js';
import { uuid } from '../../../packages/application/src/portable.js';
import { base64url, fromBase64url, type Account, type Accounts } from './accounts.js';

/** Where the browser sees the app: passkeys are bound to its host name. */
export interface RelyingParty {
  id: string;
  origin: string;
}
export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
const challengeTtl = 5 * 60 * 1000;
const invalid = () => new DomainError('PASSKEY_FAILED', 'The passkey could not be verified', 401);

/**
 * Passkeys for a quick sign-in: added from an account already signed in, then used without the
 * username (discoverable credentials). Challenges are single use and expire in five minutes.
 */
export class Passkeys {
  constructor(
    private readonly accounts: Accounts,
    private readonly clock: () => number = Date.now,
  ) {}
  private get sql() {
    return this.accounts.host.sql;
  }
  private saveChallenge(challenge: string, userId: string | null) {
    const id = uuid();
    this.sql.exec('DELETE FROM challenges WHERE expires_at <= ?', this.clock());
    this.sql.exec(
      'INSERT INTO challenges (id, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)',
      id,
      userId,
      challenge,
      this.clock() + challengeTtl,
    );
    return id;
  }
  /** Reads and deletes a challenge: each one is verified at most once. */
  private takeChallenge(id: unknown, userId: string | null) {
    const row = this.sql
      .exec(
        'SELECT challenge, user_id FROM challenges WHERE id = ? AND expires_at > ?',
        String(id ?? ''),
        this.clock(),
      )
      .toArray()[0];
    this.sql.exec('DELETE FROM challenges WHERE id = ?', String(id ?? ''));
    if (!row || (row.user_id ?? null) !== userId) throw invalid();
    return row.challenge as string;
  }
  list(account: Account): Passkey[] {
    return this.sql
      .exec(
        'SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at',
        account.id,
      )
      .toArray()
      .map((r) => ({
        id: r.id as string,
        name: r.name as string,
        createdAt: r.created_at as string,
        lastUsedAt: (r.last_used_at as string | null) ?? null,
      }));
  }
  remove(account: Account, id: unknown) {
    this.sql.exec(
      'DELETE FROM passkeys WHERE id = ? AND user_id = ?',
      String(id ?? ''),
      account.id,
    );
  }
  async registrationOptions(account: Account, rp: RelyingParty) {
    const existing = this.sql
      .exec('SELECT id, transports FROM passkeys WHERE user_id = ?', account.id)
      .toArray();
    const options = await generateRegistrationOptions({
      rpName: 'BT Darts Score Board',
      rpID: rp.id,
      userName: account.username,
      userID: Uint8Array.from(new TextEncoder().encode(account.id)),
      attestationType: 'none',
      excludeCredentials: existing.map((r) => ({
        id: r.id as string,
        transports: JSON.parse(r.transports as string) as string[],
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    return { options, challengeId: this.saveChallenge(options.challenge, account.id) };
  }
  async register(
    account: Account,
    input: { challengeId?: unknown; response?: unknown; name?: unknown },
    rp: RelyingParty,
  ): Promise<Passkey> {
    const expectedChallenge = this.takeChallenge(input.challengeId, account.id);
    const result = await verifyRegistrationResponse({
      response: input.response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    }).catch(() => ({ verified: false as const }));
    if (!result.verified) throw invalid();
    const { credential } = result.registrationInfo;
    const name =
      typeof input.name === 'string' && input.name.trim()
        ? input.name.trim().slice(0, 40)
        : 'Passkey';
    const createdAt = new Date(this.clock()).toISOString();
    this.sql.exec(
      'INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      credential.id,
      account.id,
      base64url(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      name,
      createdAt,
    );
    return { id: credential.id, name, createdAt, lastUsedAt: null };
  }
  async authenticationOptions(rp: RelyingParty) {
    const options = await generateAuthenticationOptions({
      rpID: rp.id,
      userVerification: 'preferred',
    });
    return { options, challengeId: this.saveChallenge(options.challenge, null) };
  }
  async authenticate(
    input: { challengeId?: unknown; response?: unknown },
    rp: RelyingParty,
  ): Promise<Account> {
    const expectedChallenge = this.takeChallenge(input.challengeId, null);
    const response = input.response as AuthenticationResponseJSON;
    const row = this.sql
      .exec('SELECT * FROM passkeys WHERE id = ?', String(response?.id ?? ''))
      .toArray()[0];
    if (!row) throw invalid();
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: row.id as string,
        publicKey: fromBase64url(row.public_key as string),
        counter: row.counter as number,
        transports: JSON.parse(row.transports as string) as string[],
      },
      requireUserVerification: false,
    }).catch(() => ({ verified: false as const, authenticationInfo: undefined }));
    if (!result.verified) throw invalid();
    this.sql.exec(
      'UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?',
      result.authenticationInfo.newCounter,
      new Date(this.clock()).toISOString(),
      row.id,
    );
    const account = this.accounts.get(row.user_id as string);
    if (!account || account.disabled) throw invalid();
    return account;
  }
}

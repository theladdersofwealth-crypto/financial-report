import { DurableObject } from 'cloudflare:workers';
import { issueKisToken, kisConfigured } from './kis.js';

export { default, DeskRoom } from './worker.js';

// This binding has no HTTP route. All callers share one provider session per deployed app.
export class KisTokenBroker extends DurableObject {
  #issuing = null;

  async getToken(rejectedToken = null) {
    if (!kisConfigured(this.env)) return {session: null, events: [{reason: 'missing_configuration'}]};
    const credentials = JSON.stringify([this.env.KIS_APP_KEY, this.env.KIS_APP_SECRET]);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentials));
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    const stored = await this.ctx.storage.get('kis-session');
    if (stored?.fingerprint === fingerprint) {
      if (stored.session?.expiresAt > Date.now() && stored.session.token !== rejectedToken) {
        return {session: stored.session, events: []};
      }
      if (stored.retryAt > Date.now()) return {session: null, events: stored.events};
    }
    if (!this.#issuing) this.#issuing = this.#issue(fingerprint);
    const pending = this.#issuing;
    try { return await pending; } finally { if (this.#issuing === pending) this.#issuing = null; }
  }

  async #issue(fingerprint) {
    const events = [];
    const session = await issueKisToken(this.env, event => events.push(event));
    await this.ctx.storage.put('kis-session', session ? {fingerprint, session} : {
      fingerprint, events, retryAt: Date.now() + (events.some(event => event.code === 'EGW00133') ? 65000 : 10000),
    });
    return {session, events};
  }
}

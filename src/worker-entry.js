import { DurableObject } from 'cloudflare:workers';
import { collectKisFutures, issueKisToken, kisConfigured } from './kis.js';
import { briefingWindow, buildUsBriefing } from './briefing.js';

export { default, DeskRoom } from './worker.js';

export class MarketBriefing extends DurableObject {
  #refreshing = null;

  async #currentWindow() {
    const saved = await this.ctx.storage.get('latest');
    return saved?.windowStart === briefingWindow(Date.now()).windowStart ? saved : null;
  }

  async needsRefresh() {
    return !(await this.#currentWindow());
  }

  async current(cashQuotes) {
    const saved = await this.#currentWindow();
    if (saved) return saved;
    if (!this.#refreshing) this.#refreshing = this.#publish(cashQuotes);
    const pending = this.#refreshing;
    try { return await pending; } finally { if (this.#refreshing === pending) this.#refreshing = null; }
  }

  async #publish(cashQuotes) {
    const futures = await collectKisFutures(this.env);
    const briefing = buildUsBriefing(futures, cashQuotes, Date.now());
    await this.ctx.storage.put('latest', briefing);
    console.info('US market briefing refreshed', {
      generatedAt:briefing.generatedAt, nextUpdateAt:briefing.nextUpdateAt,
      futures:briefing.items.filter(item => item.type === 'future').length,
      officialCloses:briefing.items.filter(item => item.type === 'cash').length,
      headline:briefing.headline,
    });
    return briefing;
  }
}

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

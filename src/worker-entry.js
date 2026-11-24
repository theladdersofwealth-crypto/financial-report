import { DurableObject } from 'cloudflare:workers';
import { issueKisToken, kisConfigured } from './kis.js';
import { briefingWindow, buildUsBriefing } from './briefing.js';
import { collectLiveFutures } from './live-futures.js';
import { FUTURES_FRESHNESS_MS } from '../public/futures-config.js';

export { default, DeskRoom } from './worker.js';

const LIVE_BRIEFING_KEY = 'latest-live-v2';

export class MarketBriefing extends DurableObject {
  #refreshing = null;
  #quoteCache = null;
  #quoting = null;

  async latestFutures(scope = 'indices') {
    const now = Date.now();
    if (this.#quoteCache?.scope === scope && this.#quoteCache.expiresAt > now) {
      return {...this.#quoteCache.snapshot,
        quotes:this.#quoteCache.snapshot.quotes.filter(quote => now - Date.parse(quote.observedAt) <= FUTURES_FRESHNESS_MS)};
    }
    if (this.#quoting?.scope !== scope) this.#quoting = {scope, promise:this.#readFutures(scope)};
    const pending = this.#quoting;
    try { return await pending.promise; } finally { if (this.#quoting === pending) this.#quoting = null; }
  }

  async #readFutures(scope) {
    const issues = [];
    const quotes = await collectLiveFutures(this.env, issue => issues.push(issue), Date.now, scope);
    const snapshot = {quotes, issues, reason:quotes.length ? null : 'network'};
    this.#quoteCache = {scope, snapshot, expiresAt:Date.now()+(scope === 'indices' ? 4000 : 10000)};
    return snapshot;
  }

  #currentWindow(saved) {
    const now = Date.now();
    return saved?.windowStart === briefingWindow(now).windowStart
      && (saved.items.length || now - Date.parse(saved.generatedAt) < 60000);
  }

  async needsRefresh() {
    return !this.#currentWindow(await this.ctx.storage.get(LIVE_BRIEFING_KEY));
  }

  async current() {
    const saved = await this.ctx.storage.get(LIVE_BRIEFING_KEY);
    if (this.#currentWindow(saved)) return saved;
    if (!this.#refreshing) this.#refreshing = this.#publish(saved);
    const pending = this.#refreshing;
    try { return await pending; } finally { if (this.#refreshing === pending) this.#refreshing = null; }
  }

  async #publish(previous) {
    const {quotes, issues} = await this.latestFutures();
    const briefing = buildUsBriefing(quotes, previous, Date.now());
    await this.ctx.storage.put(LIVE_BRIEFING_KEY, briefing);
    console.info('US market briefing refreshed', {
      generatedAt:briefing.generatedAt, nextUpdateAt:briefing.nextUpdateAt,
      contracts:briefing.items.map(item => `${item.venue}:${item.contract}`), issues,
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

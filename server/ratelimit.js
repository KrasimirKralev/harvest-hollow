// Token bucket (tech-architecture §7 rule 6). Time is injectable for tests.
import { performance } from 'node:perf_hooks';

export class TokenBucket {
  /** @param {number} rate tokens per second  @param {number} burst capacity */
  constructor(rate, burst, now = () => performance.now()) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.nowFn = now;
    this.at = now();
  }

  /** Take n tokens; false (and nothing taken) when the bucket is short. */
  take(n = 1) {
    const t = this.nowFn();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.rate);
    this.at = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** One bucket per kind from LIMITS.BUCKETS. */
export function makeBuckets(spec, now) {
  const out = {};
  for (const [k, [rate, burst]] of Object.entries(spec)) out[k] = new TokenBucket(rate, burst, now);
  return out;
}

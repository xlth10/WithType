// Investigation-only Node loader: extend the REA 6.0.0 Hopper startup deadline.
// The installed package is never modified. A hash guard rejects other releases.
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';

const target = 'file:///Users/outsider/.npm/_npx/af752b90495482d7/node_modules/rea-agents/dist/hopper/HopperClient.js';
const expectedHash = '1c1884468242da774dd95c247ce5b3530e1d6ab57054d9baaada9ceacd8adca6';
const original = 'startupTimeoutMs: options.startupTimeoutMs ?? 120_000,';
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== target) return result;
    const source = typeof result.source === 'string'
      ? result.source : Buffer.from(result.source).toString('utf8');
    const hash = createHash('sha256').update(source).digest('hex');
    if (hash !== expectedHash || source.split(original).length !== 2) {
      throw new Error('REA Hopper startup adapter requires the verified 6.0.0 module');
    }
    process.stderr.write('Investigation adapter: Hopper startup deadline 300000 ms; installed files unchanged.\n');
    return { ...result, source: source.replace(original, 'startupTimeoutMs: options.startupTimeoutMs ?? 300_000,') };
  },
});

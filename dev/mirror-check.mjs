/**
 * Mirror check: proves the fallback chain and the all-down rejection.
 * Run: node dev/mirror-check.mjs
 */
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
globalThis.window = { __ModuleLoader__: { load({ factory }) {
  const React = { createElement: () => null, useState: () => [], useEffect: () => {}, useRef: () => ({ current: null }) };
  globalThis.P = factory((n) => (n === 'react' ? React : undefined));
} } };
new Function(source)();
const { fetchHolidayYear } = globalThis.P.$peek;

const realFetch = globalThis.fetch;
// Block both jsDelivr hosts; the loop should fall through to GitHub raw.
globalThis.fetch = async (url, init) => {
  if (String(url).includes('jsdelivr')) throw new Error('blocked by test');
  return realFetch(url, init);
};
const fallback = await fetchHolidayYear(2027);
console.log('fallback mirror:', fallback.mirror, '| entries:', fallback.entries.length);
if (fallback.mirror !== 'GitHub raw') { console.error('FAIL: expected GitHub raw'); process.exit(1); }

// All mirrors down: must reject, not hang or return junk.
globalThis.fetch = async () => { throw new Error('offline'); };
const started = Date.now();
try {
  await fetchHolidayYear(2027);
  console.error('FAIL: expected rejection');
  process.exit(1);
} catch (error) {
  console.log('all-down rejected in', Date.now() - started + 'ms:', error.message);
}
console.log('MIRROR PASS');

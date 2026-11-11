/**
 * Online check for @local/dsh-peak-price: exercises the real mirror list and
 * the holiday-cn conversion over the network.
 *
 * Run: node dev/online-check.mjs [year]
 * Exits 0 when at least one mirror served the year and 春节 was converted.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      const React = { createElement: () => null, useState: () => [], useEffect: () => {}, useRef: () => ({ current: null }) };
      globalThis.P = factory((name) => (name === 'react' ? React : undefined));
    },
  },
};
new Function(source)();

const { fetchHolidayYear, applyHolidayYears, holidayYearLabel, describe, windowOf } = globalThis.P.$peek;
const year = Number(process.argv[2] || 2027);

const started = Date.now();
const { entries, mirror } = await fetchHolidayYear(year);
console.log('mirror:', mirror, '| taken:', Date.now() - started + 'ms', '| entries:', entries.length);
for (const entry of entries) {
  console.log('  ', entry.name.padEnd(4), entry.from, '..', entry.to, entry.makeup.length ? '| makeup ' + entry.makeup.join(',') : '');
}

const spring = entries.find((entry) => entry.name === '春节');
if (!spring) {
  console.error('FAIL: no 春节 entry');
  process.exit(1);
}
if (year === 2027 && (spring.from !== '2027-02-05' || spring.to !== '2027-02-13' || spring.makeup.length !== 2)) {
  console.error('FAIL: 2027 春节 mismatch', JSON.stringify(spring));
  process.exit(1);
}

applyHolidayYears({ [year]: entries });
const at = Date.parse(year + '-10-01T10:00:00+08:00');
const bounds = describe(windowOf(at), at);
console.log('applied →', holidayYearLabel(), '| ' + year + '-10-01 10:00 is', bounds.kind);
if (year === 2027 && bounds.kind !== 'holiday') {
  console.error('FAIL: 2027-10-01 should be holiday');
  process.exit(1);
}

console.log('ONLINE PASS');

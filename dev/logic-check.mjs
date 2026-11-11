/**
 * Logic harness for dsh-half-price.
 *
 * Loads ../client.js with a stubbed `window.__ModuleLoader__` and a minimal
 * React stand-in, then asserts period classification, ranges, holiday data
 * conversion, and dictionary parity. Run: node dev/logic-check.mjs
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      const React = {
        createElement: () => null,
        useState: () => [],
        useEffect: () => {},
        useRef: () => ({ current: null }),
      };
      globalThis.P = factory((name) => (name === 'react' ? React : undefined));
    },
  },
};
new Function(source)();
if (!globalThis.P) throw new Error('factory did not run');

const {
  windowOf, describe, reasonOf, zoneOf, dayKey, nextChangeOf, holidayWikiUrl,
  fromHolidayCn, applyHolidayYears, holidayYearLabel, rangeText, dayPhrase, translator, pricingUrl,
  dictZh, dictEn,
} = globalThis.P.$peek;

/** Beijing wall clock -> absolute instant. */
const bj = (text) => Date.parse(text + '+08:00');

const zh = (key) => (dictZh[key] === undefined ? key : dictZh[key]);
const en = (key) => (dictEn[key] === undefined ? key : dictEn[key]);

const cases = [
  // 2026-11-11 is a Wednesday.
  ['2026-11-11T18:13:31', false, 'night'],
  ['2026-11-11T10:00:00', true, 'peakAm'],
  ['2026-11-11T13:00:00', false, 'lunch'],
  ['2026-11-11T23:30:00', false, 'night'],
  ['2026-11-11T08:00:00', false, 'night'],
  // Friday evening runs on into Monday 09:00.
  ['2026-11-13T20:00:00', false, 'continuous'],
  // Weekend all day.
  ['2026-11-14T10:30:00', false, 'weekend'],
  // National Day holiday (Thursday) is idle all day.
  ['2026-10-01T10:30:00', false, 'holiday'],
  // 调休 workdays count as weekdays.
  ['2026-10-10T10:30:00', true, 'peakAm'],
  ['2026-01-04T15:00:00', true, 'peakPm'],
  // Spring Festival is idle.
  ['2026-02-16T10:00:00', false, 'holiday'],
  // Boundaries: 12:00 sharp is idle, 11:59:59 still peak.
  ['2026-11-11T12:00:00', false, 'lunch'],
  ['2026-11-11T11:59:59', true, 'peakAm'],
  // 2027 (bundled from 国办发明电〔2026〕10 号).
  ['2027-02-05T10:00:00', false, 'holiday'],
  ['2027-01-31T10:00:00', true, 'peakAm'],
  ['2027-10-09T10:00:00', true, 'peakAm'],
  ['2027-02-08T10:00:00', false, 'holiday'],
  // A year outside the table falls back to weekday arithmetic.
  ['2028-01-06T10:00:00', true, 'peakAm'],
];

let failed = 0;
const fail = (label, detail) => {
  failed += 1;
  console.error('FAIL', label, detail);
};

for (const [text, expectPeak, expectKind] of cases) {
  const at = bj(text);
  const bounds = windowOf(at);
  const desc = describe(bounds, at);
  if (bounds.peak !== expectPeak) fail(text, 'peak=' + bounds.peak);
  if (desc.kind !== expectKind) fail(text, 'kind=' + desc.kind);
  console.log('ok  ', text, '|', desc.kind, '|', rangeText(desc.range, zh), '|', reasonOf(zoneOf(at), bounds), '|', bounds.peak ? 'peak' : 'idle');
}

const ranges = [
  ['2026-11-11T18:13:31', '18:00 至 09:00'],
  ['2026-11-11T10:00:00', '09:00–12:00'],
  ['2026-11-11T13:00:00', '12:00–14:00'],
  ['2026-11-13T20:00:00', '18:00 至 11/16 周一 09:00'],
  ['2026-10-01T10:30:00', '18:00 至 10/08 周四 09:00'],
];
for (const [text, expect] of ranges) {
  const at = bj(text);
  const actual = rangeText(describe(windowOf(at), at).range, zh);
  if (actual !== expect) fail('range ' + text, JSON.stringify(actual) + ' != ' + JSON.stringify(expect));
}

const english = [
  ['2026-11-11T10:00:00', '09:00–12:00'],
  ['2026-11-11T18:13:31', '18:00 to 09:00'],
  ['2026-11-13T20:00:00', '18:00 to 11/16 Mon 09:00'],
];
for (const [text, expect] of english) {
  const at = bj(text);
  const actual = rangeText(describe(windowOf(at), at).range, en);
  if (actual !== expect) fail('en range ' + text, JSON.stringify(actual) + ' != ' + JSON.stringify(expect));
}

// Chip change instants: window end or next Beijing midnight.
const changes = [
  ['2026-11-11T18:13:31', '2026-11-12T00:00:00'],
  ['2026-11-11T10:00:00', '2026-11-11T12:00:00'],
  ['2026-11-11T13:00:00', '2026-11-11T14:00:00'],
];
for (const [text, expect] of changes) {
  const at = bj(text);
  const next = nextChangeOf(windowOf(at), at);
  if (next !== bj(expect)) fail('change ' + text, new Date(next).toISOString() + ' != ' + new Date(bj(expect)).toISOString());
}

// Relative day phrasing.
const phrase = dayPhrase(bj('2026-11-12T09:00:00'), bj('2026-11-11T18:13:31'));
if (phrase.rel !== 'tomorrow' || phrase.weekday !== 4) fail('dayPhrase', JSON.stringify(phrase));

// holiday-cn conversion: consecutive off days become one range.
const converted = fromHolidayCn({
  days: [
    { name: '元旦', date: '2027-01-01', isOffDay: true },
    { name: '元旦', date: '2027-01-02', isOffDay: true },
    { name: '元旦', date: '2027-01-03', isOffDay: true },
    { name: '春节', date: '2027-01-31', isOffDay: false },
    { name: '春节', date: '2027-02-05', isOffDay: true },
    { name: '春节', date: '2027-02-06', isOffDay: true },
    { name: '春节', date: '2027-02-14', isOffDay: false },
  ],
});
const newYear = converted.find((entry) => entry.name === '元旦');
const spring = converted.find((entry) => entry.name === '春节');
if (!newYear || newYear.from !== '2027-01-01' || newYear.to !== '2027-01-03' || newYear.makeup.length !== 0) fail('convert 元旦', JSON.stringify(newYear));
if (!spring || spring.from !== '2027-02-05' || spring.to !== '2027-02-06' || spring.makeup.join() !== '2027-01-31,2027-02-14') fail('convert 春节', JSON.stringify(spring));

// Runtime application of a fetched year overrides the built-in one.
applyHolidayYears({ 2028: [{ name: '元旦', from: '2028-01-01', to: '2028-01-03', makeup: [] }] });
if (holidayYearLabel() !== '2026–2028') fail('year label after apply', holidayYearLabel());
const y2028 = bj('2028-01-02T10:00:00');
if (describe(windowOf(y2028), y2028).kind !== 'holiday') fail('2028 holiday not applied', describe(windowOf(y2028), y2028).kind);
applyHolidayYears({});
if (holidayYearLabel() !== '2026–2027') fail('year label after reset', holidayYearLabel());

// Both dictionaries must carry the same keys, with no empty text.
const zhKeys = Object.keys(dictZh).sort();
const enKeys = Object.keys(dictEn).sort();
if (zhKeys.join() !== enKeys.join()) {
  const missingEn = zhKeys.filter((key) => !(key in dictEn));
  const missingZh = enKeys.filter((key) => !(key in dictZh));
  fail('dictionary keys', 'missing en=[' + missingEn.join(',') + '] missing zh=[' + missingZh.join(',') + ']');
}
for (const key of zhKeys) {
  if (!String(dictZh[key]).trim() || !String(dictEn[key] || '').trim()) fail('empty text', key);
}

// Day keys follow Beijing, not the host timezone.
if (dayKey(bj('2026-11-11T00:10:00')) !== '2026-11-11' || dayKey(bj('2026-11-11T23:59:00')) !== '2026-11-11') {
  fail('dayKey', dayKey(bj('2026-11-11T00:10:00')) + '/' + dayKey(bj('2026-11-11T23:59:00')));
}


// Translator: both languages, same key set, no leakage of the other language.
const tZh = translator('zh');
const tEn = translator('en');
if (tZh('peak') !== '高峰' || tEn('peak') !== 'Peak') fail('translator', tZh('peak') + '/' + tEn('peak'));
if (tEn('peakAm') !== 'Peak · morning') fail('translator en kind', tEn('peakAm'));
if (!/^[^\u4e00-\u9fff]*$/.test(tEn('peakAm') + tEn('night') + tEn('holidays') + tEn('rulePrice'))) {
  fail('en strings contain chinese', tEn('rulePrice'));
}
console.log('translator ok:', tEn('peak'), '|', tZh('peak'), '|', tEn('h春节'), '|', tZh('h春节'));

// The price link follows the panel language.
if (pricingUrl('zh') !== 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing') fail('pricing zh', pricingUrl('zh'));
if (pricingUrl('en') !== 'https://api-docs.deepseek.com/quick_start/pricing/') fail('pricing en', pricingUrl('en'));
console.log('pricing links:', pricingUrl('zh'), '|', pricingUrl('en'));

// Holiday names resolve to the matching Wikipedia language edition.
if (holidayWikiUrl('春节', 'zh') !== 'https://zh.wikipedia.org/wiki/春节') fail('wiki zh 春节', holidayWikiUrl('春节', 'zh'));
if (holidayWikiUrl('春节', 'en') !== 'https://en.wikipedia.org/wiki/Chinese_New_Year') fail('wiki en 春节', holidayWikiUrl('春节', 'en'));
if (holidayWikiUrl('国庆节', 'en') !== 'https://en.wikipedia.org/wiki/National_Day_of_the_People%27s_Republic_of_China') fail('wiki en 国庆节', holidayWikiUrl('国庆节', 'en'));
for (const name of ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节']) {
  if (!holidayWikiUrl(name, 'zh') || !holidayWikiUrl(name, 'en')) fail('wiki missing', name);
}
if (holidayWikiUrl('不存在的节日', 'zh') !== null) fail('wiki unknown', 'should be null');
console.log('wiki ok:', holidayWikiUrl('春节', 'en'));
console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILURES');
process.exit(failed === 0 ? 0 : 1);

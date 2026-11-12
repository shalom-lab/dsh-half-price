/**
 * DeepSeek 峰谷价提醒 / DeepSeek peak & idle price reminder — Client half.
 *
 * One ambient entry in `conversation.composer.dock`: a small chip that says
 * whether DeepSeek API calls are billed at peak or idle rates, plus a
 * hover/click popover with prices, the next switch, and holiday data.
 *
 * Power: the chip is static; a single timer wakes at the next boundary (or at
 * the 10-minute warning before it), and a 1 s tick runs only while the popover
 * is open. Holiday data refreshes at most once per 30 days, from cache.
 *
 * Text goes through the shared locale service (namespace `dsh-half-price`), so
 * it follows the harness language setting.
 */
const PLUGIN = {
  id: 'dsh-half-price',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;

    /* ------------------------------------------------------------------
     * Constants — prices re-checked against api-docs.deepseek.com on 2026-11-11.
     * ------------------------------------------------------------------ */

    // 北京时间 = UTC+8, no DST. Shifting an instant by +8h puts UTC fields on
    // Beijing wall-clock values in any host timezone.
    const BJ_OFFSET = 8 * 3600 * 1000;
    const DAY = 86400000;
    const HOUR = 3600000;
    const MINUTE = 60000;
    const SECOND = 1000;
    const REMIND_MINUTES = 10;

    const CONCURRENCY = { 'deepseek-flash': '2500', 'deepseek-v4-pro': '500' };

    // Peak = Beijing weekdays 09:00-12:00 and 14:00-18:00, excluding statutory
    // holidays. Everything else — weekends and holidays included — is idle at
    // half the peak price.
    const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];

    /**
     * Official prices, per 1M tokens. The Chinese docs list CNY and the English
     * docs list USD, so the table follows the UI language (and its price link).
     */
    const MODELS = [
      {
        id: 'deepseek-flash',
        name: 'deepseek-flash',
        note: 'V4.1-Flash',
        cny: { peak: { hit: 0.04, miss: 2, out: 8 }, idle: { hit: 0.02, miss: 1, out: 4 } },
        usd: { peak: { hit: 0.006, miss: 0.3, out: 1.2 }, idle: { hit: 0.003, miss: 0.15, out: 0.6 } },
      },
      {
        id: 'deepseek-v4-pro',
        name: 'deepseek-v4-pro',
        note: 'V4-Pro',
        cny: { peak: { hit: 0.3, miss: 9, out: 27 }, idle: { hit: 0.15, miss: 4.5, out: 13.5 } },
        usd: { peak: { hit: 0.044, miss: 1.32, out: 3.96 }, idle: { hit: 0.022, miss: 0.66, out: 1.98 } },
      },
    ];

    // 国务院办公厅的年度放假通知，内置两年作为离线兜底：
    //   2026 — 国办发明电〔2025〕7 号
    //   2027 — 国办发明电〔2026〕10 号（2026-11-05 发布）
    // Inclusive Beijing date ranges; `makeup` lists the 调休 workdays.
    const SEED_HOLIDAYS = {
      2026: [
        { name: '元旦', from: '2026-01-01', to: '2026-01-03', makeup: ['2026-01-04'] },
        { name: '春节', from: '2026-02-15', to: '2026-02-23', makeup: ['2026-02-14', '2026-02-28'] },
        { name: '清明节', from: '2026-04-04', to: '2026-04-06', makeup: [] },
        { name: '劳动节', from: '2026-05-01', to: '2026-05-05', makeup: ['2026-05-09'] },
        { name: '端午节', from: '2026-06-19', to: '2026-06-21', makeup: [] },
        { name: '中秋节', from: '2026-09-25', to: '2026-09-27', makeup: [] },
        { name: '国庆节', from: '2026-10-01', to: '2026-10-07', makeup: ['2026-09-20', '2026-10-10'] },
      ],
      2027: [
        { name: '元旦', from: '2027-01-01', to: '2027-01-03', makeup: [] },
        { name: '春节', from: '2027-02-05', to: '2027-02-13', makeup: ['2027-01-31', '2027-02-14'] },
        { name: '清明节', from: '2027-04-03', to: '2027-04-05', makeup: [] },
        { name: '劳动节', from: '2027-05-01', to: '2027-05-05', makeup: ['2027-05-08'] },
        { name: '端午节', from: '2027-06-09', to: '2027-06-09', makeup: [] },
        { name: '中秋节', from: '2027-09-15', to: '2027-09-15', makeup: [] },
        { name: '国庆节', from: '2027-10-01', to: '2027-10-07', makeup: ['2027-09-26', '2027-10-09'] },
      ],
    };

    let HOLIDAYS = normalizeHolidays(SEED_HOLIDAYS);

    function normalizeHolidays(byYear) {
      const years = new Set();
      const sorted = [];
      const makeup = new Set();
      for (const year of Object.keys(byYear)) {
        years.add(String(year));
        for (const holiday of byYear[year]) {
          sorted.push(holiday);
          for (const date of holiday.makeup || []) makeup.add(date);
        }
      }
      sorted.sort((a, b) => (a.from < b.from ? -1 : 1));
      return { years, sorted, makeup };
    }

    /* ------------------------------------------------------------------
     * Beijing-clock helpers.
     * ------------------------------------------------------------------ */

    /**
     * Two clock domains, kept strictly apart:
     *   - `instant`: absolute epoch ms (Date.now(), slot props);
     *   - `shifted`: epoch ms + 8h, so UTC fields read as Beijing wall clock
     *     and whole days are exact multiples of DAY.
     */
    const shift = (instant) => instant + BJ_OFFSET;
    const unshift = (shifted) => shifted - BJ_OFFSET;
    const floorDay = (shifted) => shifted - (shifted % DAY);
    const minutesOf = (shifted) => Math.floor((shifted % DAY) / MINUTE);

    const pad2 = (n) => (n < 10 ? '0' : '') + n;
    const clock = (minutes) => pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);

    function dayKey(instant, offset) {
      const bj = new Date(shift(instant) + (offset || 0) * DAY);
      return bj.getUTCFullYear() + '-' + pad2(bj.getUTCMonth() + 1) + '-' + pad2(bj.getUTCDate());
    }

    function weekdayOf(instant) {
      return new Date(shift(instant)).getUTCDay();
    }

    function holidayOf(key) {
      if (!HOLIDAYS.years.has(key.slice(0, 4))) return null;
      for (const holiday of HOLIDAYS.sorted) {
        if (key >= holiday.from && key <= holiday.to) return holiday;
      }
      return null;
    }

    function isMakeup(key) {
      if (HOLIDAYS.makeup.has(key)) return true;
      // Year outside the table: assume a Saturday would be a 调休 workday.
      if (HOLIDAYS.years.has(key.slice(0, 4))) return false;
      const [y, m, d] = key.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
    }

    function isWorkday(key) {
      if (holidayOf(key)) return HOLIDAYS.makeup.has(key);
      const weekday = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))).getUTCDay();
      return (weekday !== 0 && weekday !== 6) || isMakeup(key);
    }

    function isPeakMinute(instant, minute) {
      const key = dayKey(instant);
      if (holidayOf(key)) return false;
      const weekday = weekdayOf(instant);
      if (weekday === 0 || weekday === 6) return isMakeup(key) && PEAK_WINDOWS.some(([from, to]) => minute >= from && minute < to);
      return PEAK_WINDOWS.some(([from, to]) => minute >= from && minute < to);
    }

    /* ------------------------------------------------------------------
     * Holiday data refresh.
     *
     * Chinese holidays are administrative, not computable: the State Council
     * publishes next year's schedule each November. The public holiday-cn
     * dataset republishes that notice as JSON within hours, per year,
     * including 调休. Two years are bundled; the rest comes from that dataset,
     * refreshed when the cache is older than 30 days, plus a manual sync.
     * Any failure falls back to the bundled table.
     * ------------------------------------------------------------------ */

    const HOLIDAY_CACHE_KEY = 'dsh-half-price:holidays:v1';
    const HOLIDAY_SYNC_DAYS = 30;
    const FETCH_TIMEOUT = 6000;

    // Several mirrors: jsDelivr is often blocked or slow on mainland networks,
    // GitHub raw is usually reachable, and coding.net is a last-resort mirror.
    // Each URL must return the raw `{ days: [...] }` document.
    const HOLIDAY_MIRRORS = [
      { label: 'jsDelivr', url: (year) => 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/' + year + '.json' },
      { label: 'jsDelivr (fastly)', url: (year) => 'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/' + year + '.json' },
      { label: 'GitHub raw', url: (year) => 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/' + year + '.json' },
      { label: 'Coding', url: (year) => 'https://natescarlet.coding.net/p/github/d/holiday-cn/git/raw/master/' + year + '.json' },
    ];

    function addDaysKey(key, delta) {
      return new Date(Date.parse(key + 'T00:00:00Z') + delta * DAY).toISOString().slice(0, 10);
    }

    /** holiday-cn `{ days: [{name, date, isOffDay}] }` -> our range entries. */
    function fromHolidayCn(doc) {
      const off = new Map();
      const work = new Map();
      for (const day of doc && Array.isArray(doc.days) ? doc.days : []) {
        if (!day || typeof day.date !== 'string' || typeof day.name !== 'string') continue;
        const bucket = day.isOffDay ? off : work;
        if (!bucket.has(day.name)) bucket.set(day.name, []);
        bucket.get(day.name).push(day.date);
      }
      const entries = [];
      for (const [name, dates] of off) {
        dates.sort();
        let start = dates[0];
        let previous = dates[0];
        for (let index = 1; index <= dates.length; index += 1) {
          const current = dates[index];
          if (current && addDaysKey(previous, 1) === current) {
            previous = current;
            continue;
          }
          entries.push({ name, from: start, to: previous, makeup: (work.get(name) || []).slice().sort() });
          start = current;
          previous = current;
        }
      }
      entries.sort((a, b) => (a.from < b.from ? -1 : 1));
      return entries;
    }

    /** fetch with a hard timeout; AbortSignal.timeout is not universal yet. */
    async function fetchText(url, timeout) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
      try {
        const response = await fetch(url, controller ? { signal: controller.signal, cache: 'no-store' } : { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.text();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    /**
     * Fetch one year, trying mirrors in order. Returns `{ entries, mirror }`
     * or throws the last failure.
     */
    async function fetchHolidayYear(year) {
      let lastError = new Error('no mirror');
      for (const mirror of HOLIDAY_MIRRORS) {
        try {
          const text = await fetchText(mirror.url(year), FETCH_TIMEOUT);
          const entries = fromHolidayCn(JSON.parse(text));
          if (entries.length === 0) throw new Error('empty dataset');
          return { entries, mirror: mirror.label };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    }

    function readHolidayCache() {
      try {
        const raw = window.localStorage.getItem(HOLIDAY_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.at !== 'number' || !parsed.years || typeof parsed.years !== 'object') return null;
        return parsed;
      } catch (error) {
        return null;
      }
    }

    function writeHolidayCache(years) {
      try {
        window.localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify({ at: Date.now(), years }));
      } catch (error) {
        /* private mode: bundled table still works */
      }
    }

    function applyHolidayYears(years) {
      const merged = { ...SEED_HOLIDAYS };
      for (const year of Object.keys(years)) {
        if (Array.isArray(years[year]) && years[year].length > 0) merged[year] = years[year];
      }
      HOLIDAYS = normalizeHolidays(merged);
    }

    function holidayYearLabel() {
      const years = Array.from(HOLIDAYS.years).sort();
      if (years.length === 0) return '—';
      return years.length > 1 ? years[0] + '–' + years[years.length - 1] : years[0];
    }

    /* ------------------------------------------------------------------
     * Timeline: alternating peak / idle intervals, so the current window and
     * the next switch can never disagree.
     * ------------------------------------------------------------------ */

    function peakBounds(instant, from) {
      const day = unshift(floorDay(shift(instant)));
      const end = from === PEAK_WINDOWS[0][0] ? PEAK_WINDOWS[0][1] : PEAK_WINDOWS[1][1];
      return { peak: true, start: day + from * MINUTE, end: day + end * MINUTE };
    }

    function gapBounds(prevEnd, nextStart) {
      return { peak: false, start: prevEnd, end: nextStart, nextStart };
    }

    function timeline(instant) {
      const today = floorDay(shift(instant));
      const days = [];
      for (let offset = -6; offset <= 10; offset += 1) {
        const day = unshift(today + offset * DAY);
        if (!isWorkday(dayKey(day))) continue;
        for (const [from] of PEAK_WINDOWS) days.push(peakBounds(day, from));
      }
      days.sort((a, b) => a.start - b.start);

      const entries = [];
      let previous = null;
      for (const peak of days) {
        if (previous === null || peak.start > previous.end) entries.push(gapBounds(previous === null ? null : previous.end, peak.start));
        entries.push(peak);
        previous = peak;
      }
      if (entries.length === 0) return [];
      entries.push(gapBounds(previous.end, null));
      for (const entry of entries) {
        if (entry.peak || entry.start === null || entry.end === null) continue;
        if ((entry.end - entry.start) / HOUR > 15) entry.long = true;
      }
      return entries;
    }

    function windowOf(instant) {
      for (const entry of timeline(instant)) {
        if (entry.peak) {
          if (instant >= entry.start && instant < entry.end) return { peak: true, start: entry.start, end: entry.end, nextStart: null };
          continue;
        }
        const end = entry.end === null ? Infinity : entry.end;
        if (instant >= (entry.start === null ? -Infinity : entry.start) && instant < end) return entry;
      }
      return { peak: false, start: null, end: null, nextStart: null };
    }

    function zoneOf(instant) {
      const key = dayKey(instant);
      if (holidayOf(key)) return HOLIDAYS.makeup.has(key) ? 'makeup' : 'holiday';
      const weekday = weekdayOf(instant);
      if (weekday === 0 || weekday === 6) return isMakeup(key) ? 'makeup' : 'weekend';
      return 'workday';
    }

    /**
     * Window description as data, not prose: the view maps `kind` and composes
     * the range, so both languages share one source of truth.
     */
    function describe(bounds, instant) {
      const start = bounds.start === null ? null : minutesOf(shift(bounds.start));
      const end = bounds.end === null ? null : minutesOf(shift(bounds.end));
      const range = {
        from: start === null ? null : clock(start),
        to: end === null ? null : clock(end),
        endDay: bounds.long && bounds.end !== null ? dayMonth(bounds.end) : null,
        endWeekday: bounds.long && bounds.end !== null ? weekdayOf(bounds.end) : null,
        allDay: start === null,
        open: end === null,
        crossDay: start !== null && end !== null && end <= start,
      };

      if (bounds.peak) return { kind: start < PEAK_WINDOWS[1][0] ? 'peakAm' : 'peakPm', range };

      if (bounds.long) {
        const hour = minutesOf(shift(instant));
        const overnight = end !== null && bounds.end - instant < 9 * HOUR && hour < PEAK_WINDOWS[0][0];
        if (overnight) return { kind: 'night', range };
        const zone = zoneOf(instant);
        return { kind: zone === 'holiday' ? 'holiday' : zone === 'weekend' ? 'weekend' : 'continuous', range };
      }
      if (start === null || bounds.nextStart === null) return { kind: 'holiday', range };
      if (end === null) return { kind: 'continuous', range };
      if (range.crossDay) return { kind: 'night', range };
      if (start >= PEAK_WINDOWS[0][1] && end <= PEAK_WINDOWS[1][0]) return { kind: 'lunch', range };
      if (start >= PEAK_WINDOWS[1][1]) return { kind: 'evening', range };
      return { kind: 'idle', range };
    }

    /** Reason as a code; the view translates it. */
    function reasonOf(zone, bounds) {
      if (bounds.peak) return zone === 'workday' ? 'peakWorkday' : 'peakMakeup';
      if (bounds.long) {
        if (zone === 'weekend') return 'contWeekend';
        if (zone === 'holiday') return 'contHoliday';
        if (zone === 'makeup') return 'makeup';
        return 'cont';
      }
      if (zone === 'holiday') return 'holiday';
      if (zone === 'weekend') return 'weekend';
      if (zone === 'makeup') return 'makeup';
      return bounds.start === null ? 'unknownYear' : 'workdayIdle';
    }

    /** `MM/DD` for an absolute instant. */
    function dayMonth(instant) {
      const bj = new Date(shift(instant));
      return pad2(bj.getUTCMonth() + 1) + '/' + pad2(bj.getUTCDate());
    }

    /** Relative day as data: `{ rel, weekday }`. */
    function dayPhrase(instant, now) {
      const delta = (Date.parse(dayKey(instant) + 'T00:00:00Z') - Date.parse(dayKey(now) + 'T00:00:00Z')) / DAY;
      return { rel: delta === 0 ? 'today' : delta === 1 ? 'tomorrow' : delta === 2 ? 'afterTwo' : null, weekday: weekdayOf(instant) };
    }

    function countdown(ms) {
      if (ms < 0) ms = 0;
      const days = Math.floor(ms / DAY);
      const hours = Math.floor((ms % DAY) / HOUR);
      const minutes = Math.floor((ms % HOUR) / MINUTE);
      const seconds = Math.floor((ms % MINUTE) / SECOND);
      const tail = pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
      return days > 0 ? days + 'd ' + tail : tail;
    }

    /** Next moment the chip can change: window end, or next Beijing midnight. */
    function nextChangeOf(bounds, now) {
      const midnight = unshift(floorDay(shift(now)) + DAY);
      const end = bounds.end === null ? Infinity : bounds.end;
      return Math.min(end, midnight);
    }

    /* ------------------------------------------------------------------
     * Text. Two complete dictionaries; the view binds them through the shared
     * locale service and falls back to Chinese if that service is absent.
     * ------------------------------------------------------------------ */

    const NS = 'dsh-half-price';

    const ZH = {
      'peak': '高峰',
      'idle': '空闲',
      'half': '五折',
      'priceUp': '涨价',
      'priceDown': '降价',
      'peakHours': '高峰时段',
      'idleHours': '空闲时段',
      'nowLabel': '当前价目',
      'unitCny': '元 / 百万 tokens',
      'unitUsd': '美元 / 百万 tokens',
      'hit': '命中',
      'miss': '未命中',
      'out': '输出',
      'concurrency': '并发',
      'rules': '计费规则',
      'rulePrice': '空闲价 = 高峰价 × 50%，同一时段内单价不变。',
      'rulePeak': '高峰：北京时间周一至周五（法定节假日除外）09:00–12:00、14:00–18:00。',
      'ruleIdle': '空闲：其余全部时段，含周末与法定节假日全天。',
      'holidays': '假期与调休',
      'holidayCaption': '假期全天按空闲计价',
      'holidayLeft': '还有 ',
      'holidayLeftTail': ' 天',
      'holidayNow': '假期内',
      'holidayDone': '已结束',
      'holidayNone': '表内年份的假期已全部结束',
      'holidayNote': '未收录的年份按工作日/周末推算；可手动同步。',
      'holidayLink': '假期安排原文',
      'priceLink': '官方价格页',
      'usageLink': '用量查询',
      'sync': '同步',
      'syncBusy': '同步中…',
      'syncOk': '已同步',
      'syncFail': '同步失败',
      'globalOn': '右下角状态点：开（点击关闭）',
      'globalOff': '右下角状态点：关（点击开启）',
      'more': '规则与假期',
      'less': '收起',
      'close': '关闭',
      'nextSwitch': '下次切换',
      'toIdle': '→ 转空闲',
      'toPeak': '→ 转高峰',
      'none': '→ 暂无',
      'noPeak': '暂无后续高峰',
      'rangeAllDay': '全天',
      'rangeTo': ' 至 ',
      'rangePending': '待定',
      'continuousIdle': '连续空闲中',
      'peakAm': '高峰时段 · 上午',
      'peakPm': '高峰时段 · 下午',
      'night': '夜间 · 空闲时段',
      'lunch': '午间 · 空闲时段',
      'evening': '晚间 · 空闲时段',
      'weekend': '周末 · 空闲时段',
      'holiday': '假期 · 空闲时段',
      'continuous': '连续空闲',
      'idleWindow': '空闲时段',
      'peakWorkday': '工作日高峰',
      'peakMakeup': '调休上班日高峰',
      'contWeekend': '周末连带',
      'contHoliday': '假期连带',
      'cont': '夜间连带',
      'makeup': '调休上班日',
      'workdayIdle': '工作日非高峰',
      'unknownYear': '未收录年份',
      'today': '今天',
      'tomorrow': '明天',
      'afterTwo': '后天',
      'wd0': '周日',
      'wd1': '周一',
      'wd2': '周二',
      'wd3': '周三',
      'wd4': '周四',
      'wd5': '周五',
      'wd6': '周六',
      'h元旦': '元旦',
      'h春节': '春节',
      'h清明节': '清明节',
      'h劳动节': '劳动节',
      'h端午节': '端午节',
      'h中秋节': '中秋节',
      'h国庆节': '国庆节',
      'ariaPeak': '高峰时段',
      'ariaIdle': '空闲时段，五折',
    };

    const EN = {
      'peak': 'Peak',
      'idle': 'Idle',
      'half': '50% off',
      'priceUp': 'price up',
      'priceDown': 'price down',
      'peakHours': 'Peak hours',
      'idleHours': 'Idle hours',
      'nowLabel': 'Current prices',
      'unitCny': 'CNY / 1M tokens',
      'unitUsd': 'USD / 1M tokens',
      'hit': 'cached',
      'miss': 'miss',
      'out': 'output',
      'concurrency': 'concurrency',
      'rules': 'Billing rules',
      'rulePrice': 'Idle price = 50% of peak; the rate is fixed within a window.',
      'rulePeak': 'Peak: Beijing time Mon–Fri (statutory holidays excluded), 09:00–12:00 and 14:00–18:00 — 01:00–04:00 and 06:00–10:00 UTC.',
      'ruleIdle': 'Idle: all other hours, including weekends and holidays.',
      'holidays': 'Holidays & make-up days',
      'holidayCaption': 'full day billed as idle',
      'holidayLeft': 'in ',
      'holidayLeftTail': ' d',
      'holidayNow': 'ongoing',
      'holidayDone': 'past',
      'holidayNone': 'No holidays left in the covered years',
      'holidayNote': 'Years not covered fall back to weekdays/weekends; sync to refresh.',
      'holidayLink': 'Official notice',
      'priceLink': 'Pricing page',
      'usageLink': 'Usage',
      'sync': 'Sync',
      'syncBusy': 'Syncing…',
      'syncOk': 'Synced',
      'syncFail': 'Sync failed',
      'globalOn': 'Frame status dot: on (click to hide)',
      'globalOff': 'Frame status dot: off (click to show)',
      'more': 'Rules & holidays',
      'less': 'Collapse',
      'close': 'Close',
      'nextSwitch': 'Next switch',
      'toIdle': '→ idle',
      'toPeak': '→ peak',
      'none': '→ none',
      'noPeak': 'no peak ahead',
      'rangeAllDay': 'all day',
      'rangeTo': ' to ',
      'rangePending': 'TBD',
      'continuousIdle': 'continuous idle',
      'peakAm': 'Peak · morning',
      'peakPm': 'Peak · afternoon',
      'night': 'Night · idle',
      'lunch': 'Lunch break · idle',
      'evening': 'Evening · idle',
      'weekend': 'Weekend · idle',
      'holiday': 'Holiday · idle',
      'continuous': 'Continuous idle',
      'idleWindow': 'Idle',
      'peakWorkday': 'weekday peak',
      'peakMakeup': 'make-up workday peak',
      'contWeekend': 'weekend run',
      'contHoliday': 'holiday run',
      'cont': 'overnight run',
      'makeup': 'make-up workday',
      'workdayIdle': 'weekday off-peak',
      'unknownYear': 'year not in table',
      'today': 'today',
      'tomorrow': 'tomorrow',
      'afterTwo': 'in two days',
      'wd0': 'Sun',
      'wd1': 'Mon',
      'wd2': 'Tue',
      'wd3': 'Wed',
      'wd4': 'Thu',
      'wd5': 'Fri',
      'wd6': 'Sat',
      'h元旦': 'New Year',
      'h春节': 'Spring Festival',
      'h清明节': 'Qingming',
      'h劳动节': 'Labour Day',
      'h端午节': 'Dragon Boat',
      'h中秋节': 'Mid-Autumn',
      'h国庆节': 'National Day',
      'ariaPeak': 'Peak hours',
      'ariaIdle': 'Idle hours, half price',
    };

    /** Fallback translator used when the locale service is unavailable. */
    function fallbackT(key) {
      return ZH[key] === undefined ? key : ZH[key];
    }

    const LANG_KEY = 'dsh-half-price:lang';
    const GLOBAL_KEY = 'dsh-half-price:global-dot';

    function readGlobalDot() {
      try {
        return window.localStorage.getItem(GLOBAL_KEY) !== 'off';
      } catch (error) {
        return true;
      }
    }

    // One module-level switch for the frame-wide dot, so the popover toggle and
    // the overlay indicator stay in sync without a shared React tree.
    let globalDotOn = readGlobalDot();
    const globalDotSubscribers = new Set();

    function setGlobalDot(on) {
      globalDotOn = on;
      try {
        window.localStorage.setItem(GLOBAL_KEY, on ? 'on' : 'off');
      } catch (error) {
        /* storage unavailable: the switch still lasts this session */
      }
      for (const notify of globalDotSubscribers) notify(on);
    }

    function subscribeGlobalDot(notify) {
      globalDotSubscribers.add(notify);
      return () => globalDotSubscribers.delete(notify);
    }

    function readLangOverride() {
      try {
        const value = window.localStorage.getItem(LANG_KEY);
        return value === 'zh' || value === 'en' ? value : null;
      } catch (error) {
        return null;
      }
    }

    function writeLangOverride(lang) {
      try {
        window.localStorage.setItem(LANG_KEY, lang);
      } catch (error) {
        /* storage unavailable: the switch still works for this session */
      }
    }

    /** Translator for a fixed language; both dictionaries are complete. */
    function translator(lang) {
      const dict = lang === 'en' ? EN : ZH;
      return (key) => (dict[key] === undefined ? (ZH[key] === undefined ? key : ZH[key]) : dict[key]);
    }

    function rangeText(range, t) {
      if (range.allDay) return t('rangeAllDay');
      if (range.open) return range.from + t('rangeTo') + t('rangePending');
      if (range.endDay) {
        const day = range.endWeekday === null ? range.endDay : range.endDay + ' ' + t('wd' + range.endWeekday);
        return range.from + t('rangeTo') + day + ' ' + range.to;
      }
      if (range.crossDay) return range.from + t('rangeTo') + range.to;
      return range.from + '–' + range.to;
    }

    /* ------------------------------------------------------------------
     * Views.
     * ------------------------------------------------------------------ */

    function modelRow(model, window, t, currency) {
      const active = model[currency][window];
      const other = model[currency][window === 'idle' ? 'peak' : 'idle'];
      const cells = ['hit', 'miss', 'out'].map((key) => h('div', {
        key,
        className: 'dj-car' + (active[key] < other[key] ? ' dj-car--save' : ''),
      },
        h('span', { className: 'dj-cell-label' }, t(key)),
        h('span', { className: 'dj-cell-value' }, String(active[key]))
      ));
      return h('div', { key: model.id, className: 'dj-model' },
        h('div', { className: 'dj-model-head' },
          h('span', { className: 'dj-model-name' }, model.name),
          h('span', { className: 'dj-model-note' }, model.note),
          h('span', { className: 'dj-model-sw' }, t('concurrency') + ' ' + (CONCURRENCY[model.id] || '—'))
        ),
        h('div', { className: 'dj-cars' }, cells)
      );
    }

    function priceBlock(window, t, currency) {
      return h('div', { className: 'dj-block' },
        h('div', { className: 'dj-block-head' },
          h('span', { className: 'dj-block-title' }, t('nowLabel') + ' · ' + (window === 'peak' ? t('peak') : t('idle'))),
          h('span', { className: 'dj-block-meta' }, t(currency === 'usd' ? 'unitUsd' : 'unitCny'))
        ),
        h('div', { className: 'dj-models' }, MODELS.map((model) => modelRow(model, window, t, currency)))
      );
    }

    // GitHub's mark-github octicon (MIT), used to link back to the repo.
    const GITHUB_MARK = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z';

    function externalLink(href, label, key) {
      return h('a', {
        key,
        className: 'dj-ext',
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: href,
        onClick: (event) => event.stopPropagation(),
      }, label, h('span', { className: 'dj-ext-arrow', 'aria-hidden': 'true' }, '↗'));
    }

    // Festival -> Wikipedia, per language. Chinese names resolve on zh.wikipedia
    // (including 国庆节's formal title), English ones on en.wikipedia.
    const WIKI = {
      元旦: ['https://zh.wikipedia.org/wiki/元旦', 'https://en.wikipedia.org/wiki/New_Year%27s_Day'],
      春节: ['https://zh.wikipedia.org/wiki/春节', 'https://en.wikipedia.org/wiki/Chinese_New_Year'],
      清明节: ['https://zh.wikipedia.org/wiki/清明节', 'https://en.wikipedia.org/wiki/Qingming_Festival'],
      劳动节: ['https://zh.wikipedia.org/wiki/劳动节', 'https://en.wikipedia.org/wiki/International_Workers%27_Day'],
      端午节: ['https://zh.wikipedia.org/wiki/端午节', 'https://en.wikipedia.org/wiki/Dragon_Boat_Festival'],
      中秋节: ['https://zh.wikipedia.org/wiki/中秋节', 'https://en.wikipedia.org/wiki/Mid-Autumn_Festival'],
      国庆节: ['https://zh.wikipedia.org/wiki/中华人民共和国国庆节', 'https://en.wikipedia.org/wiki/National_Day_of_the_People%27s_Republic_of_China'],
    };

    function holidayWikiUrl(name, lang) {
      const pair = WIKI[name];
      if (!pair) return null;
      return lang === 'en' ? pair[1] : pair[0];
    }

    function detailsBlock(now, sync, onSync, t, lang) {
      const today = dayKey(now);
      const upcoming = HOLIDAYS.sorted.filter((holiday) => holiday.to >= today).slice(0, 3);
      const rows = upcoming.map((holiday) => {
        const active = today >= holiday.from && today <= holiday.to;
        const daysAway = Math.ceil((Date.parse(holiday.from + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY);
        const tag = active ? t('holidayNow') : daysAway > 0 ? t('holidayLeft') + daysAway + t('holidayLeftTail') : t('holidayDone');
        const english = t('h' + holiday.name);
        const label = english === 'h' + holiday.name ? holiday.name : english;
        const wiki = holidayWikiUrl(holiday.name, lang);
        // English mode keeps the Chinese name alongside, so the calendar keeps
        // teaching the festival it is named after.
        return h('div', {
          key: holiday.name + holiday.from,
          className: 'dj-holiday' + (active ? ' dj-holiday--active' : ''),
        },
          h('a', {
            className: 'dj-holiday-name' + (wiki ? ' dj-holiday-link' : ''),
            href: wiki || undefined,
            target: wiki ? '_blank' : undefined,
            rel: wiki ? 'noopener noreferrer' : undefined,
            title: wiki || undefined,
            onClick: (event) => event.stopPropagation(),
          },
            label,
            lang === 'en' ? h('span', { className: 'dj-holiday-zh' }, holiday.name) : null
          ),
          h('span', { className: 'dj-holiday-dates' }, holiday.from.slice(5).replace('-', '/') + '–' + holiday.to.slice(5).replace('-', '/')),
          h('span', { className: 'dj-holiday-tag' }, tag)
        );
      });
      const syncLabel = sync.state === 'busy' ? t('syncBusy')
        : sync.state === 'ok' ? t('syncOk') + (sync.source ? ' · ' + sync.source : '')
        : sync.state === 'fail' ? t('syncFail')
        : t('sync');
      return h('div', { className: 'dj-block' },
        h('div', { className: 'dj-block-head' }, h('span', { className: 'dj-block-title' }, t('rules'))),
        h('ul', { className: 'dj-list' },
          h('li', { key: 'p' }, t('rulePrice')),
          h('li', { key: 'pk' }, t('rulePeak')),
          h('li', { key: 'id' }, t('ruleIdle'))
        ),
        h('div', { className: 'dj-block-head dj-block-head--tight' },
          h('span', { className: 'dj-block-title' }, t('holidays')),
          h('span', { className: 'dj-block-meta' }, holidayYearLabel() + ' · ' + t('holidayCaption'))
        ),
        rows.length > 0
          ? h('div', { className: 'dj-holidays' + (lang === 'en' ? ' dj-holidays--en' : '') }, rows)
          : h('div', { className: 'dj-meta' }, t('holidayNone')),
        h('div', { className: 'dj-meta-row' },
          h('span', { className: 'dj-meta' }, t('holidayNote')),
          h('button', { type: 'button', className: 'dj-link', onClick: onSync }, syncLabel),
          externalLink(HOLIDAY_URL, t('holidayLink'), 'holiday')
        )
      );
    }

    function Popover(props) {
      const { bounds, desc, reason, now, onPin, onClose, sync, onSync, t, lang, onSetLang, globalDot, onToggleGlobal } = props;
      const [showMore, setShowMore] = useState(false);
      const cardRef = useRef(null);
      const window = bounds.peak ? 'peak' : 'idle';
      const countText = bounds.end === null ? t('continuousIdle') : countdown(bounds.end - now);
      const arrow = bounds.end === null ? t('none') : bounds.peak ? t('toIdle') : t('toPeak');
      const nextWhen = bounds.end === null ? t('noPeak') : dayText(bounds.end, now, t) + ' ' + clock(minutesOf(shift(bounds.end)));

      // The card is centred on the chip; nudge it back if that would cross a
      // viewport edge.
      useEffect(() => {
        const card = cardRef.current;
        if (!card) return;
        const rect = card.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        let shiftBy = 0;
        if (rect.right > width - 8) shiftBy = width - 8 - rect.right;
        if (rect.left + shiftBy < 8) shiftBy = 8 - rect.left;
        if (shiftBy) card.style.transform = 'translateX(calc(-50% + ' + Math.round(shiftBy) + 'px))';
      }, []);

      return h('div', {
        ref: cardRef,
        className: 'dj-card dj-card--' + window,
        role: 'dialog',
        'aria-label': bounds.peak ? t('ariaPeak') : t('ariaIdle'),
        onMouseEnter: onPin,
        onClick: (event) => event.stopPropagation(),
      },
        h('div', { className: 'dj-card-head' },
          h('span', { className: 'dj-card-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dj-card-state' }, bounds.peak ? t('peakHours') : t('idleHours')),
          h('span', { className: 'dj-card-zone' }, t(reason)),
          h('span', { className: 'dj-card-range' }, rangeText(desc.range, t)),
          h('button', { type: 'button', className: 'dj-close', 'aria-label': t('close'), title: t('close'), onClick: onClose }, '×')
        ),
        h('div', { className: 'dj-nowline' },
          h('span', { className: 'dj-next-arrow' }, arrow),
          h('span', { className: 'dj-next-when' }, nextWhen),
          h('strong', { className: 'dj-next-count' }, countText)
        ),
        priceBlock(window, t, lang === 'en' ? 'usd' : 'cny'),
        showMore ? detailsBlock(now, sync, onSync, t, lang) : null,
        h('div', { className: 'dj-card-foot' },
          h('span', { className: 'dj-seg', role: 'group', 'aria-label': 'Language / 语言' },
            h('button', {
              type: 'button',
              className: 'dj-seg-btn' + (lang === 'zh' ? ' dj-seg-btn--active' : ''),
              'aria-pressed': lang === 'zh',
              title: '中文',
              onClick: (event) => {
                event.stopPropagation();
                onSetLang('zh');
              },
            }, '中'),
            h('button', {
              type: 'button',
              className: 'dj-seg-btn' + (lang === 'en' ? ' dj-seg-btn--active' : ''),
              'aria-pressed': lang === 'en',
              title: 'English',
              onClick: (event) => {
                event.stopPropagation();
                onSetLang('en');
              },
            }, 'EN')
          ),
          h('button', {
            type: 'button',
            className: 'dj-gtoggle' + (globalDot ? ' dj-gtoggle--on' : ''),
            'aria-pressed': globalDot,
            title: globalDot ? t('globalOn') : t('globalOff'),
            'aria-label': globalDot ? t('globalOn') : t('globalOff'),
            onClick: (event) => {
              event.stopPropagation();
              onToggleGlobal();
            },
          }),
          h('a', {
            className: 'dj-gh-link',
            href: GITHUB_URL,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: 'GitHub',
            'aria-label': 'GitHub',
            onClick: (event) => event.stopPropagation(),
          },
            h('svg', { className: 'dj-gh', viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true' },
              h('path', { d: GITHUB_MARK, fill: 'currentColor' }))
          ),
          h('span', { className: 'dj-foot-gap' }),
          h('button', { type: 'button', className: 'dj-link', onClick: () => setShowMore((value) => !value) }, showMore ? t('less') : t('more')),
          externalLink(pricingUrl(lang), t('priceLink'), 'price'),
          externalLink(USAGE_URL, t('usageLink'), 'usage')
        )
      );
    }

    /** `明天 周四` / `tomorrow Thu`, localized. */
    function dayText(instant, now, t) {
      const phrase = dayPhrase(instant, now);
      const day = t('wd' + phrase.weekday);
      return phrase.rel === null ? day : t(phrase.rel) + ' ' + day;
    }

    function PeakPrice(props) {
      const locale = props.locale;
      const [langOverride, setLangOverride] = useState(() => readLangOverride());
      const [globalDot, setGlobalDotState] = useState(globalDotOn);
      const [localeRevision, setLocaleRevision] = useState(0);
      const [now, setNow] = useState(() => Date.now());
      const [locked, setLocked] = useState(false);
      const [hover, setHover] = useState(false);
      const [holidayVersion, setHolidayVersion] = useState(0);
      const [sync, setSync] = useState({ state: 'idle', at: 0, source: '' });
      const rootRef = useRef(null);

      const harnessLang = (() => {
        try {
          const active = locale && typeof locale.getLocale === 'function' ? locale.getLocale().active : 'zh';
          return String(active || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
        } catch (error) {
          return 'zh';
        }
      })();
      void localeRevision;
      const lang = langOverride || harnessLang;
      const t = translator(lang);

      const open = hover || locked;

      async function syncHolidays() {
        setSync({ state: 'busy', at: 0, source: '' });
        const year = Number(dayKey(Date.now()).slice(0, 4));
        const years = {};
        const mirrors = new Set();
        for (const target of [year, year + 1]) {
          try {
            const result = await fetchHolidayYear(target);
            years[target] = result.entries;
            mirrors.add(result.mirror);
          } catch (error) {
            /* keep whatever year succeeded */
          }
        }
        const got = Object.keys(years).length;
        if (got > 0) {
          applyHolidayYears(years);
          const cached = readHolidayCache();
          writeHolidayCache({ ...(cached && cached.years ? cached.years : {}), ...years });
          setHolidayVersion((value) => value + 1);
        }
        setSync({ state: got > 0 ? 'ok' : 'fail', at: Date.now(), source: Array.from(mirrors).join(' / ') });
      }

      // Cached years first, then refresh when stale. Failure keeps the bundle.
      useEffect(() => {
        const cached = readHolidayCache();
        if (cached) {
          applyHolidayYears(cached.years);
          setHolidayVersion((value) => value + 1);
          setSync({ state: 'ok', at: cached.at, source: '' });
        }
        if (cached === null || Date.now() - cached.at >= HOLIDAY_SYNC_DAYS * DAY) syncHolidays();
      }, []);

      // Re-render when the harness language changes, unless a local override
      // is active (the footer toggle owns the language in that case).
      useEffect(() => {
        if (!locale || typeof locale.subscribe !== 'function') return undefined;
        return locale.subscribe(() => {
          setLocaleRevision((value) => value + 1);
          setNow(Date.now());
        });
      }, []);

      // Follow the frame-wide dot switch so both controls agree.
      useEffect(() => subscribeGlobalDot(setGlobalDotState), []);

      // One timer at the next boundary: the chip is static in between.
      const changeAt = nextChangeOf(windowOf(now), now);
      useEffect(() => {
        const delay = Math.max(400, changeAt - Date.now() + 700);
        if (!Number.isFinite(delay) || delay > 25 * HOUR) return undefined;
        const timer = setTimeout(() => setNow(Date.now()), delay);
        return () => clearTimeout(timer);
      }, [changeAt]);

      // Second timer at the pre-switch warning, which is earlier.
      useEffect(() => {
        const bounds = windowOf(now);
        if (bounds.end === null) return undefined;
        const delay = bounds.end - REMIND_MINUTES * MINUTE - Date.now();
        if (delay <= 0 || delay > 25 * HOUR) return undefined;
        const timer = setTimeout(() => setNow(Date.now()), delay + 800);
        return () => clearTimeout(timer);
      }, [changeAt]);

      useEffect(() => {
        function onVisibility() {
          if (!document.hidden) setNow(Date.now());
        }
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
      }, []);

      // The countdown advances only while the popover is open.
      useEffect(() => {
        if (!open) return undefined;
        const timer = setInterval(() => setNow(Date.now()), SECOND);
        return () => clearInterval(timer);
      }, [open]);

      useEffect(() => {
        if (!locked) return undefined;
        function onDocDown(event) {
          if (rootRef.current && !rootRef.current.contains(event.target)) setLocked(false);
        }
        function onKey(event) {
          if (event.key === 'Escape') setLocked(false);
        }
        document.addEventListener('mousedown', onDocDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDocDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [locked]);

      const bounds = windowOf(now);
      const desc = describe(bounds, now);
      const reason = reasonOf(zoneOf(now), bounds);
      const untilEnd = bounds.end === null ? null : bounds.end - now;
      const soon = untilEnd !== null && untilEnd > 0 && untilEnd <= REMIND_MINUTES * MINUTE;
      const soonLabel = soon
        ? clock(minutesOf(shift(bounds.end))) + ' ' + (bounds.peak ? t('priceDown') : t('priceUp'))
        : null;

      function onChipClick() {
        if (locked) {
          setLocked(false);
          return;
        }
        setLocked(true);
        setHover(false);
      }

      return h('div', {
        className: 'dj-root' + (open ? ' dj-root--open' : ''),
        ref: rootRef,
        'data-dj-holidays': holidayVersion,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
      },
        h('style', { key: 'dj-css' }, CSS),
        h('button', {
          type: 'button',
          className: 'dj-chip' + (bounds.peak ? ' dj-chip--peak' : ' dj-chip--idle'),
          'aria-expanded': open,
          title: (bounds.peak ? t('peakHours') : t('idleHours')) + ' · ' + rangeText(desc.range, t),
          'aria-label': bounds.peak ? t('ariaPeak') : t('ariaIdle'),
          onClick: onChipClick,
        },
          h('span', { className: 'dj-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'dj-state' }, bounds.peak ? t('peak') : t('idle')),
          bounds.peak || bounds.long ? null : h('span', { className: 'dj-half' }, t('half')),
          soonLabel ? h('span', { className: 'dj-soon' }, soonLabel) : null
        ),
        open
          ? h(Popover, {
              bounds,
              desc,
              reason,
              now,
              sync,
              t,
              lang,
              globalDot,
              onSetLang: (next) => {
                writeLangOverride(next);
                setLangOverride(next);
              },
              onSync: () => {
                syncHolidays();
              },
              onToggleGlobal: () => setGlobalDot(!globalDot),
              onPin: () => {
                if (!locked) setLocked(true);
              },
              onClose: () => {
                setLocked(false);
                setHover(false);
              },
            })
          : null
      );
    }

    /* ------------------------------------------------------------------
     * Frame-wide status dot: the chip needs a session, this does not. It sits
     * in `shell.overlay`, so it stays visible on panels without a composer.
     * ------------------------------------------------------------------ */

    function GlobalDot(props) {
      const locale = props.locale;
      const [on, setOn] = useState(globalDotOn);
      const [now, setNow] = useState(() => Date.now());

      useEffect(() => subscribeGlobalDot(setOn), []);

      useEffect(() => {
        if (!on) return undefined;
        const changeAt = nextChangeOf(windowOf(now), now);
        const delay = Math.max(400, changeAt - Date.now() + 700);
        if (!Number.isFinite(delay) || delay > 25 * HOUR) return undefined;
        const timer = setTimeout(() => setNow(Date.now()), delay);
        return () => clearTimeout(timer);
      }, [on, now]);

      useEffect(() => {
        function onVisibility() {
          if (!document.hidden) setNow(Date.now());
        }
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
      }, []);

      if (!on) return null;

      const harness = (() => {
        try {
          const active = locale && typeof locale.getLocale === 'function' ? locale.getLocale().active : 'zh';
          return String(active || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
        } catch (error) {
          return 'zh';
        }
      })();
      const t = translator(readLangOverride() || harness);
      const bounds = windowOf(now);
      const label = (bounds.peak ? t('peakHours') : t('idleHours')) + (bounds.peak ? '' : ' · ' + t('half'));

      return h('span', {
        className: 'dj-gdot ' + (bounds.peak ? 'dj-gdot--peak' : 'dj-gdot--idle'),
        role: 'status',
        title: label,
        'aria-label': label,
      });
    }

    /* ------------------------------------------------------------------
     * Styles — theme tokens only, plugin-prefixed classes. Rendered as a
     * <style> child so it is removed with the component.
     * ------------------------------------------------------------------ */

    const CSS = `
.dj-root {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  font: inherit;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary);
}
.dj-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 1px 4px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
}
.dj-chip--peak { color: var(--dsw-alias-state-error-primary); }
.dj-chip--idle { color: var(--dsw-alias-state-success-primary); }
.dj-root--open .dj-chip {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.dj-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; }
.dj-state { font-weight: 600; }
.dj-half {
  padding: 0 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: var(--dsw-alias-bg-base);
  background: var(--dsw-alias-state-success-primary);
}
.dj-soon {
  padding-left: 5px;
  border-left: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-state-warn-primary);
  font-family: ${'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'};
  font-size: 10px;
}
.dj-card {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  z-index: 40;
  box-sizing: border-box;
  width: 312px;
  max-width: calc(100vw - 40px);
  max-height: min(68vh, 440px);
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  font-size: 11.5px;
  line-height: 1.45;
  white-space: normal;
  text-align: left;
}
.dj-card--peak { border-top: 2px solid var(--dsw-alias-state-error-primary); }
.dj-card--idle { border-top: 2px solid var(--dsw-alias-state-success-primary); }
.dj-card-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; padding-right: 16px; }
.dj-card-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; align-self: center; }
.dj-card--peak .dj-card-dot { background: var(--dsw-alias-state-error-primary); }
.dj-card--idle .dj-card-dot { background: var(--dsw-alias-state-success-primary); }
.dj-card-state { font-weight: 700; }
.dj-card--peak .dj-card-state { color: var(--dsw-alias-state-error-primary); }
.dj-card--idle .dj-card-state { color: var(--dsw-alias-state-success-primary); }
.dj-card-zone { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dj-card-range { margin-left: auto; font-family: ${'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'}; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dj-close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.dj-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dj-nowline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 7px;
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 11px;
}
.dj-next-arrow { color: var(--dsw-alias-label-secondary); }
.dj-next-when { color: var(--dsw-alias-label-secondary); }
.dj-next-count {
  margin-left: auto;
  font-family: ${'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'};
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.dj-card--peak .dj-next-count { color: var(--dsw-alias-state-error-primary); }
.dj-card--idle .dj-next-count { color: var(--dsw-alias-state-success-primary); }
.dj-block { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dj-block-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px; }
.dj-block-head--tight { margin-top: 9px; }
.dj-block-title { font-weight: 600; }
.dj-block-meta { margin-left: auto; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dj-models { display: grid; gap: 4px; }
.dj-model {
  padding: 4px 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1);
}
.dj-model-head { display: flex; align-items: baseline; gap: 5px; }
.dj-model-name { font-family: ${'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'}; font-size: 10.5px; font-weight: 600; }
.dj-model-note { font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.dj-model-sw { margin-left: auto; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.dj-cars { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; margin-top: 3px; }
.dj-car { display: flex; align-items: baseline; gap: 4px; }
.dj-cell-label { font-size: 9.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dj-cell-value { font-family: ${'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'}; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dj-car--save .dj-cell-value { color: var(--dsw-alias-state-success-primary); }
.dj-list { margin: 0; padding-left: 13px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.dj-list li + li { margin-top: 2px; }
.dj-holidays {
  display: grid;
  row-gap: 3px;
  /* Name column is fixed per language so the three columns line up. */
  --dj-name: 44px;
}
.dj-holidays--en { --dj-name: 108px; }
.dj-holiday {
  display: grid;
  grid-template-columns: var(--dj-name) max-content 1fr;
  align-items: baseline;
  column-gap: 8px;
  font-size: 10.5px;
}
.dj-holiday-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.dj-holiday-link {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px dotted var(--dsw-alias-border-l2);
}
.dj-holiday-link:hover {
  color: var(--dsw-alias-brand-primary);
  border-bottom-color: currentColor;
}
.dj-holiday-zh { margin-left: 4px; font-weight: 400; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.dj-holiday-dates { font-family: ${'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'}; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dj-holiday-tag { justify-self: end; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dj-holiday--active .dj-holiday-tag { color: var(--dsw-alias-state-success-primary); }
.dj-meta { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dj-card-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 8px;
  margin-top: 9px;
  padding-top: 7px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 10px;
  color: var(--dsw-alias-label-secondary);
}
.dj-foot-gap { flex: 1; }
.dj-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.dj-link:hover { text-decoration: underline; }
.dj-seg {
  display: inline-flex;
  align-items: stretch;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  overflow: hidden;
}
.dj-seg-btn {
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10px;
  line-height: 16px;
  cursor: pointer;
}
.dj-seg-btn:first-child { border-radius: 999px 0 0 999px; }
.dj-seg-btn:last-child { border-radius: 0 999px 999px 0; }
.dj-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.dj-seg-btn--active {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dj-gtoggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}
.dj-gtoggle::after {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-label-secondary);
}
.dj-gtoggle--on {
  color: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary);
}
.dj-gtoggle--on::after {
  border: 0;
  background: currentColor;
}
.dj-gdot {
  position: fixed;
  right: 16px;
  bottom: 14px;
  z-index: 46;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.06);
  cursor: help;
}
.dj-gdot--idle { color: var(--dsw-alias-state-success-primary); }
.dj-gdot--peak { color: var(--dsw-alias-state-error-primary); }
@supports (color: color-mix(in srgb, red 10%, white)) {
  .dj-gdot { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 20%, transparent); }
}
@supports (color: color-mix(in srgb, red 10%, white)) {
  .dj-seg-btn--active {
    background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, var(--dsw-alias-bg-overlay));
  }
}
.dj-gh-link {
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-secondary);
  text-decoration: none;
}
.dj-gh-link:hover { color: var(--dsw-alias-label-primary); }
.dj-ext {
  color: var(--dsw-alias-brand-primary);
  font-size: 10px;
  text-decoration: none;
  white-space: nowrap;
}
.dj-ext:hover { text-decoration: underline; }
.dj-ext-arrow { margin-left: 2px; font-size: 9px; }
.dj-ext--gh { display: inline-flex; align-items: center; gap: 4px; }
.dj-gh { flex: none; display: block; }
.dj-meta-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
`;

    // Official pages. The docs split by language, so the price link follows the
    // panel language (the English page lists USD, the Chinese page CNY).
    const PRICING_URLS = {
      zh: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
      en: 'https://api-docs.deepseek.com/quick_start/pricing/',
    };
    const USAGE_URL = 'https://platform.deepseek.com/usage';
    const HOLIDAY_URL = 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm';
    const GITHUB_URL = 'https://github.com/shalom-lab/dsh-half-price';

    function pricingUrl(lang) {
      return lang === 'en' ? PRICING_URLS.en : PRICING_URLS.zh;
    }

    return {
      inject: ['slots'],
      // Exposed for local logic checks; ignored by the slot runtime.
      $peek: {
        windowOf, describe, reasonOf, zoneOf, dayKey, nextChangeOf, isPeakMinute, timeline,
        fromHolidayCn, applyHolidayYears, holidayYearLabel, rangeText, dayPhrase, fetchHolidayYear,
        translator, pricingUrl, holidayWikiUrl, dictZh: ZH, dictEn: EN,
      },
      apply(ctx) {
        const locale = ctx.get('locale');
        let t = fallbackT;
        if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          try {
            ctx.effect(() => {
              const disposers = [];
              // Register the common tags too: the harness may address the
              // locale as `zh-cn`/`en-us`, and the lookup uses the exact id.
              for (const tag of ['zh', 'zh-cn', 'zh-hans']) {
                try {
                  disposers.push(locale.register(NS, tag, ZH));
                } catch (error) {
                  /* duplicate registration after HMR: keep the existing one */
                }
              }
              for (const tag of ['en', 'en-us']) {
                try {
                  disposers.push(locale.register(NS, tag, EN));
                } catch (error) {
                  /* ditto */
                }
              }
              return () => {
                for (const dispose of disposers) {
                  try {
                    dispose();
                  } catch (error) {
                    /* already gone */
                  }
                }
              };
            }, 'peak-price-locale');
            const translate = locale.bind(NS);
            t = (key) => {
              const value = translate(key);
              return value === undefined || value === key ? (ZH[key] === undefined ? key : ZH[key]) : value;
            };
          } catch (error) {
            t = fallbackT;
          }
        }
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'peak-price',
          order: 2,
          label: () => t('peak') + '/' + t('idle'),
        }, (props) => h(PeakPrice, { ...props, locale })));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'half-price-global',
          order: 90,
          label: () => t('idle'),
        }, (props) => h(GlobalDot, { ...props, locale })));
      },
    };
  },
};

window.__ModuleLoader__.load(PLUGIN);
// Bridge for installs created before the package rename: the old profile row
// still addresses `@local/dsh-peak-price`, and the same factory serves it until
// the plugin is reinstalled under the new name.
window.__ModuleLoader__.load({ id: '@local/dsh-peak-price', factory: PLUGIN.factory });

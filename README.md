# DeepSeek Peak & Idle Price

A small, quiet [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that answers one question, all day long:

> **Am I paying full price for DeepSeek right now, or half?**

It renders a single chip under the composer. Hover it for the current window, the next switch, the live price table, and the holiday schedule. That is the whole plugin.

```
● Idle  50% off        ● Peak
```

![banner](docs/banner.svg)

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg">
  <img alt="No build step" src="https://img.shields.io/badge/build-none-brightgreen.svg">
  <img alt="Languages" src="https://img.shields.io/badge/language-English%20%7C%20中文-8a63d2.svg">
</p>

---

## Why this one

The marketplace already has peak/off-peak plugins. Most of them tick: a live countdown, a pulsing dot, a floating window that follows you. Those are useful, and they are also *loud* — something moving in your peripheral vision all day.

This one is deliberately the opposite:

- **Static chip.** It only changes when the billing window changes — four times on a weekday, plus midnight. No countdown, no animation.
- **No polling.** One `setTimeout` is armed at the next real boundary. The clock is not read sixty times a second; it is read when something can actually change.
- **No background network.** Holiday data is refreshed at most once every 30 days, from a local cache.
- **Zero dependencies, no build step.** `client.js` is plain JavaScript loaded by the harness module loader.

The countdown is still there — it just lives inside the popover, where you look on purpose.

## What you get

**The chip**

| State | Looks like | Meaning |
| --- | --- | --- |
| Idle | `● Idle  50% off` (green) | Half price |
| Peak | `● Peak` (red) | Full price |
| Within 10 min of a switch | `● Idle  50% off │ 09:00 price up` | Warns before the price changes |

**The popover** (hover, or click to pin it)

- Current window: `Idle hours · weekday off-peak · 18:00 to 09:00`
- Next switch: `→ peak · tomorrow Thu 09:00 · 14:32:07` (countdown runs only while the popover is open)
- Current price table for `deepseek-flash` and `deepseek-v4-pro`: cached / miss / output, with the saving cells highlighted
- `Rules & holidays` — expands to the billing rules, the upcoming statutory holidays with days remaining, a **Sync** button for the holiday dataset, and the official notice link
- Footer: language switch, pricing page, usage page. Every holiday name links to Wikipedia.

Every visible string is translated, including weekday names, relative dates, and the seven festivals.

## Install

The plugin has no dependencies, no install scripts, and no build step, so any of these paths works. All three use the harness **Settings → Plugins** install box.

| Path | What to paste | When |
| --- | --- | --- |
| **GitHub** (recommended) | `https://github.com/<you>/dsh-peak-price` | Normal use |
| **Tarball** | absolute path to a `.tgz` produced by `pnpm pack` | Offline / pinned version |
| **Local directory** | absolute path to the checkout | Development |

After installing, **restart the harness**. Client modules are cached by id, so a plain page refresh can keep serving the previous build.

Then look at the composer: the chip sits in `conversation.composer.dock`, next to the activity and token-usage entries.

### Verify it is alive

Open the popover and expand **Rules & holidays**. You should see `2026–2027` next to the holiday table. Press **Sync** — it should turn into `Synced · jsDelivr` (or `· GitHub raw`). If it says `Sync failed`, your renderer cannot reach the mirrors; the bundled years still work.

## The billing rule

| Window | Beijing time | Price |
| --- | --- | --- |
| Peak | Mon–Fri, 09:00–12:00 and 14:00–18:00, excluding statutory holidays | Standard |
| Idle | Everything else, including weekends and holidays all day | 50% of peak |

Source: [Models & Pricing (EN)](https://api-docs.deepseek.com/quick_start/pricing/) · [模型 & 价格 (中文)](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)

> The old `00:30–08:30` off-peak discount was retired in 2025. The current schedule is the two weekday blocks above.

Make-up workdays (`调休`) are handled: a Saturday that the State Council turns into a working day is billed as a weekday, and it shows `make-up workday peak` in the popover.

### Prices

The Chinese docs quote CNY and the English docs quote USD, so the table follows the panel language:

| Model | Window | Cached input | Miss input | Output |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | idle | ¥0.02 | ¥1 | ¥4 |
| | peak | ¥0.04 | ¥2 | ¥8 |
| `deepseek-v4-pro` | idle | ¥0.15 | ¥4.5 | ¥13.5 |
| | peak | ¥0.30 | ¥9 | ¥27 |

In English mode the same cells are shown in USD (`$0.003 / $0.15 / $0.6` for flash idle, and so on), matching the English pricing page exactly.

## Holiday data

Chinese public holidays are administrative, not computable — the State Council publishes next year's schedule each November. So the plugin does three things:

1. **Bundles two years**: 2026 (国办发明电〔2025〕7 号) and 2027 (国办发明电〔2026〕10 号, published 2026-11-05), including make-up workdays.
2. **Syncs the rest** from [holiday-cn](https://github.com/NateScarlet/holiday-cn), which republishes each notice as JSON within hours, with four mirrors and a 6 s timeout each:
   `jsDelivr → jsDelivr (fastly) → GitHub raw → Coding`
   Responses are validated (must parse and contain `days`), so a mirror returning a login page is skipped instead of trusted.
3. **Caches for 30 days** in `localStorage`. Any failure falls back to the bundled table; nothing breaks offline.

Years the table does not cover are still priced by weekday/weekend arithmetic and labelled `year not in table` in the popover.

## Language

The panel follows the harness language setting, and the footer has a `中 | EN` segmented switch that overrides it for this plugin only (persisted in `localStorage`).

In English mode holiday names keep their Chinese original — `Spring Festival 春节` — because a calendar is also a place to learn what the festival is called.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No chip under the composer | The client module was still cached from an older build | Restart the harness, not just the page |
| `Sync failed` after 4 mirrors | The renderer cannot reach any mirror (offline / blocked) | Nothing breaks: 2026–2027 are bundled. Retry later or open the official notice link |
| Chip says `year not in table` | The date is outside the bundled years and no sync has run yet | Press **Sync**, or add the year to `SEED_HOLIDAYS` |
| Time looks off by hours | The window is always Beijing time (UTC+8), regardless of your machine's zone | Expected — the popover prints `Beijing time` |
| Prices differ from the page you opened | Chinese page quotes CNY, English page quotes USD | Switch the panel language; the table follows it |

## Privacy

- No telemetry, no analytics, no account access.
- The only outbound requests are the holiday sync above (at most once per 30 days, only when the cache is stale or you press Sync).
- Local storage keys: `dsh-peak-price:holidays:v1` (cached years) and `dsh-peak-price:lang` (language override).

## Repo layout

```
client.js              the whole plugin: data, scheduling, i18n, view, styles
index.js               empty host half (the bundle needs a host row)
cordis.patch.yml       bundle patch: inserts the dsh-peak-price row
locale/{en,zh}.json    plugin title + description for the plugin manager
icon.svg               plugin icon
dev/logic-check.mjs    offline assertions: windows, holidays, dictionaries
dev/online-check.mjs   real network fetch through the mirror chain
dev/mirror-check.mjs   mirror fallback and total-failure behaviour
```

## Development

Everything is plain JavaScript; there is nothing to build.

```bash
node dev/logic-check.mjs      # 19 time cases, 2027 data, range strings, i18n parity
node dev/online-check.mjs     # hits the real mirrors, converts holiday-cn, applies it
node dev/mirror-check.mjs     # blocks jsDelivr, expects GitHub raw; blocks all, expects rejection
```

The tuning knobs live at the top of `client.js`:

| Constant | What it controls |
| --- | --- |
| `PEAK_WINDOWS` | The two peak blocks, in Beijing minutes |
| `REMIND_MINUTES` | How early the chip warns before a switch (default 10) |
| `MODELS` | Prices per model, both currencies |
| `SEED_HOLIDAYS` | The bundled years |
| `HOLIDAY_MIRRORS` | Sync sources, in order |

## Publishing

The package is currently named `@local/dsh-peak-price` and marked `private`, because it was installed from a local directory. To publish:

1. Pick an available name — e.g. `dsh-peak-price` or `@your-scope/dsh-peak-price` — and update `name` in `package.json`.
2. Set `"private": false`, fill in `repository`, `homepage`, and `author`.
3. `npm publish` (or push the repo and install from the GitHub URL instead — no registry needed).

Nothing in the code depends on the package name.

**Before announcing it**, add two or three real screenshots to `docs/` (one light, one dark, one with the popover open) and link them near the top. The current banner is an illustration of the chip, not a screenshot.

## License

[MIT](LICENSE). The icon and banner are original artwork included with the plugin.

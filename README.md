<p align="center">
  <img src="docs/banner.svg" alt="DeepSeek Half Price" width="100%">
</p>

<h1 align="center">DeepSeek Half Price</h1>

<p align="center">
  English · <a href="README.zh.md">中文</a>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg">
  <img alt="No build step" src="https://img.shields.io/badge/build-none-brightgreen.svg">
</p>

<p align="center">
  A quiet chip in the composer status row that tells you whether DeepSeek<br>
  is billing at <strong>peak or half price</strong>. Hover it for the next switch,<br>
  live prices, and Chinese holidays.
</p>

<p align="center">
  <img src="docs/preview.png" alt="The popover in Chinese and English" width="860">
</p>

---

## Features

| Feature | Detail |
| --- | --- |
| **Static chip** | `● 空闲 五折` / `● Peak`. Changes only when the billing window changes — no countdown, no animation. |
| **Popover** | Current window, next switch with countdown, live price table, holidays, sync, official links. |
| **10-minute warning** | `│ 09:00 涨价` appears on the chip just before the rate changes. |
| **Quiet by design** | One timer per boundary, one holiday sync per 30 days, no telemetry. |

<p align="center">
  <img src="docs/location.png" alt="Where the chip lives in the composer status row" width="860">
</p>

<p align="center">
  <sub>The chip sits in the composer status row, beside cache and context stats.</sub>
</p>

## Install

Hand this to an agent:

```text
Install this DeepSeek Harness plugin for me: https://github.com/shalom-lab/dsh-half-price
Use the plugin manager, confirm the dsh-half-price row is active, and tell me if a restart is needed.
```

Or paste the GitHub URL into **Settings → Plugins**, then **restart the harness** — client modules are cached by id.

```
https://github.com/shalom-lab/dsh-half-price
```

## Pricing rule

| Window | Beijing time | Price |
| --- | --- | :---: |
| Peak | Mon–Fri 09:00–12:00 and 14:00–18:00, excluding holidays | Full |
| Idle | Everything else, including weekends and holidays | 50% |

Make-up workdays count as weekdays. The old `00:30–08:30` discount was retired in 2025.

[Chinese pricing page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) · [English pricing page](https://api-docs.deepseek.com/quick_start/pricing/)

## Prices

Per 1M tokens. English mode shows the USD list from the English docs.

| Model | Window | Cached input | Miss input | Output |
| --- | --- | ---: | ---: | ---: |
| `deepseek-flash` | Idle | ¥0.02 | ¥1 | ¥4 |
| | Peak | ¥0.04 | ¥2 | ¥8 |
| `deepseek-v4-pro` | Idle | ¥0.15 | ¥4.5 | ¥13.5 |
| | Peak | ¥0.30 | ¥9 | ¥27 |

## Holidays

| | |
| --- | --- |
| **Bundled** | 2026 and 2027, including 调休 workdays. |
| **Synced** | Other years come from [holiday-cn](https://github.com/NateScarlet/holiday-cn) through four mirrors, cached for 30 days. |
| **Safe** | If you are offline or every mirror is down, the bundled years still work. |

## Language and privacy

The plugin follows the harness language. The `中 | EN` switch overrides it for this plugin only. English mode keeps the Chinese festival names, e.g. `Spring Festival 春节`.

No telemetry, no account access. The only outbound request is the holiday sync.

## Development

```bash
node dev/logic-check.mjs      # windows, ranges, holidays, i18n parity
node dev/online-check.mjs     # real mirror fetch
node dev/mirror-check.mjs     # fallback and total failure
```

## License

[MIT](LICENSE)

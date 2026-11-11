<p align="center">
  <img src="docs/banner.svg" alt="DeepSeek 半价时段" width="100%">
</p>

<h1 align="center">DeepSeek 半价时段</h1>

<p align="center">
  <a href="README.md">English</a> · 中文
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg">
  <img alt="No build step" src="https://img.shields.io/badge/build-none-brightgreen.svg">
</p>

<p align="center">
  一个安静的小胶囊，长在输入框下方的状态行里，<br>
  告诉你 DeepSeek 现在是<strong>原价还是半价</strong>。<br>
  悬停即可看到下次切换、实时价目和节假日。
</p>

<p align="center">
  <img src="docs/preview.png" alt="中英两种语言的弹层" width="860">
</p>

---

## 功能

| 功能 | 说明 |
| --- | --- |
| **静止的胶囊** | `● 空闲 五折` / `● 高峰`。只在计费时段真正变化时更新，没有倒计时，也没有动画。 |
| **弹层** | 当前时段、下次切换倒计时、实时价目、节假日、同步状态、官方链接。 |
| **提前 10 分钟提醒** | 变价前，胶囊尾部会出现 `│ 09:00 涨价`。 |
| **尽量安静** | 每个边界一个定时器，假期数据每 30 天同步一次，没有埋点。 |

<p align="center">
  <img src="docs/location.png" alt="胶囊在输入框状态行中的位置" width="860">
</p>

<p align="center">
  <sub>胶囊位于输入框下方的状态行，挨着缓存和上下文统计。</sub>
</p>

## 安装

把这段交给 Agent：

```text
把这个 DeepSeek Harness 插件装到我的环境里：https://github.com/shalom-lab/dsh-half-price
请用插件管理器安装并启用，确认 dsh-half-price 这一行是 active，然后告诉我需不需要重启。
```

或者把 GitHub 地址粘到 **设置 → 插件**，然后**重启 Harness**——客户端模块按 id 缓存。

```
https://github.com/shalom-lab/dsh-half-price
```

## 计费规则

| 时段 | 北京时间 | 价格 |
| --- | --- | :---: |
| 高峰 | 周一至周五 09:00–12:00、14:00–18:00，不含法定节假日 | 原价 |
| 空闲 | 其余全部时间，含周末与节假日 | 半价 |

调休上班日按工作日计。旧的 `00:30–08:30` 错峰优惠已于 2025 年取消。

[中文价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) · [English pricing page](https://api-docs.deepseek.com/quick_start/pricing/)

## 价目

每百万 tokens。英文模式显示英文文档中的美元价。

| 模型 | 时段 | 命中缓存 | 未命中 | 输出 |
| --- | --- | ---: | ---: | ---: |
| `deepseek-flash` | 空闲 | ¥0.02 | ¥1 | ¥4 |
| | 高峰 | ¥0.04 | ¥2 | ¥8 |
| `deepseek-v4-pro` | 空闲 | ¥0.15 | ¥4.5 | ¥13.5 |
| | 高峰 | ¥0.30 | ¥9 | ¥27 |

## 假期

| | |
| --- | --- |
| **内置** | 2026 与 2027，含调休上班日。 |
| **同步** | 其余年份来自 [holiday-cn](https://github.com/NateScarlet/holiday-cn)，四条镜像依次尝试，缓存 30 天。 |
| **兜底** | 离线或镜像全部不可用时，内置年份仍可正常工作。 |

## 语言与隐私

默认跟随 Harness 的语言。底栏 `中 | EN` 可只覆盖本插件。英文模式会保留节日的中文原名，例如 `Spring Festival 春节`。

没有埋点，也不读取账户。唯一的出站请求是假期同步。

## 开发

```bash
node dev/logic-check.mjs      # 时段、区间、假期、中英字典对齐
node dev/online-check.mjs     # 真实拉镜像
node dev/mirror-check.mjs     # 回退与全挂
```

## 许可

[MIT](LICENSE)

# DeepSeek 半价时段

*[English](README.md) · 中文*

一个安静的小插件，常驻在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 对话框下方，只回答一件事：

> **我现在按原价付费，还是半价？**

它只占一个胶囊：悬停展开当前时段、下次切换、实时价目表和节假日表。就这些。

`dsh-half-price` — [github.com/shalom-lab/dsh-half-price](https://github.com/shalom-lab/dsh-half-price)

![中英两种语言的弹层](docs/preview.png)

<p align="center"><sub>同一个弹层，两种语言：当前时段与下次切换、实时价目（中文人民币 / 英文美元）、底栏的语言开关与链接。</sub></p>

---

## 为什么用它

同类插件基本都在"动"——秒级倒计时、呼吸的圆点、跟随你的浮窗。它们有用，但也吵。

这个刻意反过来做：

- **静止的胶囊**。只在计费时段真正切换时才变（工作日 4 次 + 午夜 1 次），没有倒计时、没有动画
- **不轮询**。下一个边界只挂一个 `setTimeout`，不是每秒读一次时钟
- **不后台联网**。假期数据最多 30 天同步一次，平时读本地缓存
- **零依赖、免构建**。`client.js` 是纯 JS，由 Harness 的模块加载器直接加载

倒计时没丢，只是放进了弹层里——你主动看的时候才动。

## 你会得到什么

**胶囊**

| 状态 | 样子 | 含义 |
| --- | --- | --- |
| 空闲 | `● 空闲  五折`（绿） | 半价 |
| 高峰 | `● 高峰`（红） | 原价 |
| 距切换 ≤10 分钟 | `● 空闲  五折 │ 09:00 涨价` | 变价前提醒 |

**弹层**（悬停，或点击固定）

- 当前时段：`空闲时段 · 工作日非高峰 · 18:00 至 09:00`
- 下次切换：`→ 转高峰 · 明天 周四 09:00 · 14:32:07`（倒计时只在弹层打开时走）
- `deepseek-flash` / `deepseek-v4-pro` 的当前价目：命中 / 未命中 / 输出，省一半的格子标绿
- `规则与假期` 展开后：计费规则、接下来的法定节假日与剩余天数、假期数据**同步**按钮、官方通知原文
- 底栏：语言开关、官方价格页、用量查询；每个节日名可点，跳维基百科对应语言版本

所有可见文案都有中英两版，包括星期、相对日期和七个节日。

### 它长在哪

不是浮窗。胶囊在输入框下方那条**状态行**里——本来就显示 token 统计、缓存命中率、上下文占用的那一排：

![胶囊的位置](docs/location.png)

## 安装

插件没有依赖、没有安装脚本、没有构建步骤，三种方式都走 Harness 的 **设置 → 插件** 安装框：

| 方式 | 粘贴什么 | 适用 |
| --- | --- | --- |
| **GitHub**（推荐） | `https://github.com/shalom-lab/dsh-half-price` | 日常使用 |
| **tarball** | `pnpm pack` 产出的 `.tgz` 绝对路径 | 离线 / 锁版本 |
| **本地目录** | 仓库目录的绝对路径 | 开发调试 |

装完**必须重启 Harness**。客户端模块按 id 缓存，只刷新页面可能还在跑上一版。

然后看对话框下方：胶囊在 `conversation.composer.dock` 里，和活动、token 用量那几行并排。

### 或者让 Agent 装

把下面这段贴给能执行工具的 Harness 会话：

```text
把这个 DeepSeek Harness 插件装到我的环境里：
https://github.com/shalom-lab/dsh-half-price

请用插件管理器安装并启用，确认 dsh-half-price 这一行是 active（不是 failed / disabled），
然后告诉我需不需要重启 Harness。
```

### 确认装好了

打开弹层，展开「规则与假期」，应能看到 `2026–2027`。点「同步」，它应该变成 `已同步 · jsDelivr`（或 `· GitHub raw`）。如果显示「同步失败」，说明渲染进程连不上镜像源，内置年份仍然可用。

## 计费规则

| 时段 | 北京时间 | 价格 |
| --- | --- | --- |
| 高峰 | 周一至周五 09:00–12:00、14:00–18:00，不含法定节假日 | 原价 |
| 空闲 | 其余全部时间，含周末与法定节假日全天 | 原价的一半 |

来源：[模型 & 价格（中文）](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) · [Models & Pricing（EN）](https://api-docs.deepseek.com/quick_start/pricing/)

> 旧的每日 `00:30–08:30` 错峰优惠已在 2025 年取消，现行规则就是上面两个工作日时段。

**调休**也处理了：国务院规定的上班周末按工作日计高峰，弹层里会标「调休上班日」。

### 价目

中文文档用人民币、英文文档用美元，所以价目表跟随界面语言：

| 模型 | 时段 | 命中缓存 | 未命中 | 输出 |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | 空闲 | ¥0.02 | ¥1 | ¥4 |
| | 高峰 | ¥0.04 | ¥2 | ¥8 |
| `deepseek-v4-pro` | 空闲 | ¥0.15 | ¥4.5 | ¥13.5 |
| | 高峰 | ¥0.30 | ¥9 | ¥27 |

英文模式下同样的格子显示美元（flash 空闲 `$0.003 / $0.15 / $0.6` 等），与英文价格页逐项一致。

## 假期数据

中国的法定节假日是行政安排，算不出来——国务院每年 11 月发布次年安排。所以做了三层：

1. **内置两年**：2026（国办发明电〔2025〕7 号）与 2027（国办发明电〔2026〕10 号，2026-11-05 发布），含调休上班日
2. **自动同步其余年份**：来自 [holiday-cn](https://github.com/NateScarlet/holiday-cn)，四条镜像依次尝试，每条 6 秒超时：
   `jsDelivr → jsDelivr (fastly) → GitHub raw → Coding`
   返回内容会校验（必须能解析出 `days`），登录页之类的垃圾响应会被跳过
3. **缓存 30 天** 在 `localStorage`。任何一步失败都回落到内置表，离线照常工作

表里没有的年份仍按工作日/周末推算，弹层里标注「未收录年份」。

## 语言

默认跟随 Harness 的语言设置；底栏的 `中 | EN` 开关可以只给本插件覆盖（记在 `localStorage`）。

英文模式里节日名会保留中文原名——`Spring Festival 春节`——日历本来就该顺便告诉别人这个节叫什么。

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 对话框下方没有胶囊 | 客户端模块还是旧缓存 | 重启 Harness，不是刷新页面 |
| 四条镜像都 `同步失败` | 渲染进程连不上镜像（离线 / 被墙） | 不影响使用，2026–2027 已内置；稍后重试或看官方通知原文 |
| 显示 `未收录年份` | 日期超出内置年份且还没同步过 | 点「同步」，或把年份加进 `SEED_HOLIDAYS` |
| 时间差几小时 | 计费窗口永远按北京时间（UTC+8）算 | 正常，弹层里也标了「北京时间」 |
| 数字和你打开的页面不一致 | 中文页人民币、英文页美元 | 切换面板语言，价目表会跟着换 |

## 隐私

- 没有埋点、没有统计、不碰账户
- 唯一的出站请求是上面的假期同步（最多 30 天一次，且只有缓存过期或你点同步时）
- 本地存储键：`dsh-half-price:holidays:v1`（缓存的年份）、`dsh-half-price:lang`（语言覆盖）

## 仓库结构

```
client.js              整个插件：数据、调度、i18n、视图、样式
index.js               空的 Host 半边（bundle 需要一行 Host 记录）
cordis.patch.yml       bundle 补丁：插入 dsh-half-price 这一行
locale/{en,zh}.json    插件管理器显示的名称与描述
icon.svg               插件图标
dev/logic-check.mjs    离线断言：时段、假期、字典
dev/online-check.mjs   真实联网跑一遍镜像链
dev/mirror-check.mjs   镜像回退与全挂时的行为
docs/make-previews.py  从两张截图重建 README 的对比图
```

## 开发

全是纯 JavaScript，没有构建。

```bash
node dev/logic-check.mjs      # 19 个时段场景 + 2027 数据 + 区间字符串 + 中英字典对齐
node dev/online-check.mjs     # 真实拉镜像、转换 holiday-cn、应用到运行时
node dev/mirror-check.mjs     # 屏蔽 jsDelivr 应回退到 GitHub raw；全挂应立刻拒绝
```

可调参数都在 `client.js` 顶部：

| 常量 | 控制什么 |
| --- | --- |
| `PEAK_WINDOWS` | 两个高峰块（北京时间的分钟数） |
| `REMIND_MINUTES` | 切换前多久开始提醒（默认 10 分钟） |
| `MODELS` | 各模型单价，两种货币 |
| `SEED_HOLIDAYS` | 内置年份 |
| `HOLIDAY_MIRRORS` | 同步镜像，按顺序尝试 |

## 发布

包名 `dsh-half-price`，`private: false`，`repository` / `homepage` / `bugs` 都指向 `shalom-lab/dsh-half-price`。两种发布方式：

1. **只发 GitHub（推荐）**——推仓库，用户在 **设置 → 插件** 里粘贴地址即可，不需要 npm、不需要构建
2. **npm**——`npm publish`，这个名字在公共源上还空着

发布前建议用最终样式重截两张图，跑一次 `python docs/make-previews.py` 更新对比图。当前的中文截图早于最后一次切换样式调整，所以两边的底栏略有差异。

GitHub 仓库 **Settings → General → About** 可以填：

| 字段 | 值 |
| --- | --- |
| Description | `A quiet chip under the DeepSeek Harness composer: peak or half price at a glance, with the next switch, live CNY/USD prices, and Chinese holidays. Zero dependencies.` |
| Website | 留空（或指向本 README） |
| Topics | `dsh` `dsh-plugin` `deepseek` `deepseek-harness` `pricing` `peak-hours` `off-peak` `half-price` `i18n` |

## 许可

[MIT](LICENSE)。图标与横幅为原创素材，随插件一起分发。

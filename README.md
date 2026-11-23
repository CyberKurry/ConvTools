# ConvTools

<p align="center">
  <strong>面向 Chrome 与 Edge 的本地优先、模块化开发者工具箱扩展。</strong><br>
  <em>快速、私密，并以零网络为设计目标。没有追踪器、臃肿的 AI 噱头，只有简洁实用的开发者体验。</em>
</p>

<p align="center">
  <img src="public/icon/128.png" alt="ConvTools Logo" width="80" height="80" />
</p>

<p align="center">
  <a href="#核心特性">核心特性</a> •
  <a href="#模块目录">模块目录</a> •
  <a href="#扩展界面">扩展界面</a> •
  <a href="#隐私与安全模型">隐私与安全</a> •
  <a href="#安装">安装</a> •
  <a href="#模块开发">SDK 与扩展</a> •
  <a href="#ci-与发布">CI 与发布</a> •
  <a href="#许可证">许可证</a> •
  <a href="README.en.md">English README</a>
</p>

---

## 核心特性

- **100% 本地优先与零遥测**：所有内置模块完全在设备本地执行。不包含遥测、远程分析、广告脚本；内置转换功能不会向外发送网络请求。
- **微内核与模块化工具 SDK**：功能以独立模块接入精简核心内核。模块通过严格类型声明自身的能力、翻译、界面和选区操作。
- **自适应多界面架构**：可以在不同工作场景中使用工具：
  - **弹窗快捷面板**：380px 轻量面板，支持拖拽排序和键盘排序。
  - **独立工作台**：桌面级工作空间，提供即时模块关键词过滤、画布预览和按模块划分的历史记录。
  - **选区浮层**：通过 Shadow DOM 注入网页的轻量浮动 HUD，就地完成转换。
  - **集中式设置**：统一管理语言、浅色/深色主题、权限审计和存储清理。
- **实用的人机体验**：精细排版、高对比度系统字体、26–30px 紧凑控件、比例协调的图标和字体，以及不喧宾夺主的动效。
- **Web Worker 解耦**：大文件 Base64 分块流处理和 2× 分享卡片画布渲染都运行在可取消的 Web Worker 中，保持界面响应。

---

## 模块目录

ConvTools 当前内置三个生产模块：

| 模块 ID | 模块名称 | 核心能力 | 界面入口 | 选区操作 | Web Worker | 新增权限 |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **`base64`** | **Base64** | 文本/Data URL 编解码、宽松补齐、最大 50 MB 文件分块处理 | 弹窗、工作台 | `encode`、`decode` | 是（50 MB 分块） | 无 |
| **`timestamp`** | **时间戳** | Epoch 秒/毫秒 ⇄ ISO UTC/本地日期时间、原生 Temporal 夏令时处理、实时时钟、IANA 时区选择 | 弹窗、工作台 | `convert` | 否 | 无 |
| **`share-card`** | **分享卡片** | 带离线二维码的分享图、3 套主题和 2 种比例 | 工作台 | `generate` | 是（2× PNG 绘制） | 无 |

---

## 内置模块详解

### 1. Base64（`base64`）

同时面向短文本和大型二进制文件的稳健 Base64 引擎。

- **格式灵活**：支持标准 Base64（RFC 4648）、URL-safe Base64（`-_`）和带 MIME 信息的 Data URL。
- **宽松模式与严格模式**：
  - *宽松模式*会清除多余空白、规范化 URL-safe 字符，并补齐缺失的 padding（`=`），同时显示清晰的本地化修正提示。
  - *严格模式*执行规范 Base64 校验，拒绝格式错误的输入，不静默修复。
- **文件分块流处理**：使用独立 Web Worker 编解码最大 **50 MB** 的文件，提供实时进度、受控内存使用和即时取消。
- **安全的二进制提示**：识别二进制输出并提供直接下载为 `.bin` 的选项，不根据文件魔数擅自猜测扩展名。

### 2. 时间戳（`timestamp`）

完全使用现代 ECMAScript 原生 `Temporal` API 的精确时间戳转换器。

- **双向转换**：Unix 秒/毫秒时间戳与 ISO 8601 UTC/本地日期时间可以互相转换。
- **智能单位判断**：结合数字位数和可表示的时间范围判断输入是秒还是毫秒；无法可靠判断时会明确要求选择。
- **原生夏令时（DST）处理**：本地时间落在秋季回拨产生的重复时刻时，提示选择较早或较晚的偏移量，不静默误解时间。
- **实时钟状态**：显示实时同步的时钟，并提供一键“使用当前时间”填充。
- **全局时区选择器**：提供完整 IANA 时区列表、即时关键词搜索和浏览器时区识别。

### 3. 分享卡片（`share-card`）

受简洁的编辑类引用卡片设计启发，把文字转换为适合发布的图片卡片。

- **3 套手工设计的主题**：
  - `Paper`（素笺）：干净温暖的米白色极简风格与细致排版。
  - `Ink`（墨岩）：适合现代信息流的高对比度深色板岩主题。
  - `Mist`（雾蓝）：柔和舒缓的青灰色主题与轻量点缀。
- **2 种比例**：`3:4 Portrait`（适合移动分享和故事）与 `1:1 Square`（适合头像和方形信息流）。
- **100% 离线二维码**：使用 `qrcode-generator` 在本地把来源网页链接编码为矢量二维码，读者可以扫码访问原文。
- **自动提取页面元数据**：通过 `activeTab` 和 `scripting` 从宿主页面读取 `document.title`、`meta[name=description]`、`og:title` 和 `og:site_name`。
- **高 DPI 2× 导出**：通过 `OffscreenCanvas` Web Worker 输出最高 2160×2880 像素的图片，支持一键复制 `image/png`，剪贴板不可用时自动降级为文件下载。

---

## 扩展界面

```text
┌─────────────────────────────────────────────────────────────┐
│                      ConvTools Core                         │
└──────┬───────────────┬──────────────────┬──────────────┬────┘
       │               │                  │              │
       ▼               ▼                  ▼              ▼
┌──────────────┐┌──────────────┐┌───────────────────┐┌──────────────┐
│  Popup App   ││  Workbench   ││ Selection Overlay ││ Options App  │
│ (Compact 380)││  (Workspace) ││   (Shadow DOM)    ││  (Settings)  │
└──────────────┘└──────────────┘└───────────────────┘└──────────────┘
```

1. **弹窗（`PopupApp`）**：
   - 380px 紧凑视图，适合即时转换。
   - 基于 `@dnd-kit` 的拖拽标签排序，以及完整的键盘导航（“左移”/“右移”）。
   - 可以动态添加或移除快捷模块，并持久化标签顺序。

2. **工作台（`WorkbenchApp`）**：
   - 适合持续处理任务的全页工作空间。
   - 15rem 粘性侧栏和即时关键词过滤。
   - 支持历史记录查看、单条清理和全部清理。
   - 接收选区操作传来的外部会话交接。

3. **选区浮层（`SelectionOverlay`）**：
   - 用户触发上下文菜单操作后注入网页。
   - 使用开放的 **Shadow DOM** 隔离宿主页面与扩展样式，避免 CSS 相互泄漏。
   - 根据选区附近空间自适应定位，并保持在视口范围内。
   - 支持一键复制并显示“已复制！”反馈，可用 `Escape` 或点击外部关闭。

4. **选项与设置（`OptionsApp`）**：
   - 全局语言：自动（跟随浏览器）、English 或简体中文。
   - 主题：跟随系统、浅色或深色。
   - 默认回退时区。
   - 细粒度模块控制：启用/停用、撤销可选权限、清除模块历史，或“停用并删除全部数据”。

---

## 隐私与安全模型

ConvTools 将隐私与安全作为一等约束：

- **严格的最小权限**：
  - `storage`：存储扩展偏好、快捷模块顺序和本地设置。
  - `contextMenus`：创建文本选区右键操作。
  - `activeTab` 与 `scripting`：只有在用户明确点击上下文菜单后，才临时访问页面以读取元数据或注入选区浮层。
  - **禁止权限**：永不申请 `<all_urls>`、`tabs`、永久后台剪贴板或 `unlimitedStorage`。
- **无痕隔离**：
  - 在无痕窗口中，严格禁止向持久化存储（`storage.local`、IndexedDB）写入。
  - 设置变更只保存在内存覆盖层中，历史记录完全关闭。
- **本地配额历史**：
  - 历史默认**关闭**，必须由用户主动启用。
  - 只保存在设备本地的 IndexedDB 中，单模块最多 **500 条**，全局最多 **5 MB**。
  - 文件历史只保存**元数据**（文件名、字节数、MIME、操作和时间戳）；文件内容与 Base64 载荷不会写入磁盘。
- **Shadow DOM 隔离**：
  - 注入浮层使用 Shadow DOM 和 `:host { all: initial; }` 重置样式，阻断扩展与宿主页面之间的 CSS 泄漏。

---

## 浏览器要求

| 浏览器 | 最低版本 | 说明 |
| :--- | :---: | :--- |
| **Google Chrome** | **≥ 144** | 支持原生 ECMAScript `Temporal` API |
| **Microsoft Edge** | **≥ 144** | 支持原生 ECMAScript `Temporal` API |

> **说明**：扩展 Manifest 严格声明了 `"minimum_chrome_version": "144"`，因为时间戳模块依赖原生 `Temporal`，不额外打包 polyfill。

---

## 安装

### 从源码手动加载未打包扩展

1. **前置条件**：安装 Node.js `22.14.0`（或更新的 22.x）和 `pnpm` `11.21.0`。
2. **克隆并安装依赖**：
   ```bash
   git clone https://github.com/CyberKurry/ConvTools.git
   cd ConvTools
   pnpm install --frozen-lockfile
   ```
3. **构建扩展**：
   ```bash
   # 构建 Chrome 版本
   pnpm build:chrome

   # 或构建 Microsoft Edge 版本
   pnpm build:edge
   ```
4. **加载到浏览器**：
   - 打开 `chrome://extensions`（或 `edge://extensions`）。
   - 开启**开发者模式**（通常在右上角或侧边栏）。
   - 点击**加载已解压的扩展程序**，选择 `.output/chrome-mv3`（或 `.output/edge-mv3`）目录。

---

## 模块开发

ConvTools 提供自动化的模块生成与校验流程。

### 添加模块

生成符合架构约定的新模块骨架：

```bash
pnpm module:add <module-id>
```

该命令会在 `modules/<module-id>` 下生成包含 `module.json`、单元测试、双语资源字典（`en.json`、`zh_CN.json`）和默认图标的目录。

### 删除模块

```bash
pnpm module:remove <module-id>
```

该命令会校验模块位置和工作树状态，在更新注册文件的同时安全删除未提交的模块。

### 静态代码生成

```bash
pnpm generate
```

扫描 `modules/` 目录并生成 `generated/module-registry.ts` 和 `generated/module-manifest.ts`。

---

## 工程规范与命令

ConvTools 通过自动化门禁保证质量：

```bash
# 代码质量
pnpm lint               # 使用严格 React Hooks 与无障碍规则的 ESLint
pnpm typecheck          # TypeScript 严格模式检查

# 测试
pnpm test               # 运行所有单元、集成和构建门禁测试
pnpm test:unit          # 运行单元测试套件
pnpm test:e2e           # 在 headless Chromium 中运行 Playwright E2E

# 产物与审计
pnpm build:chrome       # 构建 Chrome MV3 生产产物
pnpm build:edge         # 构建 Microsoft Edge MV3 生产产物
pnpm manifest:audit     # 根据权限安全策略校验 MV3 Manifest
pnpm icons:check        # 确认 PNG 图标与源 SVG 资产一致

# 聚合门禁
pnpm check              # 运行所有检查的提交前硬门禁
```

### CI 与发布

- GitHub Actions 在收到 `main` 推送或目标为 `main` 的 Pull Request 时，执行冻结依赖安装、Chromium 准备和 `pnpm check`。
- `main` 通过验证后，流水线为当前提交分配版本、构建并审计 Chrome 和 Edge 扩展，将两个 ZIP 一同发布到 GitHub Releases。首版从 `package.json` 的版本开始，后续默认递增补丁号。重跑同一提交会复用已有的 tag。

---

## 技术栈

- **框架**：[WXT](https://wxt.dev/)（新一代 Web Extension 框架）+ [React 19](https://react.dev/)
- **语言**：[TypeScript](https://www.typescriptlang.org/)（严格模式）
- **样式**：CSS Modules + 零运行时设计变量
- **交互**：[@dnd-kit](https://dndkit.com/) 无障碍拖拽交互
- **测试**：[Vitest](https://vitest.dev/)（单元/集成）+ [Playwright](https://playwright.dev/)（MV3 扩展 E2E）
- **工具**：原生 `Temporal` API、`qrcode-generator`（纯离线算法）

---

## 许可证

本项目采用 [MIT License](LICENSE) 开源许可证。

ConvTools 源码与设计资产可用于商业和个人用途。所有图标矢量与字体栈只依赖免版税的系统资产。

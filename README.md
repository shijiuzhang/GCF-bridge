# GCF Bridge

> **Gemini Cloudflare Workers → Anthropic API Proxy**
> 将 Google Gemini 网页端转换为 Anthropic 兼容 API，部署在 Cloudflare Workers 上，专为 Claude Code 设计

## 特性

- **Cloudflare Workers 部署** — 全球边缘节点，无需本地服务器
- **Anthropic API 兼容** — 直接对接 Claude Code，暴露 `/v1/messages` 端点
- **OpenAI API 兼容** — 同时支持 `/v1/chat/completions`
- **Delta Slicing** — 智能裁剪 Claude Code 的巨大上下文，避免触发 Google 安全过滤
- **零认证** — 匿名模式使用 Gemini 3.5 Flash，无需 Google 账号
- **Tool Calling** — 支持 Anthropic 工具调用格式
- **SSE 流式输出** — 支持 streaming response

## v1.62 更新内容

### Bug 修复

- **修复 Worker 流式工具调用崩溃 (sseEvent 未导入)** — `worker.js` 中的 `handleStream` 在发送工具调用 SSE 事件时调用了 `sseEvent()` 函数，但该函数未被导入，导致所有包含 `<TOOL_CALL>` 的流式响应在 Cloudflare Workers 上以 `ReferenceError` 崩溃。已将 `sseEvent` 加入导入列表。
- **清理未使用的 `blocksToString` 死导入** — 移除了 `worker.js` 中从未使用的 `blocksToString` 导入。

## v1.61 更新内容

### Bug 修复

- **修复 Edit 工具参数解析损坏 (v1e 始终为 -1)** — 修复了 `repairToolJson` 中由于 `lastIndexOf` 误用导致 `old_string` 和 `new_string` 截断错误的严重 bug。
- **修复容错解析中字符串值尾部引号残留 (且保护截断文本)** — 引入基于正则表达式的 `stripTrailingJsonQuote` 统一剥离修复值尾部的双引号和花括号，解决了 `Bash` 执行尾部引号报错（如 `ls"`）和 `Write` 写入文件内容损坏的问题，并保证了截断文本不会被误删花括号。
- **修复流式响应中删除所有空格和换行** — 分离了流式清洗与最终整理逻辑，在流式传输时不再对 chunk 进行 `.trim()` 处理，完整保留了词间空格和换行符。
- **修复 Workers 模式下的多轮对话上下文丢失** — 将单条消息逻辑替换为完整的会话历史 prompt，并接入 `truncateToolResult` 智能裁剪工具输出以防触发 Google 安全过滤；同时基于客户端 API Key 隔离 session 会话。
- **实现标准的 SSE 流式工具调用输出** — 客户端流式调用时，自动缓冲 `<TOOL_CALL>` 段并按 Anthropic SSE 格式输出 `tool_use`、`input_json_delta` 和 `content_block_stop` 事件，使得 Claude Code 能完美唤起并执行本地工具。
- **修复 Node.js 本地服务 Unhandled Rejection 崩溃** — 增加了捕获 fallback 调用的异常捕获机制，提升了本地服务的稳定性。

## v1.5 更新内容

### Bug 修复

- **修复 async generator 不能直接作为 ReadableStream body** — `handleStream` 返回的 async generator 需要包装为 ReadableStream，否则 stream 端点无法工作
- **修复 stream fallback 条件永远为 false** — `!fullText.includes(fullText.slice(0,50))` 永远返回 false，导致 fallback 时从不发送数据
- **修复 TOOL_CALL 正则无法处理嵌套 JSON** — 非贪婪匹配 `\{.*?\}` 在遇到第一个 `}` 就停止，嵌套对象被截断。新增 `extractToolCallJson()` 用大括号计数正确匹配
- **修复流结束后 buffer 残余内容丢失** — 流解析器最后未处理的 buffer 内容被丢弃
- **修复 `content_block_delta` 包含非标准 `usage` 字段** — 真实 Anthropic API 不在 delta 事件中返回 usage
- **修复 `parseToolCalls` 双重反转义导致值损坏** — `repairToolJson` 已处理过转义，`parseToolCalls` 又做一遍导致内容损坏

### 新增

- **本地 Node.js 服务器** (`server.js`) — 无需 Cloudflare 即可本地测试 Anthropic 和 OpenAI 端点
- 添加 `nodejs_compat` compatibility flag

### 运行方式

```bash
npm install
node server.js                # 本地运行，端口 8787
```

## 与同类项目对比

| 特性 | GCF Bridge | Chimera | GeminiBridge |
|------|-----------|---------|--------------|
| 运行环境 | Cloudflare Workers | 本地 Python | 本地 Python |
| 认证 | 匿名/Guest | 需要 Cookie | 可选 |
| 浏览器依赖 | 无 (纯 HTTP) | Playwright | nodriver |
| Anthropic 端点 | ✅ | ✅ | ✅ |
| Delta Slicing | ✅ | ✅ | ❌ |

## 快速开始

```bash
npm install
wrangler kv:namespace create SESSION_KV   # 创建 KV，把返回的 ID 填入 wrangler.toml
npm run deploy
```

## Claude Code 使用

```bash
export ANTHROPIC_BASE_URL="https://your-worker.workers.dev/v1"
export ANTHROPIC_API_KEY="any"
claude
```

## 可用模型

| Model | 描述 | 输出 |
|-------|------|------|
| `gemini-3.5-flash` | 快速通用 | ~12k 字符 |
| `gemini-3.5-flash-thinking` | 深度思考 | ~20k 字符 |
| `gemini-3.1-pro` | Pro (匿名降级 Flash) | ~12k 字符 |
| `gemini-auto` | 自动选择 | 不定 |
| `gemini-3.5-flash-thinking-lite` | 自适应思考 | ~15k 字符 |
| `gemini-flash-lite` | 轻量快速 | ~10k 字符 |

模型名后加 `@think=N` 可调整思考深度（0=最深，4=最浅）。

## License

MIT

---

# English

> **Gemini Cloudflare Workers → Anthropic API Proxy**
> Converts Google Gemini's web interface into an Anthropic-compatible API, deployed on Cloudflare Workers, designed for Claude Code.

## Features

- **Cloudflare Workers deployment** — global edge network, no local server needed
- **Anthropic API compatible** — works directly with Claude Code via `/v1/messages`
- **OpenAI API compatible** — also supports `/v1/chat/completions`
- **Delta Slicing** — intelligently trims Claude Code's huge context to avoid Google's safety filters
- **Zero authentication** — anonymous mode uses Gemini 3.5 Flash, no Google account required
- **Tool Calling** — supports Anthropic tool calling format
- **SSE streaming** — streaming response support

## v1.62 Changelog

### Bug Fixes

- **Fix Worker streaming tool call crash (missing sseEvent import)** — `handleStream` in `worker.js` called `sseEvent()` to emit tool call SSE events, but the function was never imported, causing all streaming responses containing `<TOOL_CALL>` to crash with `ReferenceError` on Cloudflare Workers. Added `sseEvent` to the import list.
- **Remove unused `blocksToString` dead import** — Cleaned up the unused `blocksToString` import from `worker.js`.

## v1.61 Changelog

### Bug Fixes

- **Fix Edit tool parameter extraction (v1e evaluated to -1)** — Fixed a critical bug in `repairToolJson` where incorrect arguments to `lastIndexOf` truncated and corrupted the `old_string` and `new_string` parameters.
- **Fix trailing double-quotes in custom repaired string values (with truncation safety)** — Replaced the loop-based stripper with a robust regex-based `stripTrailingJsonQuote` to safely strip trailing quotes and braces, preventing trailing quote syntax errors in `Bash` (e.g. `ls"`) and text file writing while protecting truncated values.
- **Fix streaming response dropping spaces and newlines** — Decoupled chunk cleaning from final output trimming by removing `.trim()` on streamed chunks, fully preserving word spacing and newlines.
- **Fix context history loss and session collision in Cloudflare Workers** — Replaced single-message context with full conversation history prompting, integrated `truncateToolResult` to avoid Google safety filters, and isolated KV sessions per API Key.
- **Support structured SSE streaming tool calls** — Refactored `handleStream` to buffer `<TOOL_CALL>` chunks and emit standard Anthropic SSE `tool_use`, `input_json_delta`, and `content_block_stop` events, enabling Claude Code to invoke local tools during streaming.
- **Fix local Node.js server crashing on Unhandled Rejection** — Wrapped fallback async calls in try-catch blocks to ensure server stability.

## v1.5 Changelog

### Bug Fixes

- **Fix async generator not wrapped as ReadableStream** — `handleStream` returns an async generator that cannot be used as Response body directly. Added `createStream()` wrapper
- **Fix streaming fallback condition always false** — `!fullText.includes(fullText.slice(0,50))` is always false, fallback path never sends data
- **Fix TOOL_CALL regex failing on nested JSON** — non-greedy `\{.*?\}` stops at first `}`, truncating nested objects. Added `extractToolCallJson()` with brace counting
- **Fix stream buffer remainder content lost** — remaining bytes after stream end are now flushed
- **Fix non-standard `usage` field in `content_block_delta`** — real Anthropic API doesn't include usage in delta events
- **Fix double-unescape corruption in `parseToolCalls`** — `repairToolJson` already handles escaping, the extra unescape corrupted values

### New

- **Local Node.js server** (`server.js`) — test Anthropic and OpenAI endpoints locally without Cloudflare
- Add `nodejs_compat` compatibility flag

### Usage

```bash
npm install
node server.js                # Local server on port 8787
```

## Comparison

| Feature | GCF Bridge | Chimera | GeminiBridge |
|---------|-----------|---------|--------------|
| Runtime | Cloudflare Workers | Local Python | Local Python |
| Auth | Anonymous/Guest | Cookie required | Optional |
| Browser dep | None (pure HTTP) | Playwright | nodriver |
| Anthropic endpoint | ✅ | ✅ | ✅ |
| Delta Slicing | ✅ | ✅ | ❌ |

## Quick Start

```bash
npm install
wrangler kv:namespace create SESSION_KV   # Create KV and put the ID into wrangler.toml
npm run deploy
```

## Claude Code Usage

```bash
export ANTHROPIC_BASE_URL="https://your-worker.workers.dev/v1"
export ANTHROPIC_API_KEY="any"
claude
```

## Available Models

| Model | Description | Output |
|-------|-------------|--------|
| `gemini-3.5-flash` | Fast general-purpose | ~12k chars |
| `gemini-3.5-flash-thinking` | Deep thinking | ~20k chars |
| `gemini-3.1-pro` | Pro (downgraded to Flash in anonymous mode) | ~12k chars |
| `gemini-auto` | Auto model selection | varies |
| `gemini-3.5-flash-thinking-lite` | Adaptive thinking | ~15k chars |
| `gemini-flash-lite` | Lightweight fast | ~10k chars |

Append `@think=N` to any model name to adjust thinking depth (0=deepest, 4=shallowest).

## License

MIT

---

# Deutsch

> **Gemini Cloudflare Workers → Anthropic API Proxy**
> Wandelt die Google Gemini Web-Oberfläche in eine Anthropic-kompatible API um, bereitgestellt auf Cloudflare Workers, entwickelt für Claude Code.

## Funktionen

- **Cloudflare Workers Bereitstellung** — globales Edge-Netzwerk, kein lokaler Server nötig
- **Anthropic API kompatibel** — funktioniert direkt mit Claude Code über `/v1/messages`
- **OpenAI API kompatibel** — unterstützt auch `/v1/chat/completions`
- **Delta Slicing** — kürzt intelligent den großen Kontext von Claude Code, um Googles Sicherheitsfilter zu vermeiden
- **Keine Authentifizierung** — anonymer Modus nutzt Gemini 3.5 Flash, kein Google-Konto erforderlich
- **Tool Calling** — unterstützt das Anthropic-Tool-Calling-Format
- **SSE Streaming** — Streaming-Antworten werden unterstützt

## v1.62 Änderungen

### Fehlerbehebungen

- **Worker-Streaming-Tool-Aufruf-Absturz behoben (fehlender sseEvent-Import)** — `handleStream` in `worker.js` rief `sseEvent()` auf, um Tool-Aufruf-SSE-Events zu senden, aber die Funktion wurde nie importiert, wodurch alle Streaming-Antworten mit `<TOOL_CALL>` auf Cloudflare Workers mit `ReferenceError` abstürzten. `sseEvent` wurde zur Importliste hinzugefügt.
- **Ungenutzten `blocksToString`-Dead-Import entfernt** — Der ungenutzte `blocksToString`-Import wurde aus `worker.js` entfernt.

## v1.61 Änderungen

### Fehlerbehebungen

- **Fehler beim Parsen von Edit-Parametern behoben (v1e ergibt -1)** — Ein kritischer Fehler in `repairToolJson` wurde behoben, bei dem falsche Parameter für `lastIndexOf` die Parameter `old_string` und `new_string` beschädigten.
- **Verbleibende Anführungszeichen am Ende reparierter Werte entfernt (mit Absicherung)** — Helper `stripTrailingJsonQuote` nutzt nun Regex, um schließende Klammern und Anführungszeichen zu entfernen, wodurch Syntaxfehler bei `Bash` (z.B. `ls"`) und `Write` behoben wurden und unvollständige Werte unversehrt bleiben.
- **Fehlende Leerzeichen und Zeilenumbrüche beim Streaming behoben** — Chunk-Bereinigung von Trimming entkoppelt, `.trim()` bei Stream-Chunks entfernt, um Wortabstände und Zeilenumbrüche zu erhalten.
- **Kontexthistorienverlust und Sitzungskollisionen in Cloudflare Workers behoben** — Einzelnachrichten-Kontext durch vollständigen Gesprächsverlauf ersetzt, `truncateToolResult` integriert und KV-Sitzungen pro API-Key isoliert.
- **Standardisierte SSE-Streaming-Tool-Aufrufe implementiert** — Stream-Verarbeitung puffert `<TOOL_CALL>`-Blöcke und gibt Anthropic-kompatible SSE-Events (`tool_use`, `input_json_delta`, `content_block_stop`) aus, damit Claude Code lokale Tools aufrufen kann.
- **Unhandled Rejection Absturz des lokalen Node.js Servers behoben** — Try-Catch-Blöcke bei Fallback-Aufrufen hinzugefügt, um Serverstabilität zu gewährleisten.

## v1.5 Änderungen

### Fehlerbehebungen

- **Async Generator nicht als ReadableStream verpackt** — `handleStream` gibt einen async generator zurück, der nicht direkt als Response body verwendet werden kann. `createStream()` Wrapper hinzugefügt
- **Stream-Fallback-Bedingung immer false** — `!fullText.includes(fullText.slice(0,50))` ist immer false, der Fallback sendet nie Daten
- **TOOL_CALL Regex verarbeitet verschachteltes JSON nicht** — Non-Greedy `\{.*?\}` stoppt beim ersten `}`, verschachtelte Objekte werden abgeschnitten. `extractToolCallJson()` mit Klammer-Zählung hinzugefügt
- **Stream-Buffer Restinhalt verloren** — verbleibende Bytes nach Stream-ende werden jetzt verarbeitet
- **Nicht-standard `usage`-Feld in `content_block_delta`** — echte Anthropic API liefert kein usage in delta-Events
- **Doppelte Unescape-Verfälschung in `parseToolCalls`** — `repairToolJson` behandelt Escaping bereits, zusätzliche Verarbeitung verfälschte Werte

### Neu

- **Lokaler Node.js Server** (`server.js`) — Anthropic- und OpenAI-Endpunkte lokal ohne Cloudflare testen
- `nodejs_compat` Compatibility-Flag hinzugefügt

### Verwendung

```bash
npm install
node server.js                # lokaler Server auf Port 8787
```

## Vergleich

| Eigenschaft | GCF Bridge | Chimera | GeminiBridge |
|-------------|-----------|---------|--------------|
| Laufzeitumgebung | Cloudflare Workers | Lokales Python | Lokales Python |
| Authentifizierung | Anonym/Gast | Cookie erforderlich | Optional |
| Browser-Abhängigkeit | Keine (reines HTTP) | Playwright | nodriver |
| Anthropic-Endpunkt | ✅ | ✅ | ✅ |
| Delta Slicing | ✅ | ✅ | ❌ |

## Schnellstart

```bash
npm install
wrangler kv:namespace create SESSION_KV   # KV erstellen und die ID in wrangler.toml eintragen
npm run deploy
```

## Claude Code Verwendung

```bash
export ANTHROPIC_BASE_URL="https://your-worker.workers.dev/v1"
export ANTHROPIC_API_KEY="any"
claude
```

## Verfügbare Modelle

| Modell | Beschreibung | Ausgabe |
|--------|--------------|---------|
| `gemini-3.5-flash` | Schnelles Allzweckmodell | ~12k Zeichen |
| `gemini-3.5-flash-thinking` | Tiefes Nachdenken | ~20k Zeichen |
| `gemini-3.1-pro` | Pro (im anonymen Modus auf Flash reduziert) | ~12k Zeichen |
| `gemini-auto` | Automatische Modellauswahl | variiert |
| `gemini-3.5-flash-thinking-lite` | Adaptives Nachdenken | ~15k Zeichen |
| `gemini-flash-lite` | Leicht und schnell | ~10k Zeichen |

Hänge `@think=N` an einen beliebigen Modellnamen an, um die Nachdenktiefe anzupassen (0=tiefste, 4=flachste).

## Lizenz

MIT

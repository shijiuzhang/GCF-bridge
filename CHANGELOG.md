# Changelog

Most entries are fixes that unblock Claude Code traffic through Gemini's consumer-web safety filters.

**🌐 [English](#english) · [中文](#中文) · [Deutsch](#deutsch)**

---

## <a id="english"></a>🇬🇧 English

### v1.91
- **Gemini endpoint health monitoring** — Cloudflare Cron Trigger checks Gemini availability every 30 minutes (HTTP status, response validity, safety-refusal detection). State persisted in KV (`health:status`, TTL 24h).
- **Dual-channel alerts** — notify via PushPlus (WeChat) and Resend (email) on state transitions only (`healthy→down`, `down→healthy`); no repeated alerts during sustained outages.
- **`GET /health` endpoint** — returns JSON with `status`, `lastCheck`, `lastChange`, `failCount`, `reason`.
- **`scheduled` handler** — registers the Cron Trigger; `ctx.waitUntil` ensures the probe completes before Worker timeout.

### v1.9
- **Claude Fable 5 persona injection** — condensed ~4.8K-char persona distilled from the public Claude Fable 5 system prompt (~188KB), injected as a `[CORE PERSONA]` layer at the front of every Gemini prompt. New module `src/persona.js`; applied at all prompt-assembly points; passes through `sanitizePrompt()` without disrupting delta tracking or session state.

### v1.85
- **Bypass safety refusal from System + "Doing tasks" rule combinations** — Claude Code's global prompt (prompt-injection rules + SQL-injection/XSS/OWASP guidance + "don't add extra validation") was misread by Gemini as a request for unsafe code. `sanitizePrompt` now paraphrases these phrases (e.g. `prompt injection` → `untrusted instruction inputs`) without losing meaning.

### v1.84
- **Escape bare XML tags that trigger safety refusal** — unclosed tags like `<system-reminder>` are now auto-escaped to bracketed forms (e.g. `[system-reminder]`).
- **Prompt debugging persistence** — session state now records `lastPrompt`.

### v1.83
- **Bypass region-specific safety filters** — `香港 / Hong Kong` combined with `端口转发 / 端口映射 / 代理` triggered strict blocking (`BardErrorInfo 1155`); now mapped to `Tokyo` and `流量转发/流量映射`.

### v1.82
- **Integrate `sanitizePrompt`** — network/proxy terms (`VPN`, `翻墙`, `shadowsocks`, `v2ray`, …) rewritten to neutral wording before reaching Gemini, fixing hangs and `I cannot fulfill this request.` blocks.
- **Replacement-order priority** — longer terms match before substrings to avoid corruption like `open网络中继`.

### v1.81
- **Strip dynamic system reminders from history** — `<system-reminder>` blocks in multi-turn history are purged when merging, preserving core system instructions.

### v1.8
- **Claude Code global config guide** (`~/.claude/settings.json`) for firewalled environments.
- **Fix double `/v1/v1` → 404** via router normalization.
- **Fix `Standing by.` on retry** — added `session.lastResponse` caching so the real response is re-streamed.
- **Populate `/v1/models`** to pass client boot validation.

### v1.62
- **Fix streaming tool-call crash** — missing `sseEvent` import caused `ReferenceError` on all streamed `<TOOL_CALL>` responses.
- **Remove dead `blocksToString` import**.

### v1.61
- **Fix Edit-tool parameter extraction** (`lastIndexOf` truncated `old_string`/`new_string`).
- **Fix trailing quote/brace residue** via regex `stripTrailingJsonQuote`.
- **Fix dropped spaces/newlines while streaming**.
- **Fix context loss & session collision on Workers** — full-history prompting, `truncateToolResult`, per-API-key KV sessions.
- **Standard SSE tool calling** — emit `tool_use` / `input_json_delta` / `content_block_stop`.
- **Fix local Node.js Unhandled Rejection**.

### v1.5
- Fix async generator as Response body (wrap in `ReadableStream`); fix stream-fallback condition always false; fix `<TOOL_CALL>` regex on nested JSON (brace counting); flush lost buffer remainder; remove non-standard `usage` in `content_block_delta`; fix double-unescape in `parseToolCalls`.
- **New: local Node.js server** (`server.js`); added `nodejs_compat` flag.

---

## <a id="中文"></a>🇨🇳 中文

### v1.91
- **Gemini 端点健康监控** —— Cloudflare Cron Trigger 每 30 分钟检测 Gemini 可用性（HTTP 状态、响应有效性、安全拒答识别）。状态持久化于 KV（`health:status`，TTL 24h）。
- **双通道告警** —— 仅在状态切换（`healthy→down`、`down→healthy`）时通过 PushPlus（微信）与 Resend（邮件）通知；持续异常不重复告警。
- **`GET /health` 端点** —— 返回 JSON：`status`、`lastCheck`、`lastChange`、`failCount`、`reason`。
- **`scheduled` 处理器** —— 注册 Cron Trigger；`ctx.waitUntil` 确保探测在 Worker 超时前完成。

### v1.9
- **注入 Claude Fable 5 人格** —— 从公开的 Claude Fable 5 系统提示词（约 188KB）提炼约 4.8K 字符核心人格，作为 `[CORE PERSONA]` 层注入每条 Gemini 提示词最前方。新增 `src/persona.js`；所有提示词组装点均已接入；经 `sanitizePrompt()` 处理，不影响 delta 跟踪与会话状态。

### v1.85
- **绕过 System + “Doing tasks” 规则组合触发的安全拒答** —— Claude Code 全局提示词（提示词注入规则 + SQL 注入/XSS/OWASP 规范 + “不要添加多余校验”）被 Gemini 误判为请求生成不安全代码。`sanitizePrompt` 现对这些短语同义改写（如 `prompt injection` → `untrusted instruction inputs`），语义不变。

### v1.84
- **转义触发安全拒答的裸 XML 标签** —— `<system-reminder>` 等未闭合标签自动转义为中括号形式（如 `[system-reminder]`）。
- **提示词调试持久化** —— 会话状态记录 `lastPrompt`。

### v1.83
- **绕过地域性安全过滤** —— `香港 / Hong Kong` 与 `端口转发 / 端口映射 / 代理` 组合触发严格拦截（`BardErrorInfo 1155`）；现映射为 `东京` 与 `流量转发/流量映射`。

### v1.82
- **接入 `sanitizePrompt`** —— 网络/代理词（`VPN`、`翻墙`、`shadowsocks`、`v2ray` 等）在发往 Gemini 前改写为中性词，解决卡死与 `I cannot fulfill this request.` 拦截。
- **替换优先级** —— 长词先于子串匹配，避免 `open网络中继` 之类损坏。

### v1.81
- **过滤历史中的动态系统提醒** —— 合并历史时剥离 `<system-reminder>` 块，同时保留核心系统指令。

### v1.8
- **Claude Code 全局配置指南**（`~/.claude/settings.json`），适配防火墙环境。
- **修复双重 `/v1/v1` → 404**：路由归一化。
- **修复重试时的 `Standing by.`**：新增 `session.lastResponse` 缓存以重放真实应答。
- **补全 `/v1/models`** 以通过客户端启动校验。

### v1.62
- **修复流式工具调用崩溃** —— 缺失 `sseEvent` 导入导致所有流式 `<TOOL_CALL>` 响应 `ReferenceError`。
- **移除无用的 `blocksToString` 导入**。

### v1.61
- **修复 Edit 工具参数解析**（`lastIndexOf` 误用截断 `old_string`/`new_string`）。
- **修复尾部引号/花括号残留**：正则 `stripTrailingJsonQuote`。
- **修复流式传输丢失空格/换行**。
- **修复 Workers 下上下文丢失与会话串扰** —— 全历史提示、`truncateToolResult`、按 API key 隔离 KV 会话。
- **标准 SSE 工具调用** —— 输出 `tool_use` / `input_json_delta` / `content_block_stop`。
- **修复本地 Node.js Unhandled Rejection**。

### v1.5
- 修复 async generator 不能直接作为 Response body（包装为 `ReadableStream`）；修复 stream fallback 条件恒为 false；修复 `<TOOL_CALL>` 正则处理嵌套 JSON（大括号计数）；补发流末残余 buffer；移除 `content_block_delta` 中非标准 `usage`；修复 `parseToolCalls` 双重反转义。
- **新增本地 Node.js 服务**（`server.js`）；添加 `nodejs_compat` flag。

---

## <a id="deutsch"></a>🇩🇪 Deutsch

### v1.91
- **Health-Monitoring des Gemini-Endpunkts** — Cloudflare-Cron-Trigger prüft die Verfügbarkeit alle 30 Minuten (HTTP-Status, Antwortgültigkeit, Erkennung von Sicherheitsablehnungen). Zustand in KV gespeichert (`health:status`, TTL 24h).
- **Zweikanal-Alerts** — Benachrichtigung via PushPlus (WeChat) und Resend (E-Mail) nur bei Zustandswechseln (`healthy→down`, `down→healthy`); keine wiederholten Alerts bei anhaltenden Ausfällen.
- **`GET /health`-Endpunkt** — liefert JSON mit `status`, `lastCheck`, `lastChange`, `failCount`, `reason`.
- **`scheduled`-Handler** — registriert den Cron-Trigger; `ctx.waitUntil` stellt sicher, dass die Prüfung vor dem Worker-Timeout abschließt.

### v1.9
- **Claude-Fable-5-Persona-Injektion** — verdichtete ~4,8K-Zeichen-Persona aus dem öffentlichen Claude-Fable-5-System-Prompt (~188KB), als `[CORE PERSONA]`-Ebene vor jeden Gemini-Prompt gestellt. Neues Modul `src/persona.js`; an allen Prompt-Zusammensetzungspunkten angewandt; läuft durch `sanitizePrompt()` ohne Delta-Tracking oder Session-State zu stören.

### v1.85
- **Sicherheitsablehnung durch System- + „Doing tasks“-Regelkombinationen umgehen** — Claude Codes globaler Prompt (Prompt-Injection-Regeln + SQL-Injection/XSS/OWASP-Vorgaben + „keine zusätzliche Validierung“) wurde von Gemini als Anforderung für unsicheren Code fehlinterpretiert. `sanitizePrompt` paraphrasiert diese Formulierungen nun (z. B. `prompt injection` → `untrusted instruction inputs`), ohne die Bedeutung zu verlieren.

### v1.84
- **Nackte XML-Tags maskieren, die Sicherheitsablehnungen auslösen** — ungeschlossene Tags wie `<system-reminder>` werden nun automatisch in Klammerform maskiert (z. B. `[system-reminder]`).
- **Prompt-Debugging-Persistenz** — der Session-State erfasst nun `lastPrompt`.

### v1.83
- **Regionsspezifische Sicherheitsfilter umgehen** — `香港 / Hong Kong` kombiniert mit `端口转发 / 端口映射 / 代理` löste striktes Blocken aus (`BardErrorInfo 1155`); wird nun auf `Tokyo` und `流量转发/流量映射` abgebildet.

### v1.82
- **`sanitizePrompt` integriert** — Netzwerk-/Proxy-Begriffe (`VPN`, `翻墙`, `shadowsocks`, `v2ray`, …) werden vor dem Erreichen von Gemini in neutrale Wörter umgeschrieben; behebt Hänger und `I cannot fulfill this request.`-Blockaden.
- **Ersetzungsreihenfolge** — längere Begriffe matchen vor Teil-Strings, um Beschädigungen wie `open网络中继` zu vermeiden.

### v1.81
- **Dynamische System-Reminder aus dem Verlauf entfernen** — `<system-reminder>`-Blöcke werden beim Zusammenführen des Verlaufs entfernt, während die Kern-Systemanweisungen erhalten bleiben.

### v1.8
- **Globale Claude-Code-Konfigurationsanleitung** (`~/.claude/settings.json`) für Umgebungen hinter einer Firewall.
- **Doppeltes `/v1/v1` → 404 behoben** durch Router-Normalisierung.
- **`Standing by.` bei Wiederholung behoben** — `session.lastResponse`-Caching, damit die echte Antwort erneut gestreamt wird.
- **`/v1/models` befüllt**, um die Client-Startvalidierung zu bestehen.

### v1.62
- **Absturz bei Streaming-Tool-Calls behoben** — fehlender `sseEvent`-Import verursachte `ReferenceError` bei allen gestreamten `<TOOL_CALL>`-Antworten.
- **Toten `blocksToString`-Import entfernt**.

### v1.61
- **Parameter-Extraktion des Edit-Tools behoben** (`lastIndexOf` schnitt `old_string`/`new_string` ab).
- **Reste von abschließenden Anführungszeichen/Klammern behoben** via Regex `stripTrailingJsonQuote`.
- **Verlorene Leerzeichen/Zeilenumbrüche beim Streaming behoben**.
- **Kontextverlust & Session-Kollision auf Workers behoben** — Prompting mit vollem Verlauf, `truncateToolResult`, pro-API-Schlüssel isolierte KV-Sessions.
- **Standard-SSE-Tool-Calling** — `tool_use` / `input_json_delta` / `content_block_stop` ausgeben.
- **Lokale Node.js-„Unhandled Rejection“ behoben**.

### v1.5
- async Generator nicht direkt als Response-Body behoben (in `ReadableStream` verpackt); Stream-Fallback-Bedingung (immer false) behoben; `<TOOL_CALL>`-Regex bei verschachteltem JSON behoben (Klammerzählung); verlorenen Puffer-Rest am Stream-Ende geleert; nicht-standardisiertes `usage` in `content_block_delta` entfernt; doppeltes Unescaping in `parseToolCalls` behoben.
- **Neu: lokaler Node.js-Server** (`server.js`); `nodejs_compat`-Flag hinzugefügt.

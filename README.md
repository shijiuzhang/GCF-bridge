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

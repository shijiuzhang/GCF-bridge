# Claude Code setup · Claude Code 配置 · Claude-Code-Einrichtung

**🌐 [English](#english) · [中文](#中文) · [Deutsch](#deutsch)**

A persistent configuration for using Claude Code with GCF Bridge, including running behind a local proxy/firewall.

On macOS, edit `~/.claude/settings.json`:

```json
{
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:7897",
    "HTTPS_PROXY": "http://127.0.0.1:7897",
    "ANTHROPIC_AUTH_TOKEN": "any",
    "ANTHROPIC_BASE_URL": "https://your-worker.workers.dev/v1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "API_TIMEOUT_MS": 600000,
    "ANTHROPIC_MODEL": "claude-3-5-sonnet-20241022",
    "ANTHROPIC_SMALL_FAST_MODEL": "claude-3-5-sonnet-20241022",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-3-5-sonnet-20241022",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-3-5-sonnet-20241022",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-3-5-sonnet-20241022"
  },
  "permissions": { "allow": [], "deny": [] }
}
```

---

## <a id="english"></a>🇬🇧 English

### Why each key matters

- **`HTTP_PROXY` / `HTTPS_PROXY`** — Node.js does **not** inherit macOS system-wide proxy settings, so without this Claude Code times out behind a firewall. Point it at your local proxy (e.g. Clash's mixed port `7897`).
- **`ANTHROPIC_BASE_URL`** — your deployed Worker gateway, ending in `/v1`. (The Worker auto-normalizes an accidental `/v1/v1`.)
- **`ANTHROPIC_*_MODEL`** — Claude Code validates model names against Anthropic's official list at startup. Setting them all to `claude-3-5-sonnet-20241022` passes validation; the Worker backend remaps the request to your chosen Gemini model.
- **`ANTHROPIC_AUTH_TOKEN`** — any non-empty value works; GCF Bridge does not check it.
- **`API_TIMEOUT_MS`** — raised so long Gemini "thinking" responses don't time out.

To select a specific Gemini model or thinking depth, see the model table in the [README](../README.md#models) (e.g. `gemini-3.5-flash-thinking@think=1`).

---

## <a id="中文"></a>🇨🇳 中文

### 各配置项说明

- **`HTTP_PROXY` / `HTTPS_PROXY`** —— Node.js **不会**读取 macOS 的系统全局代理，因此在防火墙环境下若不设置，Claude Code 会超时。请指向你的本地代理（如 Clash 默认混合端口 `7897`）。
- **`ANTHROPIC_BASE_URL`** —— 你部署的 Worker 网关地址，以 `/v1` 结尾。（即使误写成 `/v1/v1`，Worker 也会自动归一化。）
- **`ANTHROPIC_*_MODEL`** —— Claude Code 启动时会用 Anthropic 官方列表校验模型名。全部设为 `claude-3-5-sonnet-20241022` 即可通过校验；Worker 后端会把请求重新映射到你选择的 Gemini 模型。
- **`ANTHROPIC_AUTH_TOKEN`** —— 任意非空值均可；GCF Bridge 不会校验它。
- **`API_TIMEOUT_MS`** —— 调高超时，避免 Gemini 长时间“思考”的响应被中断。

如需选择特定 Gemini 模型或思考深度，请参见 [README](../README.md#models) 中的模型表（例如 `gemini-3.5-flash-thinking@think=1`）。

---

## <a id="deutsch"></a>🇩🇪 Deutsch

### Wozu jeder Schlüssel dient

- **`HTTP_PROXY` / `HTTPS_PROXY`** — Node.js übernimmt die systemweiten Proxy-Einstellungen von macOS **nicht**, daher läuft Claude Code hinter einer Firewall ohne diese Angabe in einen Timeout. Richte sie auf deinen lokalen Proxy (z. B. Clashs Mixed-Port `7897`).
- **`ANTHROPIC_BASE_URL`** — die Adresse deines deployten Worker-Gateways, endend auf `/v1`. (Der Worker normalisiert ein versehentliches `/v1/v1` automatisch.)
- **`ANTHROPIC_*_MODEL`** — Claude Code validiert die Modellnamen beim Start gegen Anthropics offizielle Liste. Setzt man alle auf `claude-3-5-sonnet-20241022`, besteht die Validierung; das Worker-Backend remappt die Anfrage auf dein gewähltes Gemini-Modell.
- **`ANTHROPIC_AUTH_TOKEN`** — jeder nicht-leere Wert funktioniert; GCF Bridge prüft ihn nicht.
- **`API_TIMEOUT_MS`** — erhöht, damit lange „Thinking“-Antworten von Gemini nicht in einen Timeout laufen.

Um ein bestimmtes Gemini-Modell oder eine Denktiefe zu wählen, siehe die Modelltabelle in der [README](../README.md#models) (z. B. `gemini-3.5-flash-thinking@think=1`).

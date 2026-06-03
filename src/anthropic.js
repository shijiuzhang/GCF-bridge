import { generateId, generateToolId, truncateToolResult } from "./config.js";

function stripSystemReminders(text) {
  return (text || "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

function buildToolsPrompt(tools) {
  if (!tools || !tools.length) return "";
  let prompt = "AVAILABLE TOOLS:\n";
  for (const t of tools) {
    const props = Object.keys(t.input_schema?.properties || {});
    prompt += `- ${t.name}(${props.join(", ")})\n`;
  }
  prompt +=
    '\nCRITICAL: To execute a tool, reply ONLY with this exact format:\n' +
    '<TOOL_CALL>{"name": "ToolName", "input": {"param": "value"}}</TOOL_CALL>\n\n' +
    "IMPORTANT RULES FOR TOOL CALLS:\n" +
    "- The entire tool call including all content MUST fit inside ONE <TOOL_CALL> block.\n" +
    "- When writing code, NEVER leave expression incomplete.\n";
  return prompt;
}

function extractSystemPrompt(system) {
  if (!system) return "";
  if (typeof system === "string") return stripSystemReminders(system);
  if (Array.isArray(system)) {
    return system
      .filter(b => typeof b === "object" && b.type === "text")
      .map(b => stripSystemReminders(b.text))
      .join("\n");
  }
  return "";
}

function stripTrailingJsonQuote(val) {
  val = (val || "").trim();
  return val.replace(/"\s*}*\s*(?:<\/TOOL_CALL>)?\s*$/, "");
}

function repairToolJson(raw) {
  raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(raw); } catch {}

  const nameM = raw.match(/"name"\s*:\s*"([^"]+)"/);
  const toolName = nameM ? nameM[1] : null;
  const input = {};

  if (["Write", "Bash"].includes(toolName)) {
    const key = toolName === "Write" ? "content" : "command";
    if (toolName === "Write") {
      const pm = raw.match(/"file_path"\s*:\s*"([^"]+)"/);
      if (pm) input.file_path = pm[1];
    }
    const ci = raw.indexOf(`"${key}"`);
    if (ci !== -1) {
      let val = raw.slice(raw.indexOf('"', ci + key.length + 2) + 1);
      if (toolName === "Write") {
        const fpi = val.lastIndexOf('", "file_path"');
        if (fpi !== -1) val = val.slice(0, fpi);
      }
      val = stripTrailingJsonQuote(val);
      val = val.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
      input[key] = val;
    }
    return { name: toolName, input };
  }

  if (toolName === "Edit") {
    const pm = raw.match(/"file_path"\s*:\s*"([^"]+)"/);
    if (pm) input.file_path = pm[1];
    const oi = raw.indexOf('"old_string"');
    const ni = raw.indexOf('"new_string"');
    if (oi !== -1 && ni !== -1) {
      const [fk, fi, sk, si] = oi < ni ? ["old_string", oi, "new_string", ni] : ["new_string", ni, "old_string", oi];
      const v1s = raw.indexOf('"', raw.indexOf(":", fi)) + 1;
      const commaIdx = raw.lastIndexOf(",", si);
      const v1e = raw.lastIndexOf('"', commaIdx);
      const v1 = raw.slice(v1s, v1e);
      let v2 = raw.slice(raw.indexOf('"', raw.indexOf(":", si)) + 1);
      v2 = stripTrailingJsonQuote(v2);
      input[fk] = v1.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
      input[sk] = v2.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    }
    return { name: toolName, input };
  }

  const kvs = [...raw.matchAll(/"([^"]+)"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
  for (const [, k, v] of kvs) {
    if (k === "name") continue;
    input[k] = v.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  if (toolName && Object.keys(input).length) return { name: toolName, input };
  throw new Error("Could not parse tool JSON");
}

function extractToolCallJson(text) {
  const startIdx = text.indexOf("{");
  if (startIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

function parseToolCalls(text) {
  const blocks = [];
  const tagPattern = /<TOOL_CALL>([\s\S]*?)<\/TOOL_CALL>/gi;
  const clean = text.replace(tagPattern, (match, inner) => {
    try {
      let jsonStr = inner.trim();
      if (!jsonStr.startsWith("{")) {
        const braceIdx = jsonStr.indexOf("{");
        if (braceIdx !== -1) jsonStr = jsonStr.slice(braceIdx);
      }
      let jsonPart = extractToolCallJson(jsonStr);
      if (!jsonPart) jsonPart = jsonStr;
      const tool = repairToolJson(jsonPart);
      blocks.push({ type: "tool_use", id: generateToolId(), name: tool.name, input: tool.input || {} });
    } catch {}
    return "";
  });
  return { text: clean.trim(), toolBlocks: blocks };
}

function buildAnthropicResponse(responseText, modelName, messageId) {
  const { text, toolBlocks } = parseToolCalls(responseText);
  const content = [];
  if (text && !toolBlocks.length) content.push({ type: "text", text });
  else {
    if (text) content.push({ type: "text", text });
    content.push(...toolBlocks);
  }
  return {
    id: messageId || `msg_${generateId("")}`,
    type: "message",
    role: "assistant",
    content: content.length ? content : [{ type: "text", text: "Standing by." }],
    model: modelName,
    stop_reason: toolBlocks.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  };
}

function sseEvent(type, data) {
  return `data: ${JSON.stringify({ type, ...data })}\n\n`;
}

function openSseEvents(msgId, model) {
  return sseEvent("message_start", {
    message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } },
  });
}

function contentBlockStart(index) {
  return sseEvent("content_block_start", { index, content_block: { type: "text", text: "" } });
}

function contentBlockDelta(index, text) {
  return sseEvent("content_block_delta", { index, delta: { type: "text_delta", text } });
}

function contentBlockStop(index) {
  return sseEvent("content_block_stop", { index });
}

function messageDelta(stopReason) {
  return sseEvent("message_delta", { delta: { stop_reason: stopReason }, usage: { output_tokens: 0 } });
}

function messageStop() {
  return sseEvent("message_stop", {});
}

function sanitizePrompt(text) {
  if (!text) return "";
  return text
    .replace(/shadowsocks/gi, "加密隧道")
    .replace(/socks5/gi, "安全套接")
    .replace(/proxy server/gi, "transit server")
    .replace(/openvpn/gi, "transit tunnel")
    .replace(/v2ray/gi, "transit")
    .replace(/trojan/gi, "transit")
    .replace(/vpn/gi, "网络中继")
    .replace(/v-p-n/gi, "网络中继")
    .replace(/代理/g, "中转")
    .replace(/翻墙/g, "网络优化")
    .replace(/科学上网/g, "网络优化");
}

export {
  stripSystemReminders,
  buildToolsPrompt,
  extractSystemPrompt,
  repairToolJson,
  parseToolCalls,
  buildAnthropicResponse,
  sseEvent,
  openSseEvents,
  contentBlockStart,
  contentBlockDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
  sanitizePrompt,
};

const MODELS = {
  "gemini-3.5-flash": { mode: 1, think: 4, desc: "Fast general-purpose" },
  "gemini-3.5-flash-thinking": { mode: 2, think: 0, desc: "Deep thinking (~20k chars)" },
  "gemini-3.1-pro": { mode: 3, think: 4, desc: "Pro model" },
  "gemini-auto": { mode: 4, think: 4, desc: "Auto model selection" },
  "gemini-3.5-flash-thinking-lite": { mode: 5, think: 0, desc: "Dynamic thinking" },
  "gemini-flash-lite": { mode: 6, think: 4, desc: "Lightweight fast" },
};

const DEFAULT_MODEL = "gemini-3.5-flash";
const GEMINI_BL = "boq_assistant-bard-web-server_20260525.09_p0";
const SESSION_TTL = 3600;
const TOOL_RESULT_LIMIT = 12000;
const MAX_TOOL_REDELIVERY = 3;

function resolveModel(name) {
  let thinkOverride = null;
  if (name && name.includes("@think=")) {
    const parts = name.split("@think=");
    name = parts[0];
    thinkOverride = parseInt(parts[1]);
  }
  const cfg = MODELS[name] || MODELS[DEFAULT_MODEL];
  return {
    name: name || DEFAULT_MODEL,
    mode: cfg.mode,
    think: thinkOverride !== null ? thinkOverride : cfg.think,
  };
}

function generateId(prefix = "msg_") {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  for (const b of arr) id += chars[b % chars.length];
  return prefix + id;
}

function generateToolId() {
  return "toolu_01" + generateId("").slice(0, 15);
}

function truncateToolResult(content) {
  if (!content || content.length <= TOOL_RESULT_LIMIT) return content;
  return content.slice(0, TOOL_RESULT_LIMIT) + `\n[...truncated at ${TOOL_RESULT_LIMIT} chars...]`;
}

export { MODELS, DEFAULT_MODEL, GEMINI_BL, SESSION_TTL, TOOL_RESULT_LIMIT, MAX_TOOL_REDELIVERY };
export { resolveModel, generateId, generateToolId, truncateToolResult };

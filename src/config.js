const MODELS = {
  "gemini-3.8-flash": { mode: 1, think: 4, desc: "Latest all-around model (Gemini 3.8 Flash)" },
  "gemini-3.8-flash-thinking": { mode: 2, think: 0, desc: "Deep thinking mode (~20k chars)" },
  "gemini-3.7-flash": { mode: 1, think: 4, desc: "Gemini 3.7 Flash" },
  "gemini-3.6-flash": { mode: 1, think: 4, desc: "Gemini 3.6 Flash" },
  "gemini-3.5-flash": { mode: 1, think: 4, desc: "Gemini 3.5 Flash" },
  "gemini-3.5-flash-thinking": { mode: 2, think: 0, desc: "Deep thinking mode (~20k chars)" },
  "gemini-3.5-flash-thinking-lite": { mode: 5, think: 0, desc: "Dynamic thinking with adaptive depth" },
  "gemini-3.1-pro": { mode: 3, think: 4, desc: "Pro model" },
  "gemini-auto": { mode: 4, think: 4, desc: "Auto model selection" },
  "gemini-flash-lite": { mode: 6, think: 4, desc: "Lightweight fast model" },
};

const DEFAULT_MODEL = "gemini-3.8-flash";
const GEMINI_BL = "boq_assistant-bard-web-server_20260831.15_p2";
const SESSION_TTL = 3600;
const TOOL_RESULT_LIMIT = 12000;
const MAX_TOOL_REDELIVERY = 3;

function resolveModel(name) {
  let thinkOverride = null;
  if (name && name.includes("@think=")) {
    const parts = name.split("@think=");
    name = parts[0];
    thinkOverride = parseInt(parts[1], 10);
  }

  let cfg = MODELS[name];
  if (!cfg && name) {
    const lower = name.toLowerCase();
    if (lower.includes("thinking-lite") || lower.includes("dynamic")) {
      cfg = MODELS["gemini-3.5-flash-thinking-lite"];
    } else if (lower.includes("thinking")) {
      cfg = MODELS["gemini-3.5-flash-thinking"];
    } else if (lower.includes("pro")) {
      cfg = MODELS["gemini-3.1-pro"];
    } else if (lower.includes("lite")) {
      cfg = MODELS["gemini-flash-lite"];
    } else if (lower.includes("auto")) {
      cfg = MODELS["gemini-auto"];
    } else if (lower.includes("flash") || lower.includes("claude") || lower.includes("gemini")) {
      cfg = MODELS[DEFAULT_MODEL];
    }
  }

  if (!cfg) {
    cfg = MODELS[DEFAULT_MODEL];
  }

  return {
    name: name || DEFAULT_MODEL,
    mode: cfg.mode,
    think: Number.isInteger(thinkOverride) ? thinkOverride : cfg.think,
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

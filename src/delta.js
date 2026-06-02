import { SESSION_TTL } from "./config.js";

async function getSession(env, sessionId) {
  const raw = await env.SESSION_KV.get(`session:${sessionId}`);
  if (raw) return JSON.parse(raw);
  return { lastBlocks: [], pendingToolIds: [], toolRedeliveryCount: 0, messageCount: 0 };
}

async function saveSession(env, sessionId, session) {
  await env.SESSION_KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
}

function contentToBlocks(content) {
  if (!content) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.map(b => (b && typeof b === "object") ? b : {});
  return [];
}

function blockSignatures(blocks) {
  return blocks.map(b => typeof b === "string" ? b : JSON.stringify(b));
}

function computeDelta(lastBlocks, currentBlocks) {
  let matchIdx = 0;
  const maxLen = Math.min(lastBlocks.length, currentBlocks.length);
  for (let i = 0; i < maxLen; i++) {
    if (lastBlocks[i] === currentBlocks[i]) matchIdx++;
    else break;
  }
  return currentBlocks.slice(matchIdx);
}

function blocksToString(blocks) {
  let text = "";
  let hasUserText = false;
  let hasToolResult = false;
  for (const b of blocks) {
    if (b.type === "text") {
      const t = b.text || "";
      if (t.trim()) hasUserText = true;
      text += t + "\n";
    } else if (b.type === "tool_use") {
      text += `\n[You requested Tool: ${b.name}]\n`;
    } else if (b.type === "tool_result") {
      hasToolResult = true;
      const raw = typeof b.content === "string" ? b.content : (Array.isArray(b.content) ? b.content.map(c => typeof c === "object" && c.text ? c.text : "").join("\n") : String(b.content || ""));
      text += `\n[Tool Output Result]:\n${raw}\n`;
    }
  }
  return { text: text.trim(), hasUserText, hasToolResult };
}

export { getSession, saveSession, contentToBlocks, blockSignatures, computeDelta, blocksToString };

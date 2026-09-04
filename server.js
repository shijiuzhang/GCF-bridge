import { MODELS, DEFAULT_MODEL, resolveModel, generateId, MAX_TOOL_REDELIVERY, truncateToolResult } from "./src/config.js";
import { sendToGemini, extractResponseText, streamGeminiResponse } from "./src/gemini.js";
import { contentToBlocks } from "./src/delta.js";
import { flattenContent, flattenPart } from "./src/content.js";
import { extractSystemPrompt, buildToolsPrompt, parseToolCalls, stripSystemReminders, sanitizePrompt } from "./src/anthropic.js";
import { buildPersona } from "./src/persona.js";
import http from "node:http";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function jsonResp(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendMessagesHandler(res, body) {
  const reqData = JSON.parse(body);
  const modelInfo = resolveModel(reqData.model);
  const messages = reqData.messages || [];

  if (reqData.stream) {
    handleStreamHTTP(res, modelInfo, messages, reqData);
    return;
  }

  const parts = [];
  for (const msg of messages) {
    const role = msg.role || "user";
    const content = stripSystemReminders(flattenContent(msg.content));
    if (role === "system") parts.push(`[System instruction]: ${content}`);
    else if (role === "assistant") parts.push(`[Assistant]: ${content}`);
    else parts.push(content);
  }
  const persona = buildPersona();
  const personaHeader = persona ? `[CORE PERSONA]\n${persona}\n\n` : "";
  const prompt = sanitizePrompt(`${personaHeader}${parts.join("\n\n")}`);

  sendToGemini(prompt, modelInfo.mode, modelInfo.think)
    .then(raw => {
      const text = extractResponseText(raw);
      const msgId = `msg_${generateId("")}`;
      jsonResp(res, {
        id: msgId, type: "message", role: "assistant",
        content: [{ type: "text", text: text || "Standing by." }],
        model: modelInfo.name, stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 100 },
      });
    })
    .catch(e => jsonResp(res, { error: { message: String(e) } }, 502));
}

async function handleStreamHTTP(res, modelInfo, messages, reqData) {
  const sysPrompt = extractSystemPrompt(reqData.system);
  const toolsPrompt = buildToolsPrompt(reqData.tools);

  const parts = [];
  for (const msg of messages) {
    const role = msg.role || "user";
    const blocks = contentToBlocks(msg.content);
    let text = "";
    for (const b of blocks) {
      if (b.type === "text") {
        text += stripSystemReminders(b.text || "") + "\n";
      } else if (b.type === "tool_use") {
        text += `\n[You requested Tool: ${b.name}]\n`;
      } else if (b.type === "tool_result") {
        let raw = typeof b.content === "string" ? b.content : (Array.isArray(b.content) ? b.content.map(c => typeof c === "object" && c.text ? c.text : "").join("\n") : String(b.content || ""));
        raw = truncateToolResult(raw);
        text += `\n[Tool Output Result]:\n${raw}\n`;
      } else if (b.type === "image" || b.type === "input_image" || b.type === "image_url" || b.type === "document" || b.type === "file" || b.type === "input_file") {
        const { text: ftext, note } = flattenPart(b);
        if (ftext) text += stripSystemReminders(ftext) + "\n";
        if (note) text += note + "\n";
      }
    }
    text = text.trim();
    if (role === "system") parts.push(`[System instruction]: ${text}`);
    else if (role === "assistant") parts.push(`[Assistant]: ${text}`);
    else parts.push(text);
  }
  const historyText = parts.join("\n\n");
  const persona = buildPersona();
  const personaHeader = persona ? `[CORE PERSONA]\n${persona}\n\n` : "";
  const prompt = sanitizePrompt(`${personaHeader}[SYSTEM INSTRUCTIONS]\n${sysPrompt}\n\n${toolsPrompt}\n[CONVERSATION HISTORY]\n${historyText}`.replace(/\n{3,}/g, "\n\n").trim());

  const msgId = `msg_${generateId("")}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...corsHeaders(),
  });

  const sse = (type, data) => `data: ${JSON.stringify({ type, ...data })}\n\n`;
  res.write(sse("message_start", {
    message: { id: msgId, type: "message", role: "assistant", content: [], model: modelInfo.name, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } },
  }));
  res.write(sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));

  let fullText = "";
  let isStreamingToClient = true;

  try {
    for await (const chunk of streamGeminiResponse(prompt, modelInfo.mode, modelInfo.think)) {
      fullText += chunk;
      if (isStreamingToClient) {
        const toolCallIdx = fullText.indexOf("<TOOL_CALL>");
        if (toolCallIdx !== -1) {
          const sentLength = fullText.length - chunk.length;
          if (toolCallIdx > sentLength) {
            const extra = fullText.slice(sentLength, toolCallIdx);
            if (extra) res.write(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: extra } }));
          }
          isStreamingToClient = false;
        } else {
          res.write(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: chunk } }));
        }
      }
    }
  } catch {
    try {
      const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
      fullText = extractResponseText(raw);
      if (isStreamingToClient && fullText) {
        const { text: clean } = parseToolCalls(fullText);
        res.write(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: clean } }));
      }
    } catch {}
  }

  res.write(sse("content_block_stop", { index: 0 }));

  const { toolBlocks } = parseToolCalls(fullText);

  // Send tool blocks
  let blockIdx = 1;
  for (const tb of toolBlocks) {
    res.write(sse("content_block_start", {
      index: blockIdx,
      content_block: { type: "tool_use", id: tb.id, name: tb.name, input: {} }
    }));
    res.write(sse("content_block_delta", {
      index: blockIdx,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(tb.input) }
    }));
    res.write(sse("content_block_stop", { index: blockIdx }));
    blockIdx++;
  }

  const stopReason = toolBlocks.length ? "tool_use" : "end_turn";
  res.write(sse("message_delta", { delta: { stop_reason: stopReason }, usage: { output_tokens: 0 } }));
  res.write(sse("message_stop", {}));
  res.write("data: [DONE]\n\n");
  res.end();
}

function handleChatCompletions(res, body) {
  const reqData = JSON.parse(body);
  const modelInfo = resolveModel(reqData.model);
  const messages = reqData.messages || [];
  const cid = `chatcmpl-${generateId("")}`;

  const parts = [];
  for (const msg of messages) {
    const role = msg.role || "user";
    const content = flattenContent(msg.content);
    if (role === "system") parts.push(`[System instruction]: ${content}`);
    else if (role === "assistant") parts.push(`[Assistant]: ${content}`);
    else parts.push(content);
  }
  const persona = buildPersona();
  const personaHeader = persona ? `[CORE PERSONA]\n${persona}\n\n` : "";
  const prompt = sanitizePrompt(`${personaHeader}${parts.join("\n\n")}`);

  if (reqData.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...corsHeaders(),
    });
    (async () => {
      const encoder = new TextEncoder();
      try {
        for await (const chunk of streamGeminiResponse(prompt, modelInfo.mode, modelInfo.think)) {
          const data = {
            id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
            model: modelInfo.name, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch {
        try {
          const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
          const text = extractResponseText(raw);
          if (text) {
            const data = {
              id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
              model: modelInfo.name, choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        } catch {}
      }
      res.write(`data: ${JSON.stringify({ id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelInfo.name, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    })();
    return;
  }

  sendToGemini(prompt, modelInfo.mode, modelInfo.think)
    .then(raw => {
      const text = extractResponseText(raw);
      jsonResp(res, {
        id: cid, object: "chat.completion", created: Math.floor(Date.now() / 1000),
        model: modelInfo.name,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.floor(prompt.length / 4), completion_tokens: Math.floor((text || "").length / 4), total_tokens: Math.floor((prompt.length + (text || "").length) / 4) },
      });
    })
    .catch(e => jsonResp(res, { error: { message: String(e) } }, 502));
}

const PORT = parseInt(process.env.PORT || "8787");
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  let path = req.url.split("?")[0];
  if (path.startsWith("/v1/v1/")) {
    path = path.slice(3);
  }

  if (req.method === "GET" && path === "/") {
    return jsonResp(res, { status: "ok", version: "1.94.0", models: Object.keys(MODELS) });
  }
  if (req.method === "GET" && (path === "/v1/models" || path === "/v1beta/models")) {
    const anthropicModels = [
      { id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet", desc: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-sonnet-latest", display_name: "Claude 3.5 Sonnet (Latest)", desc: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku", desc: "Claude 3.5 Haiku" },
      { id: "claude-3-5-haiku-latest", display_name: "Claude 3.5 Haiku (Latest)", desc: "Claude 3.5 Haiku" },
      { id: "claude-3-opus-20240229", display_name: "Claude 3 Opus", desc: "Claude 3 Opus" },
    ];
    const list = [];
    for (const [name, cfg] of Object.entries(MODELS)) {
      list.push({
        id: name,
        object: "model",
        type: "model",
        display_name: name,
        created: 1700000000,
        created_at: "2024-01-01T00:00:00Z",
        owned_by: "google",
        description: cfg.desc,
      });
    }
    for (const m of anthropicModels) {
      list.push({
        id: m.id,
        object: "model",
        type: "model",
        display_name: m.display_name,
        created: 1700000000,
        created_at: "2024-01-01T00:00:00Z",
        owned_by: "anthropic",
        description: m.desc,
      });
    }
    return jsonResp(res, {
      object: "list",
      data: list,
      has_more: false,
      first_id: list[0]?.id,
      last_id: list[list.length - 1]?.id
    });
  }
  if (req.method === "POST" && path === "/v1/messages/count_tokens") {
    return jsonResp(res, { input_tokens: 100 });
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (path === "/v1/messages") return sendMessagesHandler(res, body);
    if (path === "/v1/chat/completions") return handleChatCompletions(res, body);
  }
  jsonResp(res, { error: "not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`GCF Bridge running on http://localhost:${PORT}`);
  console.log(`  Anthropic: http://localhost:${PORT}/v1/messages`);
  console.log(`  OpenAI:    http://localhost:${PORT}/v1/chat/completions`);
});

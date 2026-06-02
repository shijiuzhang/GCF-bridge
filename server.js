import { MODELS, DEFAULT_MODEL, resolveModel, generateId, MAX_TOOL_REDELIVERY } from "./src/config.js";
import { sendToGemini, extractResponseText, streamGeminiResponse } from "./src/gemini.js";
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
    const content = typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.filter(c => c.type === "text").map(c => c.text).join(" ") : "");
    if (role === "system") parts.push(`[System instruction]: ${content}`);
    else if (role === "assistant") parts.push(`[Assistant]: ${content}`);
    else parts.push(content);
  }
  const prompt = parts.join("\n\n");

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
  const parts = [];
  for (const msg of messages) {
    const role = msg.role || "user";
    const content = typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.filter(c => c.type === "text").map(c => c.text).join(" ") : "");
    if (role === "system") parts.push(`[System instruction]: ${content}`);
    else if (role === "assistant") parts.push(`[Assistant]: ${content}`);
    else parts.push(content);
  }
  const prompt = parts.join("\n\n");
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
  try {
    for await (const chunk of streamGeminiResponse(prompt, modelInfo.mode, modelInfo.think)) {
      fullText += chunk;
      res.write(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: chunk } }));
    }
  } catch {
    try {
      const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
      fullText = extractResponseText(raw);
      if (fullText) res.write(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: fullText } }));
    } catch {}
  }

  res.write(sse("content_block_stop", { index: 0 }));
  res.write(sse("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }));
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
    const content = typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.filter(c => c.type === "text").map(c => c.text).join(" ") : "");
    if (role === "system") parts.push(`[System instruction]: ${content}`);
    else if (role === "assistant") parts.push(`[Assistant]: ${content}`);
    else parts.push(content);
  }
  const prompt = parts.join("\n\n");

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
        const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
        const text = extractResponseText(raw);
        if (text) {
          const data = {
            id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
            model: modelInfo.name, choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
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
  if (req.method === "GET" && req.url === "/") {
    return jsonResp(res, { status: "ok", version: "1.0.0", models: Object.keys(MODELS) });
  }
  if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/v1beta/models")) {
    return jsonResp(res, {
      object: "list",
      data: Object.entries(MODELS).map(([name, cfg]) => ({
        id: name, object: "model", created: 1700000000, owned_by: "google", description: cfg.desc,
      })),
    });
  }
  if (req.method === "POST" && req.url === "/v1/messages/count_tokens") {
    return jsonResp(res, { input_tokens: 100 });
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (req.url === "/v1/messages") return sendMessagesHandler(res, body);
    if (req.url === "/v1/chat/completions") return handleChatCompletions(res, body);
  }
  jsonResp(res, { error: "not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`GCF Bridge running on http://localhost:${PORT}`);
  console.log(`  Anthropic: http://localhost:${PORT}/v1/messages`);
  console.log(`  OpenAI:    http://localhost:${PORT}/v1/chat/completions`);
});

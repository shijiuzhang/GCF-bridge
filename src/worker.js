import { MODELS, DEFAULT_MODEL, resolveModel, generateId, MAX_TOOL_REDELIVERY, truncateToolResult } from "./config.js";
import { sendToGemini, extractResponseText, streamGeminiResponse } from "./gemini.js";
import { getSession, saveSession, contentToBlocks, blockSignatures, computeDelta } from "./delta.js";
import { flattenContent, flattenPart } from "./content.js";
import {
  stripSystemReminders,
  buildToolsPrompt,
  extractSystemPrompt,
  buildAnthropicResponse,
  parseToolCalls,
  sseEvent,
  openSseEvents,
  contentBlockStart,
  contentBlockDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
  sanitizePrompt,
} from "./anthropic.js";
import { buildPersona } from "./persona.js";
import { handleMonitor, getHealthStatus } from "./monitor.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function sseResp(stream) {
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders() },
  });
}

async function handleAnthropicMessages(request, env) {
  const body = await request.json();
  const messages = body.messages || [];
  if (!messages.length) return jsonResp({ error: { type: "invalid_request_error", message: "messages is required" } }, 400);

  const modelInfo = resolveModel(body.model);
  const apiKey = request.headers.get("x-api-key") || request.headers.get("authorization") || "";
  const sessionId = (apiKey + "_" + (body.model || "default")).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 100) || "default";
  const msgId = `msg_${generateId("")}`;
  const stream = body.stream || false;
  const reqDump = JSON.stringify(body);

  if (reqDump.includes("Generate a concise, sentence-case title")) {
    return jsonResp({
      id: "msg_title_gen", type: "message", role: "assistant",
      content: [{ type: "text", text: '{"title": "GCF Bridge Session"}'}],
      model: modelInfo.name, stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  }

  const session = await getSession(env, sessionId);

  // If a new conversation starts (only 1 message), reset session state to avoid duplicate signature matches
  if (messages.length === 1) {
    session.lastBlocks = [];
    session.pendingToolIds = [];
    session.toolRedeliveryCount = 0;
    session.messageCount = 0;
    session.lastToolResponse = null;
  }

  const sysPrompt = extractSystemPrompt(body.system);
  const toolsPrompt = buildToolsPrompt(body.tools);

  const lastMsg = messages[messages.length - 1];
  const currentBlocks = contentToBlocks(lastMsg.content);
  const currentSigs = blockSignatures(currentBlocks);
  const deltaBlocks = computeDelta(session.lastBlocks, currentSigs);
  session.lastBlocks = currentSigs;

  console.log(`[GCF BRIDGE] messages.length=${messages.length} lastMsgRole=${lastMsg.role}`);
  console.log(`[GCF BRIDGE] session.lastBlocks=${JSON.stringify(session.lastBlocks)}`);
  console.log(`[GCF BRIDGE] currentSigs=${JSON.stringify(currentSigs)}`);
  console.log(`[GCF BRIDGE] deltaBlocks=${JSON.stringify(deltaBlocks)}`);

  if (!deltaBlocks.length) {
    if (session.pendingToolIds.length && session.toolRedeliveryCount < MAX_TOOL_REDELIVERY) {
      session.toolRedeliveryCount++;
      await saveSession(env, sessionId, session);
      const respObj = session.lastToolResponse || session.lastResponse || { id: msgId, type: "message", role: "assistant", content: [{ type: "text", text: "Standing by." }], model: modelInfo.name, stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
      if (stream) {
        return sseResp(createStaticStream(respObj));
      }
      return jsonResp(respObj);
    }
    session.pendingToolIds = [];
    session.toolRedeliveryCount = 0;
    await saveSession(env, sessionId, session);
    const respObj = session.lastResponse || { id: msgId, type: "message", role: "assistant", content: [{ type: "text", text: "Standing by." }], model: modelInfo.name, stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
    if (stream) {
      return sseResp(createStaticStream(respObj));
    }
    return jsonResp(respObj);
  }

  // Construct prompt from full history, truncating tool results to respect token limits
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
  session.lastPrompt = prompt;

  if (stream) {
    return sseResp(createStream(modelInfo, prompt, msgId, session, sessionId, env));
  }

  try {
    const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
    const text = extractResponseText(raw);
    const result = buildAnthropicResponse(text, modelInfo.name, msgId);

    if (result.stop_reason === "tool_use") {
      session.pendingToolIds = result.content.filter(b => b.type === "tool_use").map(b => b.id);
      session.lastToolResponse = result;
      session.toolRedeliveryCount = 0;
    } else {
      session.pendingToolIds = [];
      session.lastToolResponse = null;
    }
    session.lastResponse = result;
    session.messageCount++;
    await saveSession(env, sessionId, session);

    return jsonResp(result);
  } catch (e) {
    return jsonResp({ error: { type: "server_error", message: String(e) } }, 500);
  }
}

function createStream(modelInfo, prompt, msgId, session, sessionId, env) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of handleStream(modelInfo, prompt, msgId, session, sessionId, env)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        controller.error(e);
      }
      controller.close();
    },
  });
}

function createStaticStream(respObj) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(openSseEvents(respObj.id, respObj.model)));
        controller.enqueue(encoder.encode(contentBlockStart(0)));
        const text = respObj.content.filter(b => b.type === "text").map(b => b.text).join("");
        if (text) {
          controller.enqueue(encoder.encode(contentBlockDelta(0, text)));
        }
        controller.enqueue(encoder.encode(contentBlockStop(0)));
        controller.enqueue(encoder.encode(messageDelta(respObj.stop_reason)));
        controller.enqueue(encoder.encode(messageStop()));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.error(e);
      }
      controller.close();
    },
  });
}

async function* handleStream(modelInfo, prompt, msgId, session, sessionId, env) {
  yield openSseEvents(msgId, modelInfo.name);
  yield contentBlockStart(0);

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
            if (extra) yield contentBlockDelta(0, extra);
          }
          isStreamingToClient = false;
        } else {
          yield contentBlockDelta(0, chunk);
        }
      }
    }
  } catch {
    try {
      const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
      fullText = extractResponseText(raw);
      if (isStreamingToClient && fullText) {
        const { text: clean } = parseToolCalls(fullText);
        yield contentBlockDelta(0, clean);
      }
    } catch {}
  }

  yield contentBlockStop(0);

  const { text: cleanTextContent, toolBlocks } = parseToolCalls(fullText);

  // Send tool blocks
  let blockIdx = 1;
  for (const tb of toolBlocks) {
    yield sseEvent("content_block_start", {
      index: blockIdx,
      content_block: { type: "tool_use", id: tb.id, name: tb.name, input: {} }
    });
    yield sseEvent("content_block_delta", {
      index: blockIdx,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(tb.input) }
    });
    yield sseEvent("content_block_stop", { index: blockIdx });
    blockIdx++;
  }

  const stopReason = toolBlocks.length ? "tool_use" : "end_turn";
  yield messageDelta(stopReason);
  yield messageStop();
  yield "data: [DONE]\n\n";

  const finalResponse = {
    id: msgId,
    type: "message",
    role: "assistant",
    content: [
      ...(cleanTextContent ? [{ type: "text", text: cleanTextContent }] : []),
      ...toolBlocks
    ],
    model: modelInfo.name,
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 100 }
  };
  session.lastResponse = finalResponse;

  if (toolBlocks.length) {
    session.pendingToolIds = toolBlocks.map(b => b.id);
    session.toolRedeliveryCount = 0;
    session.lastToolResponse = finalResponse;
  } else {
    session.pendingToolIds = [];
    session.lastToolResponse = null;
  }
  session.messageCount++;
  await saveSession(env, sessionId, session);
}

async function handleChatCompletions(request) {
  const body = await request.json();
  const modelInfo = resolveModel(body.model);
  const messages = body.messages || [];
  if (!messages.length) return jsonResp({ error: { message: "messages required" } }, 400);

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

  const cid = `chatcmpl-${generateId("")}`;

  if (body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamGeminiResponse(prompt, modelInfo.mode, modelInfo.think)) {
            const data = {
              id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
              model: modelInfo.name, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        } catch {
          const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
          const text = extractResponseText(raw);
          if (text) {
            const data = {
              id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
              model: modelInfo.name, choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        }
        const final = {
          id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
          model: modelInfo.name, choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(final)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return sseResp(stream);
  }

  try {
    const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
    const text = extractResponseText(raw);
    return jsonResp({
      id: cid, object: "chat.completion", created: Math.floor(Date.now() / 1000),
      model: modelInfo.name,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: Math.floor(prompt.length / 4), completion_tokens: Math.floor((text || "").length / 4), total_tokens: Math.floor((prompt.length + (text || "").length) / 4) },
    });
  } catch (e) {
    return jsonResp({ error: { message: String(e) } }, 502);
  }
}

function handleModelsList() {
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

  return jsonResp({
    object: "list",
    data: list,
    has_more: false,
    first_id: list[0]?.id,
    last_id: list[list.length - 1]?.id
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    let path = url.pathname;
    if (path.startsWith("/v1/v1/")) {
      path = path.slice(3);
    }

    if (path === "/" && request.method === "GET") {
      return jsonResp({ status: "ok", version: "1.91.0", models: Object.keys(MODELS) });
    }

    if (path === "/health" && request.method === "GET") {
      const health = await getHealthStatus(env);
      return jsonResp(health);
    }

    if (path === "/v1/models" || path === "/v1beta/models") return handleModelsList();

    if (path === "/v1/messages" && request.method === "POST") return handleAnthropicMessages(request, env);

    if (path === "/v1/messages/count_tokens" && request.method === "POST") return jsonResp({ input_tokens: 100 });

    if (path === "/v1/chat/completions" && request.method === "POST") return handleChatCompletions(request);

    return jsonResp({ error: "not found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleMonitor(env));
  },
};

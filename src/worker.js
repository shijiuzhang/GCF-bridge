import { MODELS, DEFAULT_MODEL, resolveModel, generateId, MAX_TOOL_REDELIVERY } from "./config.js";
import { sendToGemini, extractResponseText, streamGeminiResponse } from "./gemini.js";
import { getSession, saveSession, contentToBlocks, blockSignatures, computeDelta, blocksToString } from "./delta.js";
import {
  buildToolsPrompt,
  extractSystemPrompt,
  buildAnthropicResponse,
  parseToolCalls,
  openSseEvents,
  contentBlockStart,
  contentBlockDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
} from "./anthropic.js";

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
  const sessionId = body.model || "default";
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
  const isSessionNew = session.messageCount === 0;

  const sysPrompt = extractSystemPrompt(body.system);
  const toolsPrompt = buildToolsPrompt(body.tools);

  const lastMsg = messages[messages.length - 1];
  const currentBlocks = contentToBlocks(lastMsg.content);
  const currentSigs = blockSignatures(currentBlocks);
  const deltaBlocks = computeDelta(session.lastBlocks, currentSigs);
  session.lastBlocks = currentSigs;

  const delta = blocksToString(deltaBlocks);
  const full = blocksToString(currentBlocks);

  let { text: deltaText, hasUserText, hasToolResult } = delta;
  const { text: fullText } = full;

  deltaText = deltaText.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();

  if (hasToolResult && !hasUserText) {
    if (!deltaText.trim()) deltaText = "[All tools completed with no stdout output.]";
    deltaText += "\n\n[Tools completed successfully. Provide a brief confirmation to the user of what was done.]";
  } else if (!hasUserText && deltaText) {
    deltaText += "\n\n[Tools executed successfully. Await next user instruction before taking further actions.]";
  }

  if (!deltaBlocks.length) {
    if (session.pendingToolIds.length && session.toolRedeliveryCount < MAX_TOOL_REDELIVERY) {
      session.toolRedeliveryCount++;
      await saveSession(env, sessionId, session);
      return jsonResp(session.lastToolResponse || { id: msgId, type: "message", role: "assistant", content: [{ type: "text", text: "Standing by." }], model: modelInfo.name, stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } });
    }
    session.pendingToolIds = [];
    session.toolRedeliveryCount = 0;
    await saveSession(env, sessionId, session);
    return jsonResp({ id: msgId, type: "message", role: "assistant", content: [{ type: "text", text: "Standing by." }], model: modelInfo.name, stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } });
  }

  let prompt;
  if (isSessionNew || deltaBlocks.length === currentBlocks.length) {
    prompt = `[SYSTEM INSTRUCTIONS]\n${sysPrompt}\n\n${toolsPrompt}\n[LATEST MESSAGE]\n${fullText}`;
  } else {
    const reminder = 'Reminder: To execute a tool, reply EXACTLY with: <TOOL_CALL>{"name": "...", "input": {...}}</TOOL_CALL>\n\n';
    prompt = `${reminder}[NEW EVENT]\n${deltaText}`;
  }
  prompt = prompt.replace(/\n{3,}/g, "\n\n").trim();

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

async function* handleStream(modelInfo, prompt, msgId, session, sessionId, env) {
  yield openSseEvents(msgId, modelInfo.name);
  yield contentBlockStart(0);

  let fullText = "";
  try {
    for await (const chunk of streamGeminiResponse(prompt, modelInfo.mode, modelInfo.think)) {
      fullText += chunk;
      yield contentBlockDelta(0, chunk);
    }
  } catch {
    const raw = await sendToGemini(prompt, modelInfo.mode, modelInfo.think);
    fullText = extractResponseText(raw);
    if (fullText) yield contentBlockDelta(0, fullText);
  }

  yield contentBlockStop(0);

  const toolData = parseToolCalls(fullText);
  const stopReason = toolData.toolBlocks.length ? "tool_use" : "end_turn";

  yield messageDelta(stopReason);
  yield messageStop();
  yield "data: [DONE]\n\n";

  if (toolData.toolBlocks.length) {
    session.pendingToolIds = toolData.toolBlocks.map(b => b.id);
    session.toolRedeliveryCount = 0;
  } else {
    session.pendingToolIds = [];
  }
  session.lastToolResponse = null;
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
    const content = typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.filter(c => c.type === "text").map(c => c.text).join(" ") : "");
    if (role === "system") parts.push(`[System instruction]: ${content}`);
    else if (role === "assistant") parts.push(`[Assistant]: ${content}`);
    else parts.push(content);
  }
  const prompt = parts.join("\n\n");

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
  return jsonResp({
    object: "list",
    data: Object.entries(MODELS).map(([name, cfg]) => ({
      id: name, object: "model", created: 1700000000, owned_by: "google", description: cfg.desc,
    })),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") {
      return jsonResp({ status: "ok", version: "1.0.0", models: Object.keys(MODELS) });
    }

    if (path === "/v1/models" || path === "/v1beta/models") return handleModelsList();

    if (path === "/v1/messages" && request.method === "POST") return handleAnthropicMessages(request, env);

    if (path === "/v1/messages/count_tokens" && request.method === "POST") return jsonResp({ input_tokens: 100 });

    if (path === "/v1/chat/completions" && request.method === "POST") return handleChatCompletions(request);

    return jsonResp({ error: "not found" }, 404);
  },
};

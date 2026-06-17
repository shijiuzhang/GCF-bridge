import { sendToGemini } from "./gemini.js";

const HEALTH_KEY = "health:status";
const HEALTH_TTL = 86400; // 24 hours

async function checkGeminiHealth() {
  try {
    const raw = await sendToGemini("hi", 1, 4);
    if (!raw || raw.length < 50) {
      return { ok: false, reason: "Empty or too short response" };
    }
    if (raw.includes("I cannot fulfill")) {
      return { ok: false, reason: "Safety filter blocked" };
    }
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

async function getHealthState(env) {
  try {
    const raw = await env.SESSION_KV.get(HEALTH_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { status: "unknown", lastCheck: 0, lastChange: 0, failCount: 0, reason: null };
}

async function saveHealthState(env, state) {
  state.lastCheck = Date.now();
  await env.SESSION_KV.put(HEALTH_KEY, JSON.stringify(state), { expirationTtl: HEALTH_TTL });
}

async function notifyPushPlus(token, title, content) {
  if (!token) return;
  try {
    await fetch("https://www.pushplus.plus/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, title, content, template: "txt" }),
    });
  } catch (e) {
    console.error("[Monitor] PushPlus notification failed:", e);
  }
}

async function notifyResend(apiKey, to, subject, text) {
  if (!apiKey || !to) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "GCF-Bridge Monitor <onboarding@resend.dev>",
        to: [to],
        subject,
        text,
      }),
    });
  } catch (e) {
    console.error("[Monitor] Resend notification failed:", e);
  }
}

function formatTime(ts) {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

async function notify(env, title, content) {
  await Promise.all([
    notifyPushPlus(env.PUSHPLUS_TOKEN, title, content),
    notifyResend(env.RESEND_API_KEY, env.NOTIFY_EMAIL, title, content),
  ]);
}

async function handleMonitor(env) {
  const prev = await getHealthState(env);
  const result = await checkGeminiHealth();
  const now = Date.now();

  console.log(`[Monitor] check result: ok=${result.ok} reason=${result.reason} prevStatus=${prev.status}`);

  if (result.ok) {
    if (prev.status === "down") {
      // Recovered
      const downMinutes = Math.round((now - prev.lastChange) / 60000);
      const title = "[GCF-bridge] Gemini 已恢复";
      const content = `Gemini 端点已恢复正常\n恢复时间: ${formatTime(now)}\n宕机时长: ${downMinutes} 分钟`;
      await notify(env, title, content);
    }
    await saveHealthState(env, {
      status: "healthy",
      lastCheck: now,
      lastChange: prev.status !== "healthy" ? now : prev.lastChange,
      failCount: 0,
      reason: null,
    });
  } else {
    if (prev.status !== "down") {
      // Just went down
      const title = "[GCF-bridge] Gemini 端点异常";
      const content = `Gemini 端点无法正常响应\n检测时间: ${formatTime(now)}\n失败原因: ${result.reason}`;
      await notify(env, title, content);
    }
    await saveHealthState(env, {
      status: "down",
      lastCheck: now,
      lastChange: prev.status !== "down" ? now : prev.lastChange,
      failCount: (prev.failCount || 0) + 1,
      reason: result.reason,
    });
  }
}

async function getHealthStatus(env) {
  const state = await getHealthState(env);
  return {
    ...state,
    lastCheckFormatted: state.lastCheck ? formatTime(state.lastCheck) : null,
    lastChangeFormatted: state.lastChange ? formatTime(state.lastChange) : null,
  };
}

export { handleMonitor, getHealthStatus };

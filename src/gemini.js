import { GEMINI_BL } from "./config.js";

let currentBL = GEMINI_BL;

function buildPayload(prompt, modelMode, thinkMode) {
  const inner = new Array(80).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ["en"];
  inner[2] = ["", "", "", null, null, null, null, null, null, ""];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[thinkMode]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2];
  inner[53] = 0;
  inner[59] = crypto.randomUUID();
  inner[61] = [];
  inner[68] = 1;
  inner[79] = modelMode;

  const outer = [null, JSON.stringify(inner)];
  return new URLSearchParams({ "f.req": JSON.stringify(outer) }).toString();
}

function buildUrl(bl = currentBL, useUserPrefix = false) {
  const reqId = Math.floor(Date.now() / 1000) % 1000000;
  const prefix = useUserPrefix ? "/u/0" : "";
  return `https://gemini.google.com${prefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${bl || GEMINI_BL}&hl=en&_reqid=${reqId}&rt=c`;
}

async function fetchLatestBL() {
  try {
    const resp = await fetch("https://gemini.google.com/app", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const m = html.match(/cfb2h":"([^"]+)"/) || html.match(/(boq_assistant-bard-web-server_\d+\.\d+_p\d+)/);
    if (m && m[1]) {
      return m[1];
    }
  } catch (e) {
    console.error("[Gemini] fetchLatestBL failed:", e);
  }
  return null;
}

async function getBL(env) {
  if (env && env.SESSION_KV) {
    try {
      const kvBL = await env.SESSION_KV.get("gemini:bl");
      if (kvBL) {
        currentBL = kvBL;
        return kvBL;
      }
    } catch {}
  }
  return currentBL || GEMINI_BL;
}

async function updateBL(env, newBL) {
  if (!newBL) return;
  currentBL = newBL;
  if (env && env.SESSION_KV) {
    try {
      await env.SESSION_KV.put("gemini:bl", newBL, { expirationTtl: 86400 * 7 });
    } catch (e) {
      console.error("[Gemini] Failed to save BL to KV:", e);
    }
  }
}

async function refreshBL(env) {
  const latest = await fetchLatestBL();
  if (latest && latest !== currentBL) {
    console.log(`[Gemini] BL updated: ${currentBL} -> ${latest}`);
    await updateBL(env, latest);
    return latest;
  }
  return latest || currentBL;
}

const COMMON_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "Origin": "https://gemini.google.com",
  "Referer": "https://gemini.google.com/app",
  "X-Same-Domain": "1",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

async function sendToGemini(prompt, modelMode, thinkMode, retriesOrOpts = 3) {
  let retries = 3;
  let env = null;
  if (typeof retriesOrOpts === "object" && retriesOrOpts !== null) {
    retries = retriesOrOpts.retries ?? 3;
    env = retriesOrOpts.env ?? null;
  } else if (typeof retriesOrOpts === "number") {
    retries = retriesOrOpts;
  }

  let bl = await getBL(env);
  const body = buildPayload(prompt, modelMode, thinkMode);

  for (let i = 0; i < retries; i++) {
    try {
      let url = buildUrl(bl, false);
      let resp = await fetch(url, {
        method: "POST",
        headers: COMMON_HEADERS,
        body,
      });

      if (resp.status === 405 || resp.status === 404) {
        console.warn(`[Gemini] HTTP ${resp.status} with BL ${bl}, attempting to refresh BL...`);
        const freshBL = await refreshBL(env);
        if (freshBL && freshBL !== bl) {
          bl = freshBL;
          url = buildUrl(bl, false);
          resp = await fetch(url, { method: "POST", headers: COMMON_HEADERS, body });
        }
        if (resp.status === 405 || resp.status === 404) {
          url = buildUrl(bl, true);
          resp = await fetch(url, { method: "POST", headers: COMMON_HEADERS, body });
        }
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function extractResponseText(raw) {
  const texts = [];
  for (const line of raw.split("\n")) {
    if (!line.includes('"wrb.fr"') || line.length < 200) continue;
    try {
      const arr = JSON.parse(line);
      const innerStr = arr[0][2];
      if (!innerStr || innerStr.length < 50) continue;
      const inner = JSON.parse(innerStr);
      if (Array.isArray(inner) && inner.length > 4 && inner[4]) {
        for (const part of inner[4]) {
          if (Array.isArray(part) && part.length > 1 && part[1]) {
            if (Array.isArray(part[1])) {
              for (const t of part[1]) {
                if (typeof t === "string" && t.length > 0) texts.push(t);
              }
            }
          }
        }
      }
    } catch {}
  }
  let text = "";
  for (let i = texts.length - 1; i >= 0; i--) {
    if (texts[i].trim()) { text = texts[i]; break; }
  }
  return cleanText(text).trim();
}

async function* streamGeminiResponse(prompt, modelMode, thinkMode, retriesOrOpts = 2) {
  let env = null;
  if (typeof retriesOrOpts === "object" && retriesOrOpts !== null) {
    env = retriesOrOpts.env ?? null;
  }

  let bl = await getBL(env);
  const body = buildPayload(prompt, modelMode, thinkMode);

  let url = buildUrl(bl, false);
  let resp = await fetch(url, { method: "POST", headers: COMMON_HEADERS, body });

  if (resp.status === 405 || resp.status === 404) {
    console.warn(`[Gemini Stream] HTTP ${resp.status} with BL ${bl}, attempting to refresh BL...`);
    const freshBL = await refreshBL(env);
    if (freshBL && freshBL !== bl) {
      bl = freshBL;
      url = buildUrl(bl, false);
      resp = await fetch(url, { method: "POST", headers: COMMON_HEADERS, body });
    }
    if (resp.status === 405 || resp.status === 404) {
      url = buildUrl(bl, true);
      resp = await fetch(url, { method: "POST", headers: COMMON_HEADERS, body });
    }
  }

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let prevText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    while (buf.includes("\n")) {
      const idx = buf.indexOf("\n");
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);

      if (!line.includes('"wrb.fr"') || line.length < 200) continue;
      try {
        const arr = JSON.parse(line);
        const innerStr = arr[0][2];
        if (!innerStr || innerStr.length < 50) continue;
        const inner2 = JSON.parse(innerStr);
        if (Array.isArray(inner2) && inner2.length > 4 && inner2[4]) {
          for (const part of inner2[4]) {
            if (Array.isArray(part) && part.length > 1 && part[1] && Array.isArray(part[1])) {
              for (const t of part[1]) {
                if (typeof t === "string" && t.length > prevText.length) {
                  const delta = t.slice(prevText.length);
                  const cleaned = cleanText(delta);
                  if (cleaned) yield cleaned;
                  prevText = t;
                }
              }
            }
          }
        }
      } catch {}
    }
  }
  if (buf.trim() && buf.includes('"wrb.fr"') && buf.length > 200) {
    try {
      const arr = JSON.parse(buf);
      const innerStr = arr[0][2];
      if (innerStr && innerStr.length > 50) {
        const inner2 = JSON.parse(innerStr);
        if (Array.isArray(inner2) && inner2.length > 4 && inner2[4]) {
          for (const part of inner2[4]) {
            if (Array.isArray(part) && part.length > 1 && part[1] && Array.isArray(part[1])) {
              for (const t of part[1]) {
                if (typeof t === "string" && t.length > prevText.length) {
                  const delta = t.slice(prevText.length);
                  const cleaned = cleanText(delta);
                  if (cleaned) yield cleaned;
                  prevText = t;
                }
              }
            }
          }
        }
      }
    } catch {}
  }
}

function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n.*?```\n?/gs, "")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">");
}

export {
  sendToGemini,
  extractResponseText,
  streamGeminiResponse,
  fetchLatestBL,
  getBL,
  updateBL,
  refreshBL,
};

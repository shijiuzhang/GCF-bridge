// content.js — flatten multimodal message content into a plain-text prompt.
//
// Anonymous (signed-out) access to the Gemini web endpoint cannot receive
// image or file uploads — that is a Google product limitation, not a bug in
// this bridge (see Google's "Upload & analyze files in Gemini Apps" help:
// uploads require signing in). So here we:
//   - pass through text,
//   - extract text from text-based files / data: URLs when possible,
//   - and emit a clear, language-agnostic notice for images and
//     unreadable files so the model can explain the limitation to the user.

const TEXT_MIME = /^(text\/|application\/(json|ld\+json|xml|x-ndjson|x-yaml|yaml|csv|markdown|x-markdown|javascript|x-javascript|typescript|sql|x-sh|x-shellscript|x-python|x-httpd-php|rtf))/i;

const IMG_NOTE =
  "[System note: The user attached an image, but image input is not available here. " +
  "This is a Google limitation: anonymous (signed-out) access to Gemini does not allow image or file uploads. " +
  "Politely tell the user — in their own language — that you cannot view images for this reason, " +
  "and offer to help if they describe the image or paste any relevant text.]";

function fileNote(name) {
  return (
    `[System note: The user attached a file${name ? ` "${name}"` : ""} that could not be read here. ` +
    "Anonymous (signed-out) access to Gemini does not support file uploads, so only plain-text content can be passed through. " +
    "Politely tell the user — in their own language — about this limitation and ask them to paste the relevant text.]"
  );
}

function b64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

// Decoded text for text-based data: URLs, otherwise null.
function decodeDataUrlText(url) {
  const m = /^data:([^;,]*)(;[^,]*)?,(.*)$/is.exec(url || "");
  if (!m) return null;
  const mime = (m[1] || "text/plain").toLowerCase();
  if (!TEXT_MIME.test(mime)) return null;
  const isB64 = /;base64/i.test(m[2] || "");
  try {
    return isB64 ? b64ToUtf8(m[3]) : decodeURIComponent(m[3]);
  } catch {
    return null;
  }
}

// Flatten one content part → { text, note }.
function flattenPart(part) {
  if (part == null) return { text: "", note: null };
  if (typeof part === "string") return { text: part, note: null };
  if (typeof part !== "object") return { text: "", note: null };
  const type = part.type || "";

  // Plain text
  if (typeof part.text === "string" && (type === "text" || !type)) {
    return { text: part.text, note: null };
  }

  // OpenAI image_url (some clients mislabel text docs as data: URLs here)
  if (type === "image_url") {
    const url = (part.image_url && (part.image_url.url || part.image_url)) || "";
    const decoded = typeof url === "string" && url.startsWith("data:") ? decodeDataUrlText(url) : null;
    return decoded != null ? { text: decoded, note: null } : { text: "", note: IMG_NOTE };
  }

  // Image blocks (OpenAI input_image / Anthropic image)
  if (type === "image" || type === "input_image") {
    return { text: "", note: IMG_NOTE };
  }

  // OpenAI file part
  if (type === "file" || type === "input_file") {
    const f = part.file || part;
    const name = f.filename || f.name || "";
    if (typeof f.text === "string" && f.text) {
      return { text: name ? `--- ${name} ---\n${f.text}` : f.text, note: null };
    }
    const url = f.file_data || f.data || f.url || f.file_url || "";
    const decoded = typeof url === "string" && url.startsWith("data:") ? decodeDataUrlText(url) : null;
    if (decoded != null) {
      return { text: name ? `--- ${name} ---\n${decoded}` : decoded, note: null };
    }
    return { text: "", note: fileNote(name) };
  }

  // Anthropic document block
  if (type === "document") {
    const src = part.source || {};
    const name = part.title || src.filename || src.name || "";
    if (src.type === "text" && typeof src.data === "string") {
      return { text: name ? `--- ${name} ---\n${src.data}` : src.data, note: null };
    }
    if (src.type === "base64" && typeof src.data === "string" && TEXT_MIME.test((src.media_type || "").toLowerCase())) {
      try {
        const t = b64ToUtf8(src.data);
        return { text: name ? `--- ${name} ---\n${t}` : t, note: null };
      } catch {}
    }
    return { text: "", note: fileNote(name) };
  }

  // Fallback: any object carrying a .text
  if (typeof part.text === "string") return { text: part.text, note: null };
  return { text: "", note: null };
}

// Flatten a whole content value (string | array) into a prompt string.
// Image / unreadable-file notices are de-duplicated and appended once.
function flattenContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts = [];
  const notes = new Set();
  for (const part of content) {
    const { text, note } = flattenPart(part);
    if (text) texts.push(text);
    if (note) notes.add(note);
  }
  let out = texts.join("\n").trim();
  if (notes.size) out = (out ? out + "\n\n" : "") + [...notes].join("\n");
  return out;
}

export { flattenContent, flattenPart, decodeDataUrlText, IMG_NOTE, fileNote };

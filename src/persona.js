/**
 * persona.js — Claude Persona Module (Disabled)
 *
 * Persona prompt injection is disabled because Google Gemini's safety filters
 * now block AI model impersonation ("Sorry, I cannot pretend to be someone else.").
 */

const PERSONA_PROMPT = "";

function buildPersona() {
  return PERSONA_PROMPT;
}

export { buildPersona, PERSONA_PROMPT };


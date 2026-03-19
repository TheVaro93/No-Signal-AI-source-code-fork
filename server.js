import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Supabase admin client ───────────────────────────────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Middleware ──────────────────────────────────────────────
app.use(express.static(__dirname));
app.use(express.json());

// ── GET /api/config ─────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// ── Auth middleware ─────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token provided.' });
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token.' });
  }

  req.user = user;
  next();
}

// ── Build system prompt from character ─────────────────────
function buildSystemPrompt(character, summary, userPersona) {
  const char = character ?? {};

  let prompt = `You are a roleplay character. Stay in character at all times. Never break character or mention that you are an AI.`;

  if (char.name)        prompt += `\n\nName: ${char.name}`;
  if (char.personality) prompt += `\nPersonality: ${char.personality}`;
  if (char.tone)        prompt += `\nTone: ${char.tone}`;
  if (char.lore)        prompt += `\nBackground / Lore: ${char.lore}`;

  if (summary) {
    prompt += `\n\n--- Memory summary (earlier in this conversation) ---\n${summary}`;
  }

  if (userPersona && (userPersona.name || userPersona.desc)) {
    prompt += `\n\n--- The person you're talking to ---`;
    if (userPersona.name) prompt += `\nName: ${userPersona.name}`;
    if (userPersona.desc) prompt += `\nDescription: ${userPersona.desc}`;
  }

  prompt += `\n\nRespond naturally, staying true to your character's personality and tone. Keep responses concise unless the scene demands otherwise.`;
  return prompt;
}

// ── POST /chat ──────────────────────────────────────────────
app.post('/chat', requireAuth, async (req, res) => {
  const { character, messages, summary, userPersona } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages is required.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not set on the server.' });
  }

  // Keep last 20 messages to stay within token limits
  const recentMessages = messages.slice(-20).map(m => ({
    role:    m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  const payload = {
    model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: buildSystemPrompt(character, summary, userPersona) },
      ...recentMessages,
    ],
    temperature: 0.85,
    max_tokens:  512,
  };

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    console.error('Groq error:', err);
    return res.status(502).json({ error: 'Upstream AI error.', detail: err });
  }

  const data  = await groqRes.json();
  const reply = data.choices?.[0]?.message?.content ?? '';
  res.json({ reply });
});

// ── Health check ────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`NO-SIGNAL backend running on port ${PORT}`));

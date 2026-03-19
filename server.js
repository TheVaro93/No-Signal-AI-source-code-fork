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

// ── POST /chat (SSE streaming) ──────────────────────────────
app.post('/chat', requireAuth, async (req, res) => {
  const { character, messages, summary: existingSummary, userPersona } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages is required.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not set on the server.' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let currentSummary = existingSummary ?? null;
  let newSummary = null;

  // Feature 3: summarize older messages when history is long
  if (messages.length > 20) {
    const oldMessages = messages.slice(0, messages.length - 10);
    const formattedOld = oldMessages.map(m => `${m.role}: ${m.content}`).join('\n');
    const summaryPayload = {
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `Summarize the following roleplay conversation in 3-5 sentences, keeping key events and character dynamics:\n\n${formattedOld}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 200,
    };

    try {
      const summaryRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(summaryPayload),
      });

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        newSummary = summaryData.choices?.[0]?.message?.content ?? null;
        if (newSummary) currentSummary = newSummary;
      }
    } catch (err) {
      console.error('Summarization error:', err);
    }
  }

  // Use last 10 messages for the streaming request
  const recentMessages = messages.slice(-10).map(m => ({
    role:    m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  const payload = {
    model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: buildSystemPrompt(character, currentSummary, userPersona) },
      ...recentMessages,
    ],
    temperature: 0.85,
    max_tokens:  512,
    stream: true,
  };

  let groqRes;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Groq fetch error:', err);
    res.write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  if (!groqRes.ok) {
    const err = await groqRes.text();
    console.error('Groq error:', err);
    res.write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  // Stream SSE chunks from Groq directly to client
  const reader = groqRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Pass through lines as-is
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          res.write(line + '\n\n');
          if (line === 'data: [DONE]') break;
        }
      }
    }
  } catch (err) {
    console.error('Stream read error:', err);
  }

  // After [DONE], send summary event if a new summary was generated
  if (newSummary) {
    res.write(`event: summary\ndata: ${JSON.stringify({ summary: newSummary })}\n\n`);
  }

  res.end();
});

// ── Health check ────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`NO-SIGNAL backend running on port ${PORT}`));

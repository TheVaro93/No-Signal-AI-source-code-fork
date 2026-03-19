import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Model map (custom names, no brand names) ────────────────
const MODEL_MAP = {
  'aurora-70': { provider: 'groq',   id: 'llama-3.3-70b-versatile',  baseUrl: 'https://api.groq.com/openai/v1' },
  'prism':     { provider: 'groq',   id: 'mixtral-8x7b-32768',        baseUrl: 'https://api.groq.com/openai/v1' },
  'swift':     { provider: 'groq',   id: 'llama3-8b-8192',            baseUrl: 'https://api.groq.com/openai/v1' },
  'stellar':   { provider: 'gemini', id: 'gemini-1.5-flash',           baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
};
const DEFAULT_MODEL = 'aurora-70';

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
  const { character, messages, summary: existingSummary, userPersona, modelKey } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages is required.' });
  }

  // Resolve model from MODEL_MAP
  const resolvedModelKey = (modelKey && MODEL_MAP[modelKey]) ? modelKey : DEFAULT_MODEL;
  const model = MODEL_MAP[resolvedModelKey];

  // Resolve API key and base URL based on provider
  let apiKey;
  if (model.provider === 'groq') {
    apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not set on the server.' });
    }
  } else if (model.provider === 'gemini') {
    apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server.' });
    }
  } else {
    return res.status(500).json({ error: 'Unknown provider.' });
  }

  const baseUrl = model.baseUrl;
  const modelId = model.id;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let currentSummary = existingSummary ?? null;
  let newSummary = null;

  // Summarize older messages when history is long
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
      // Always use Groq for summarization (fast and cheap)
      const summaryApiKey = process.env.GROQ_API_KEY;
      if (summaryApiKey) {
        const summaryRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${summaryApiKey}`,
          },
          body: JSON.stringify(summaryPayload),
        });

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          newSummary = summaryData.choices?.[0]?.message?.content ?? null;
          if (newSummary) currentSummary = newSummary;
        }
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
    model: modelId,
    messages: [
      { role: 'system', content: buildSystemPrompt(character, currentSummary, userPersona) },
      ...recentMessages,
    ],
    temperature: 0.85,
    max_tokens:  512,
    stream: true,
  };

  let aiRes;
  try {
    aiRes = await fetch(`${baseUrl}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('AI fetch error:', err);
    res.write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error('AI error:', err);
    res.write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  // Stream SSE chunks from AI directly to client
  const reader = aiRes.body.getReader();
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

// ── POST /create-checkout-session (Stripe) ──────────────────
app.post('/create-checkout-session', async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Payments not configured.' });

  const stripe = new Stripe(stripeKey);
  const host = req.headers.origin ?? `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${host}/?subscribed=1`,
      cancel_url:  `${host}/subscribe.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

app.listen(PORT, () => console.log(`NO-SIGNAL backend running on port ${PORT}`));

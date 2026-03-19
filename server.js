import express from 'express';
import cors from 'cors';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN ?? '*', // set to your GitHub Pages URL in prod
}));
app.use(express.json());

// ── Build system prompt from character ────────────────────
function buildSystemPrompt(character, summary) {
  const char = character ?? {};

  let prompt = `You are a roleplay character. Stay in character at all times. Never break character or mention that you are an AI.`;

  if (char.name)        prompt += `\n\nName: ${char.name}`;
  if (char.personality) prompt += `\nPersonality: ${char.personality}`;
  if (char.tone)        prompt += `\nTone: ${char.tone}`;
  if (char.lore)        prompt += `\nBackground / Lore: ${char.lore}`;

  if (summary) {
    prompt += `\n\n--- Memory summary (earlier in this conversation) ---\n${summary}`;
  }

  prompt += `\n\nRespond naturally, staying true to your character's personality and tone. Keep responses concise unless the scene demands otherwise.`;
  return prompt;
}

// ── POST /chat ─────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { character, messages, summary } = req.body;

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
      { role: 'system', content: buildSystemPrompt(character, summary) },
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

// ── Health check ───────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`NO-SIGNAL backend running on port ${PORT}`));

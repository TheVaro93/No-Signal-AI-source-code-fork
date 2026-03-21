import express      from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import Stripe          from 'stripe';
import rateLimit       from 'express-rate-limit';
import multer          from 'multer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, 'public');

const app  = express();
const PORT = process.env.PORT || 3000;
const SIGNED_URL_TTL_SECONDS = Number(process.env.UPLOAD_URL_TTL_SECONDS) || 60 * 60;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN ?? '')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

// ── Model registry ──────────────────────────────────────────
const MODEL_REGISTRY = {
  'aurora-70':  { provider: 'groq',   id: 'llama-3.3-70b-versatile',        baseUrl: 'https://api.groq.com/openai/v1',                          vision: false },
  'prism':      { provider: 'groq',   id: 'mixtral-8x7b-32768',              baseUrl: 'https://api.groq.com/openai/v1',                          vision: false },
  'swift':      { provider: 'groq',   id: 'llama3-8b-8192',                  baseUrl: 'https://api.groq.com/openai/v1',                          vision: false },
  'lumina':     { provider: 'groq',   id: 'llama-3.1-8b-instant',            baseUrl: 'https://api.groq.com/openai/v1',                          vision: false },
  'vision-90':  { provider: 'groq',   id: 'llama-3.2-90b-vision-preview',    baseUrl: 'https://api.groq.com/openai/v1',                          vision: true  },
  'stellar':    { provider: 'gemini', id: 'gemini-1.5-flash',                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', vision: true  },
};
const DEFAULT_MODEL = 'aurora-70';

function getModel(key) {
  const def    = MODEL_REGISTRY[key] ?? MODEL_REGISTRY[DEFAULT_MODEL];
  const apiKey = def.provider === 'groq' ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY;
  return { ...def, apiKey };
}

// ── Dev config ──────────────────────────────────────────────
const DEV_BADGE_CONFIG = {
  'yugoslevent@gmail.com': ['OWNER', 'DEV', 'ADMIN', 'CODEUR'],
  'yugo2028@gmail.com':    ['DEV'],
  'yugo063@gmail.com':     ['DEV'],
};
function getDevEmails() {
  return (process.env.DEV_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean);
}

// ── Supabase admin ──────────────────────────────────────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Multer (file uploads, memory storage) ───────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'].includes(file.mimetype);
    cb(null, ok);
  },
});

// ── Rate limiters ───────────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  keyGenerator:    req => req.user?.id ?? req.ip,
  message:         { error: 'Trop de messages. Attendez quelques minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
});

// ── Middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin?.replace(/\/$/, '');
  if (origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(FRONTEND_DIR));
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiLimiter);

// ── Auth middleware ─────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token invalide ou expiré.' });
  req.user = user;
  next();
}

// ── System prompt builder ───────────────────────────────────
function buildSystemPrompt(character, summary, userPersona, ragContext) {
  const char = character ?? {};
  let prompt = `You are a roleplay character. Stay in character at all times. Never break character or mention you are an AI.`;

  if (char.name)        prompt += `\n\nName: ${char.name}`;
  if (char.personality) prompt += `\nPersonality: ${char.personality}`;
  if (char.tone)        prompt += `\nTone: ${char.tone}`;
  if (char.lore)        prompt += `\nBackground / Lore: ${char.lore}`;

  if (summary)    prompt += `\n\n--- Memory summary (earlier in this conversation) ---\n${summary}`;
  if (ragContext) prompt += `\n\n--- Relevant past memories ---\n${ragContext}`;

  if (userPersona?.name || userPersona?.desc) {
    prompt += `\n\n--- The person you're talking to ---`;
    if (userPersona.name) prompt += `\nName: ${userPersona.name}`;
    if (userPersona.desc) prompt += `\nDescription: ${userPersona.desc}`;
  }

  prompt += `\n\nRespond naturally, staying true to your character. Keep responses concise unless the scene demands otherwise.`;
  return prompt;
}

// ── HuggingFace embeddings (RAG) ────────────────────────────
async function embedText(text) {
  const hfKey = process.env.HF_API_KEY;
  if (!hfKey) return null;
  try {
    const res = await fetch(
      'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2',
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inputs: text.slice(0, 512) }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data[0]) ? data[0] : data;
  } catch { return null; }
}

async function searchMemories(userId, embedding, matchCount = 3) {
  if (!embedding) return [];
  const { data } = await supabaseAdmin.rpc('search_memories', {
    query_embedding: `[${embedding.join(',')}]`,
    user_id_filter:  userId,
    match_count:     matchCount,
  });
  return data ?? [];
}

async function storeMemory(userId, sessionId, userMsg, assistantMsg, charName) {
  const content   = `User: ${userMsg}\n${charName ?? 'AI'}: ${assistantMsg}`;
  const embedding = await embedText(content);
  if (!embedding) return;
  await supabaseAdmin.from('memory_vectors').insert({
    user_id:    userId,
    session_id: sessionId,
    content,
    embedding:  `[${embedding.join(',')}]`,
  }).catch(err => console.error('storeMemory error:', err));
}

// ── GET /api/config ─────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    devEmails:       getDevEmails(),
    devBadgeConfig:  DEV_BADGE_CONFIG,
    ragEnabled:      !!process.env.HF_API_KEY,
    models:          Object.fromEntries(
      Object.entries(MODEL_REGISTRY).map(([k, v]) => [k, { vision: v.vision }])
    ),
  });
});

// ── POST /chat (SSE streaming) ──────────────────────────────
app.post('/chat', requireAuth, chatLimiter, async (req, res) => {
  const {
    character, messages, summary: existingSummary,
    userPersona, modelKey, sessionId, attachedImageUrl,
  } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages requis.' });
  }

  const model = getModel(modelKey);
  if (!model.apiKey) {
    return res.status(500).json({ error: `Clé API manquante pour "${model.provider}".` });
  }
  if (attachedImageUrl && !model.vision) {
    return res.status(400).json({ error: 'Ce modèle ne supporte pas les images. Utilisez STELLAR ou VISION-90.' });
  }

  // RAG search
  let ragContext = '';
  if (process.env.HF_API_KEY && sessionId) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const emb = await embedText(lastUserMsg);
    const mems = await searchMemories(req.user.id, emb);
    if (mems.length > 0) ragContext = mems.map(m => m.content).join('\n---\n');
  }

  // Summarize old messages
  let currentSummary = existingSummary ?? null;
  let newSummary     = null;
  if (messages.length > 20 && process.env.GROQ_API_KEY) {
    try {
      const oldText    = messages.slice(0, -10).map(m => `${m.role}: ${m.content}`).join('\n');
      const summaryRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama3-8b-8192',
          messages: [{ role: 'user', content: `Summarize this roleplay conversation in 3-5 sentences:\n\n${oldText}` }],
          temperature: 0.5, max_tokens: 200,
        }),
      });
      if (summaryRes.ok) {
        const d = await summaryRes.json();
        newSummary = d.choices?.[0]?.message?.content ?? null;
        if (newSummary) currentSummary = newSummary;
      }
    } catch (err) { console.error('Summarization error:', err); }
  }

  // Build messages array for AI
  const recentMessages = messages.slice(-10).map((m, i, arr) => {
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (attachedImageUrl && i === arr.length - 1 && role === 'user' && model.vision) {
      return {
        role,
        content: [
          { type: 'text', text: m.content || 'Describe what you see.' },
          { type: 'image_url', image_url: { url: attachedImageUrl } },
        ],
      };
    }
    return { role, content: m.content };
  });

  const payload = {
    model:       model.id,
    messages:    [
      { role: 'system', content: buildSystemPrompt(character, currentSummary, userPersona, ragContext) },
      ...recentMessages,
    ],
    temperature: 0.85,
    max_tokens:  512,
    stream:      true,
  };

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  let aiRes;
  try {
    aiRes = await fetch(`${model.baseUrl}/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${model.apiKey}` },
      body:    JSON.stringify(payload),
    });
  } catch (err) {
    console.error('AI fetch error:', err);
    res.write('data: [DONE]\n\n'); res.end(); return;
  }

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error('AI error:', err);
    res.write('data: [DONE]\n\n'); res.end(); return;
  }

  const reader  = aiRes.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        res.write(line + '\n\n');
        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') break;
        try {
          const parsed = JSON.parse(dataStr);
          fullContent += parsed.choices?.[0]?.delta?.content ?? '';
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) { console.error('Stream read error:', err); }

  if (newSummary) {
    res.write(`event: summary\ndata: ${JSON.stringify({ summary: newSummary })}\n\n`);
  }
  res.end();

  // Store memory (fire & forget)
  if (process.env.HF_API_KEY && sessionId && fullContent) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    storeMemory(req.user.id, sessionId, lastUserMsg, fullContent, character?.name);
  }
});

// ── POST /api/upload ────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  const ext  = file.originalname.split('.').pop().toLowerCase();
  const path = `${req.user.id}/${Date.now()}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from('uploads')
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) return res.status(500).json({ error: error.message });

  // Private bucket: return a short-lived signed URL
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('uploads')
    .createSignedUrl(data.path, SIGNED_URL_TTL_SECONDS);
  if (signErr) return res.status(500).json({ error: signErr.message });

  res.json({
    url:  signed.signedUrl,
    path: data.path,
    type: file.mimetype,
    name: file.originalname,
  });
});

// ── GET /api/uploads/signed ─────────────────────────────────
app.get('/api/uploads/signed', requireAuth, async (req, res) => {
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path) return res.status(400).json({ error: 'path requis.' });
  if (!path.startsWith(`${req.user.id}/`)) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }

  const { data, error } = await supabaseAdmin.storage
    .from('uploads')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: data.signedUrl });
});

// ── GET /api/dev/stats ──────────────────────────────────────
app.get('/api/dev/stats', requireAuth, async (req, res) => {
  if (!getDevEmails().includes(req.user.email)) return res.status(403).json({ error: 'Forbidden' });

  const [
    { count: userCount },
    { count: charCount },
    { count: sessionCount },
    { count: memoryCount },
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('characters').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('chat_sessions').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('memory_vectors').select('*', { count: 'exact', head: true }),
  ]);

  res.json({ userCount, charCount, sessionCount, memoryCount, ragEnabled: !!process.env.HF_API_KEY });
});

// ── GET /api/announcements ──────────────────────────────────
app.get('/api/announcements', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// ── POST /api/announcements (dev only) ──────────────────────
app.post('/api/announcements', requireAuth, async (req, res) => {
  if (!getDevEmails().includes(req.user.email)) {
    return res.status(403).json({ error: 'Compte dev requis.' });
  }
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Contenu requis.' });

  const badges = DEV_BADGE_CONFIG[req.user.email] ?? ['DEV'];
  const { data, error } = await supabaseAdmin
    .from('announcements')
    .insert({ author_email: req.user.email, author_badges: badges, content: content.trim() })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Health ──────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', version: '2.0' }));

// ── POST /create-checkout-session ───────────────────────────
app.post('/create-checkout-session', async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Paiements non configurés.' });
  const stripe = new Stripe(stripeKey);
  const host   = req.headers.origin ?? `https://${req.headers.host}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode:        'subscription',
      line_items:  [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${host}/?subscribed=1`,
      cancel_url:  `${host}/subscribe.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Impossible de créer la session de paiement.' });
  }
});

// ── GET /api/characters ─────────────────────────────────────
app.get('/api/characters', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// ── POST /api/characters ────────────────────────────────────
app.post('/api/characters', requireAuth, async (req, res) => {
  const { name, personality = '', tone = '', lore = '', avatar_url = '' } = req.body;
  if (!name?.trim())               return res.status(400).json({ error: 'Le nom est requis.' });
  if (name.trim().length > 100)    return res.status(400).json({ error: 'Nom trop long (max 100).' });
  const personalityT = personality.trim();
  const toneT        = tone.trim();
  const loreT        = lore.trim();
  if (personalityT.length > 1000)  return res.status(400).json({ error: 'Personnalité trop longue (max 1000).' });
  if (toneT.length > 1000)         return res.status(400).json({ error: 'Ton trop long (max 1000).' });
  if (loreT.length > 2000)         return res.status(400).json({ error: 'Lore trop long (max 2000).' });
  if (avatar_url && avatar_url.length > 500)    return res.status(400).json({ error: 'URL avatar trop longue (max 500).' });
  if (avatar_url && !avatar_url.startsWith('https://')) return res.status(400).json({ error: 'URL avatar invalide.' });

  const { data, error } = await supabaseAdmin
    .from('characters')
    .insert({ user_id: req.user.id, name: name.trim(), personality: personalityT, tone: toneT, lore: loreT, avatar_url })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.listen(PORT, () => console.log(`NO-SIGNAL backend v2 running on port ${PORT}`));

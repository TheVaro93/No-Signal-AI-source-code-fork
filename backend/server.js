import express      from 'express';
import fs           from 'fs';
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

// ── AI config (private) ─────────────────────────────────────
const AI_CONFIG_PATH = process.env.AI_CONFIG_PATH
  ? resolve(process.env.AI_CONFIG_PATH)
  : resolve(__dirname, '..', '.private', 'ai-config.json');

function loadAiConfig() {
  let raw = '';
  if (process.env.AI_CONFIG_JSON) raw = process.env.AI_CONFIG_JSON;
  else if (fs.existsSync(AI_CONFIG_PATH)) raw = fs.readFileSync(AI_CONFIG_PATH, 'utf8');
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (err) {
    console.error('AI config error:', err?.message ?? err);
    return null;
  }
}

function buildFallbackConfig() {
  const groqModel = process.env.GROQ_MODEL;
  const groqKey   = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!groqModel || !groqKey) return null;
  const groqBase   = 'https://api.groq.com/openai/v1';
  const geminiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';
  return {
    defaultModel: 'aurora-70',
    models: {
      'aurora-70':  { id: groqModel,                      baseUrl: groqBase,   apiKeyEnv: 'GROQ_API_KEY',   vision: false },
      'swift':      { id: 'llama-3.1-8b-instant',         baseUrl: groqBase,   apiKeyEnv: 'GROQ_API_KEY',   vision: false },
      'prism':      { id: 'mixtral-8x7b-32768',           baseUrl: groqBase,   apiKeyEnv: 'GROQ_API_KEY',   vision: false },
      'vision-90':  { id: 'llama-3.2-90b-vision-preview', baseUrl: groqBase,   apiKeyEnv: 'GROQ_API_KEY',   vision: true  },
      ...(geminiKey ? {
        'stellar':  { id: 'gemini-2.0-flash',  baseUrl: geminiBase, apiKeyEnv: 'GEMINI_API_KEY', vision: true  },
        'lumina':   { id: 'gemini-1.5-flash',  baseUrl: geminiBase, apiKeyEnv: 'GEMINI_API_KEY', vision: false },
      } : {}),
    },
    summarization: {
      modelId: 'llama-3.1-8b-instant', baseUrl: groqBase, apiKeyEnv: 'GROQ_API_KEY',
      temperature: 0.5, maxTokens: 200, minMessages: 20, keepLast: 10,
    },
  };
}

const AI_CONFIG = loadAiConfig() ?? buildFallbackConfig();
const MODEL_REGISTRY = AI_CONFIG?.models ?? {};
const DEFAULT_MODEL = AI_CONFIG?.defaultModel ?? Object.keys(MODEL_REGISTRY)[0] ?? null;

function getModel(key) {
  if (!DEFAULT_MODEL) return null;
  const def = MODEL_REGISTRY[key] ?? MODEL_REGISTRY[DEFAULT_MODEL];
  if (!def) return null;
  const apiKey = def.apiKeyEnv ? process.env[def.apiKeyEnv] : null;
  return { ...def, apiKey };
}

function getEmbeddingsConfig() {
  const def = AI_CONFIG?.embeddings;
  if (!def) return null;
  const apiKey = def.apiKeyEnv ? process.env[def.apiKeyEnv] : null;
  return { ...def, apiKey };
}

function getSummaryConfig() {
  const def = AI_CONFIG?.summarization;
  if (!def) return null;
  const apiKey = def.apiKeyEnv ? process.env[def.apiKeyEnv] : null;
  return { ...def, apiKey };
}

// ── Dev config ──────────────────────────────────────────────
const DEV_BADGE_CONFIG = JSON.parse(process.env.DEV_BADGE_CONFIG ?? '{}');
function getDevEmails() {
  return (process.env.DEV_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean);
}

// ── Supabase admin ──────────────────────────────────────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Per-request client that carries the user's JWT → satisfies RLS policies
function getUserClient(req) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: req.headers.authorization } } }
  );
}

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
  // Always allow same-origin requests (browser sends Origin on POST/PUT/DELETE even for same domain)
  const ownOrigin = `https://${req.headers.host}`;
  const isAllowed = !origin
    || ALLOWED_ORIGINS.length === 0
    || ALLOWED_ORIGINS.includes(origin)
    || origin === ownOrigin;

  if (origin && !isAllowed) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  if (origin && isAllowed) {
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

// ── Optional auth middleware (guest-safe) ───────────────────
async function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { next(); return; }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (!error && user) req.user = user;
  next();
}

// ── System prompt builder ───────────────────────────────────
function buildSystemPrompt(character, summary, userPersona, ragContext) {
  const char = character ?? {};

  // Identité — toujours présente (D-01, D-02)
  let prompt = char.name
    ? `You ARE ${char.name}. This is not roleplay — you are ${char.name}, speaking with your own voice.`
    : `You are a character. Speak with your own voice.`;

  // Personality — omise si vide (D-03)
  if (char.personality?.trim()) prompt += `\n\n${char.personality.trim()}`;

  // Tone — omise si vide (D-03)
  if (char.tone?.trim()) prompt += `\n\nTone: ${char.tone.trim()}`;

  // Writing style — section dédiée, nouveau champ (D-06, D-03)
  if (char.style?.trim()) prompt += `\n\nWriting style: ${char.style.trim()}`;

  // Background/Lore — omise si vide (D-03)
  if (char.lore?.trim()) prompt += `\n\nBackground: ${char.lore.trim()}`;

  // Memory summary
  if (summary) prompt += `\n\n--- Memory summary (earlier in this conversation) ---\n${summary}`;

  // RAG context
  if (ragContext) prompt += `\n\n--- Relevant past memories ---\n${ragContext}`;

  // User persona
  if (userPersona?.name || userPersona?.desc) {
    prompt += `\n\n--- The person you're talking to ---`;
    if (userPersona.name) prompt += `\nName: ${userPersona.name}`;
    if (userPersona.desc) prompt += `\nDescription: ${userPersona.desc}`;
  }

  // Ligne de clôture naturelle (D-04 — toujours présente)
  prompt += `\n\nSpeak naturally, as yourself. Never break this identity.`;

  return prompt;
}

// ── Embeddings (RAG) ────────────────────────────────────────
async function embedText(text) {
  const cfg = getEmbeddingsConfig();
  if (!cfg?.apiKey || !cfg?.baseUrl) return null;
  const maxChars = Number(cfg.inputMaxChars) || 512;
  try {
    const res = await fetch(
      cfg.baseUrl,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inputs: text.slice(0, maxChars) }),
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
  const embeddingsCfg = getEmbeddingsConfig();
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    devEmails:       getDevEmails(),
    devBadgeConfig:  DEV_BADGE_CONFIG,
    ragEnabled:      !!embeddingsCfg?.apiKey,
    models:          Object.fromEntries(
      Object.entries(MODEL_REGISTRY).map(([k, v]) => [k, { vision: v.vision }])
    ),
  });
});

// ── POST /chat (SSE streaming) ──────────────────────────────
app.post('/chat', optionalAuth, chatLimiter, async (req, res) => {
  const {
    character, messages, summary: existingSummary,
    userPersona, modelKey, sessionId, attachedImageUrl,
  } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages requis.' });
  }

  const model = getModel(modelKey);
  if (!model) {
    return res.status(503).json({ error: 'Configuration AI manquante.' });
  }
  if (!model.apiKey) {
    return res.status(500).json({ error: 'Clé API manquante pour ce modèle.' });
  }
  if (attachedImageUrl && !model.vision) {
    return res.status(400).json({ error: 'Ce modèle ne supporte pas les images. Utilisez STELLAR ou VISION-90.' });
  }

  // RAG search
  const embeddingsCfg = getEmbeddingsConfig();
  let ragContext = '';
  if (req.user && embeddingsCfg?.apiKey && sessionId) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const emb = await embedText(lastUserMsg);
    const mems = await searchMemories(req.user.id, emb);
    if (mems.length > 0) ragContext = mems.map(m => m.content).join('\n---\n');
  }

  // Summarize old messages
  let currentSummary = existingSummary ?? null;
  let newSummary     = null;
  const summaryCfg   = getSummaryConfig();
  const minMessages  = Number(summaryCfg?.minMessages) || 20;
  const keepLast     = Number(summaryCfg?.keepLast) || 10;
  if (
    messages.length > minMessages
    && summaryCfg?.apiKey
    && summaryCfg?.baseUrl
    && summaryCfg?.modelId
  ) {
    try {
      const oldText    = messages.slice(0, -keepLast).map(m => `${m.role}: ${m.content}`).join('\n');
      const summaryRes = await fetch(`${summaryCfg.baseUrl}/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${summaryCfg.apiKey}` },
        body: JSON.stringify({
          model: summaryCfg.modelId,
          messages: [{ role: 'user', content: `Summarize this roleplay conversation in 3-5 sentences:\n\n${oldText}` }],
          temperature: Number(summaryCfg.temperature) || 0.5,
          max_tokens:  Number(summaryCfg.maxTokens) || 200,
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

  // Update session preview (fire & forget)
  if (req.user && sessionId && fullContent) {
    supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message_preview: fullContent.slice(0, 80),
        last_message_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('user_id', req.user.id)
      .then(({ error }) => { if (error) console.error('preview update error:', error.message); });
  }

  // Store memory (fire & forget)
  if (req.user && embeddingsCfg?.apiKey && sessionId && fullContent) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    storeMemory(req.user.id, sessionId, lastUserMsg, fullContent, character?.name);
  }

  // Incrémenter chat_count pour les sessions invité (STAT-01)
  if (!req.user && character?.id) {
    supabaseAdmin
      .rpc('increment_chat_count', { char_id: character.id })
      .catch(err => console.error('increment_chat_count error:', err));
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

  const embeddingsCfg = getEmbeddingsConfig();
  res.json({ userCount, charCount, sessionCount, memoryCount, ragEnabled: !!embeddingsCfg?.apiKey });
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

// ── PATCH /api/sessions/:id ─────────────────────────────────
app.patch('/api/sessions/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, archived } = req.body;
  const updates = {};

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ error: 'Le nom ne peut pas être vide.' });
    if (trimmed.length > 100) return res.status(400).json({ error: 'Nom trop long (max 100 caractères).' });
    updates.name = trimmed;
  }
  if (archived !== undefined) {
    updates.archived = Boolean(archived);
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  }

  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .update(updates)
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Session introuvable.' });
  res.json({ ok: true });
});

// ── DELETE /api/sessions/:id ─────────────────────────────────
app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  // Verify ownership first
  const { data: session, error: fetchErr } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single();

  if (fetchErr || !session) return res.status(404).json({ error: 'Session introuvable.' });

  // Now safe to delete messages (chat_messages has no user_id column)
  const { error: msgErr } = await supabaseAdmin.from('chat_messages').delete().eq('session_id', id);
  if (msgErr) console.error('chat_messages delete error:', msgErr.message);

  // Delete associated RAG embeddings
  await supabaseAdmin.from('memory_vectors').delete().eq('session_id', id);

  const { error } = await supabaseAdmin
    .from('chat_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
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
  const { data, error } = await getUserClient(req)
    .from('characters')
    .select('*')
    .eq('creator_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// ── GET /api/characters/public ──────────────────────────────
app.get('/api/characters/public', async (req, res) => {
  const { category } = req.query;
  const VALID_CATEGORIES = ['anime', 'fantasy', 'sci-fi', 'historique', 'original', 'autre'];

  let query = supabaseAdmin
    .from('characters')
    .select('id, name, personality, category, avatar_url, creator_username, created_at, chat_count')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(100);

  if (category && VALID_CATEGORIES.includes(category)) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// ── GET /api/characters/public/:id ─────────────────────────
app.get('/api/characters/public/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select('id, name, personality, category, avatar_url, creator_username, chat_count, tone, lore, style')
    .eq('id', id)
    .eq('is_public', true)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Personnage introuvable.' });
  res.json(data);
});

// ── POST /api/characters ────────────────────────────────────
app.post('/api/characters', requireAuth, async (req, res) => {
  const { name, personality = '', tone = '', lore = '', avatar_url = '',
          style = '', is_public = false, category = 'autre' } = req.body;
  if (!name?.trim())               return res.status(400).json({ error: 'Le nom est requis.' });
  if (name.trim().length > 100)    return res.status(400).json({ error: 'Nom trop long (max 100).' });
  const personalityT = String(personality ?? '').trim();
  const toneT        = String(tone ?? '').trim();
  const loreT        = String(lore ?? '').trim();
  if (personalityT.length > 1000)  return res.status(400).json({ error: 'Personnalité trop longue (max 1000).' });
  if (toneT.length > 1000)         return res.status(400).json({ error: 'Ton trop long (max 1000).' });
  if (loreT.length > 2000)         return res.status(400).json({ error: 'Lore trop long (max 2000).' });
  const avatar_urlT = String(avatar_url ?? '').trim();
  if (avatar_urlT.length > 500)                        return res.status(400).json({ error: 'URL avatar trop longue (max 500).' });
  if (avatar_urlT && !avatar_urlT.startsWith('https://')) return res.status(400).json({ error: 'URL avatar invalide.' });
  const VALID_CATEGORIES = ['anime', 'fantasy', 'sci-fi', 'historique', 'original', 'autre'];
  const styleT     = String(style ?? '').trim();
  const is_publicB = is_public === true || is_public === 'true';
  const categoryT  = VALID_CATEGORIES.includes(String(category ?? '').trim())
                       ? String(category).trim()
                       : 'autre';
  if (styleT.length > 1000) return res.status(400).json({ error: 'Style trop long (max 1000).' });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('username')
    .eq('id', req.user.id)
    .single();

  const { data, error } = await getUserClient(req)
    .from('characters')
    .insert({ creator_id: req.user.id, creator_username: profile?.username ?? '', name: name.trim(), personality: personalityT, tone: toneT, lore: loreT, avatar_url: avatar_urlT, style: styleT, is_public: is_publicB, category: categoryT })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── PUT /api/characters/:id ─────────────────────────────────
app.put('/api/characters/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, personality = '', tone = '', lore = '', avatar_url = '',
          style = '', is_public = false, category = 'autre' } = req.body;
  if (!name?.trim())               return res.status(400).json({ error: 'Le nom est requis.' });
  if (name.trim().length > 100)    return res.status(400).json({ error: 'Nom trop long (max 100).' });

  const personalityT = String(personality ?? '').trim();
  const toneT        = String(tone ?? '').trim();
  const loreT        = String(lore ?? '').trim();

  if (personalityT.length > 1000)  return res.status(400).json({ error: 'Personnalité trop longue (max 1000).' });
  if (toneT.length > 1000)         return res.status(400).json({ error: 'Ton trop long (max 1000).' });
  if (loreT.length > 2000)         return res.status(400).json({ error: 'Lore trop long (max 2000).' });
  const avatar_urlT = String(avatar_url ?? '').trim();
  if (avatar_urlT.length > 500)                           return res.status(400).json({ error: 'URL avatar trop longue (max 500).' });
  if (avatar_urlT && !avatar_urlT.startsWith('https://')) return res.status(400).json({ error: 'URL avatar invalide.' });
  const VALID_CATEGORIES = ['anime', 'fantasy', 'sci-fi', 'historique', 'original', 'autre'];
  const styleT     = String(style ?? '').trim();
  const is_publicB = is_public === true || is_public === 'true';
  const categoryT  = VALID_CATEGORIES.includes(String(category ?? '').trim())
                       ? String(category).trim()
                       : 'autre';
  if (styleT.length > 1000) return res.status(400).json({ error: 'Style trop long (max 1000).' });

  const { data, error } = await getUserClient(req)
    .from('characters')
    .update({ name: name.trim(), personality: personalityT, tone: toneT, lore: loreT, avatar_url: avatar_urlT, style: styleT, is_public: is_publicB, category: categoryT })
    .eq('id', id)
    .eq('creator_id', req.user.id)
    .select()
    .single();
  if (error && error.code === 'PGRST116') return res.status(404).json({ error: 'Personnage introuvable.' });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/characters/:id ──────────────────────────────
app.delete('/api/characters/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await getUserClient(req)
    .from('characters')
    .delete()
    .eq('id', id)
    .eq('creator_id', req.user.id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Personnage introuvable.' });
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`NO-SIGNAL backend v2 running on port ${PORT}`));

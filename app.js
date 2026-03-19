// ── Config ─────────────────────────────────────────────────
// In development: backend runs on localhost:3000
// In production: set this to your deployed backend URL (Railway, Render, etc.)
const BACKEND_URL = 'http://localhost:3000';

// ── State ──────────────────────────────────────────────────
const state = {
  character: null,   // { name, personality, tone, lore }
  sessions: [],      // [{ id, name, messages: [] }]
  activeSession: null,
  isWaiting: false,
};

// ── Persistence (localStorage) ─────────────────────────────
function save() {
  localStorage.setItem('nosignal', JSON.stringify({
    character: state.character,
    sessions:  state.sessions,
    activeSession: state.activeSession,
  }));
}

function load() {
  const raw = localStorage.getItem('nosignal');
  if (!raw) return;
  const data = JSON.parse(raw);
  state.character     = data.character     ?? null;
  state.sessions      = data.sessions      ?? [];
  state.activeSession = data.activeSession ?? null;
}

// ── DOM refs ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  characterName:   $('character-name'),
  characterStatus: $('character-status'),
  characterAvatar: $('character-avatar'),
  sessionList:     $('session-list'),
  messages:        $('messages'),
  chatTitle:       $('chat-title'),
  userInput:       $('user-input'),
  btnSend:         $('btn-send'),
  emptyState:      $('empty-state'),

  // modals
  modalCharacter:  $('modal-character'),
  modalMemory:     $('modal-memory'),
  charName:        $('char-name'),
  charPersonality: $('char-personality'),
  charTone:        $('char-tone'),
  charLore:        $('char-lore'),
  memoryShort:     $('memory-short'),
  memoryLong:      $('memory-long'),
};

// ── Rendering ──────────────────────────────────────────────
function renderCharacter() {
  if (state.character) {
    els.characterName.textContent   = state.character.name;
    els.characterStatus.textContent = state.character.personality;
    els.characterAvatar.textContent = state.character.name[0].toUpperCase();
  } else {
    els.characterName.textContent   = 'No character';
    els.characterStatus.textContent = 'Select or create one';
    els.characterAvatar.textContent = '?';
  }
}

function renderSessions() {
  els.sessionList.innerHTML = '';
  state.sessions.forEach(session => {
    const li = document.createElement('li');
    li.textContent = session.name;
    li.dataset.id  = session.id;
    if (session.id === state.activeSession) li.classList.add('active');
    li.addEventListener('click', () => activateSession(session.id));
    els.sessionList.appendChild(li);
  });
}

function renderMessages() {
  const session = getCurrentSession();
  els.messages.innerHTML = '';

  if (!session || session.messages.length === 0) {
    els.messages.appendChild(els.emptyState);
    els.emptyState.classList.remove('hidden');
    return;
  }

  session.messages.forEach(msg => appendMessage(msg.role, msg.content, false));
  els.messages.scrollTop = els.messages.scrollHeight;
}

function appendMessage(role, content, scroll = true) {
  // Remove empty state if present
  const empty = els.messages.querySelector('#empty-state');
  if (empty) empty.remove();

  const senderLabel = role === 'user'
    ? 'You'
    : (state.character?.name ?? 'AI');

  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `
    <span class="message-sender">${senderLabel}</span>
    <div class="message-bubble">${escapeHtml(content)}</div>
  `;
  els.messages.appendChild(div);

  if (scroll) els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function showTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'message assistant typing-indicator';
  div.id = 'typing';
  div.innerHTML = `
    <span class="message-sender">${state.character?.name ?? 'AI'}</span>
    <div class="message-bubble">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function removeTypingIndicator() {
  $('typing')?.remove();
}

function setInputEnabled(enabled) {
  els.userInput.disabled = !enabled;
  els.btnSend.disabled   = !enabled;
}

// ── Session logic ──────────────────────────────────────────
function getCurrentSession() {
  return state.sessions.find(s => s.id === state.activeSession) ?? null;
}

function activateSession(id) {
  state.activeSession = id;
  const session = getCurrentSession();
  els.chatTitle.textContent = session?.name ?? 'Session';
  renderSessions();
  renderMessages();
  setInputEnabled(!!session && !state.isWaiting);
  save();
}

function createSession() {
  const id   = crypto.randomUUID();
  const name = `Session ${state.sessions.length + 1}`;
  state.sessions.push({ id, name, messages: [] });
  save();
  renderSessions();
  activateSession(id);
}

// ── Character logic ────────────────────────────────────────
function openCharacterModal() {
  if (state.character) {
    els.charName.value        = state.character.name;
    els.charPersonality.value = state.character.personality;
    els.charTone.value        = state.character.tone;
    els.charLore.value        = state.character.lore;
  } else {
    els.charName.value = els.charPersonality.value = els.charTone.value = els.charLore.value = '';
  }
  els.modalCharacter.classList.remove('hidden');
  els.charName.focus();
}

function saveCharacter() {
  const name = els.charName.value.trim();
  if (!name) { els.charName.focus(); return; }

  state.character = {
    name,
    personality: els.charPersonality.value.trim(),
    tone:        els.charTone.value.trim(),
    lore:        els.charLore.value.trim(),
  };
  els.modalCharacter.classList.add('hidden');
  renderCharacter();
  save();
}

// ── Memory viewer ──────────────────────────────────────────
function openMemoryModal() {
  const session = getCurrentSession();
  if (!session) return;

  const recent = session.messages.slice(-6);
  els.memoryShort.textContent = recent.length
    ? recent.map(m => `[${m.role}] ${m.content}`).join('\n\n')
    : 'No messages yet.';

  els.memoryLong.textContent = session.summary ?? 'No summary yet.';
  els.modalMemory.classList.remove('hidden');
}

// ── AI call ────────────────────────────────────────────────
async function sendMessage() {
  if (state.isWaiting) return;

  const content = els.userInput.value.trim();
  if (!content) return;

  const session = getCurrentSession();
  if (!session) return;

  // Add user message
  session.messages.push({ role: 'user', content });
  appendMessage('user', content);
  els.userInput.value = '';
  autoResize();

  state.isWaiting = true;
  setInputEnabled(false);
  showTypingIndicator();
  save();

  try {
    const reply = await callAI(session);
    session.messages.push({ role: 'assistant', content: reply });
    removeTypingIndicator();
    appendMessage('assistant', reply);
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `⚠️ Error: ${err.message}`);
  }

  state.isWaiting = false;
  setInputEnabled(true);
  els.userInput.focus();
  save();
}

/**
 * Calls the backend /chat endpoint.
 * Falls back to a placeholder response when the backend is not yet available.
 */
async function callAI(session) {
  const payload = {
    character: state.character,
    messages:  session.messages,
    summary:   session.summary ?? null,
  };

  try {
    const res = await fetch(`${BACKEND_URL}/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    return data.reply;
  } catch {
    // Backend not ready yet — return a placeholder so the UI is testable
    await sleep(900);
    const char = state.character?.name ?? 'AI';
    return `[${char} — backend not connected yet. Implement /chat to enable real responses.]`;
  }
}

// ── Utilities ──────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function autoResize() {
  els.userInput.style.height = 'auto';
  els.userInput.style.height = Math.min(els.userInput.scrollHeight, 140) + 'px';
}

// ── Event listeners ────────────────────────────────────────
function initEvents() {
  // Send on button click or Enter (Shift+Enter = newline)
  els.btnSend.addEventListener('click', sendMessage);
  els.userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  els.userInput.addEventListener('input', autoResize);

  // Sidebar
  $('btn-new-session').addEventListener('click', createSession);
  $('btn-new-character').addEventListener('click', openCharacterModal);

  // Header
  $('btn-memory').addEventListener('click', openMemoryModal);
  $('btn-settings').addEventListener('click', () => {
    alert('Settings panel — coming soon.');
  });

  // Character modal
  $('btn-save-character').addEventListener('click', saveCharacter);
  $('btn-cancel-character').addEventListener('click', () => {
    els.modalCharacter.classList.add('hidden');
  });

  // Memory modal
  $('btn-close-memory').addEventListener('click', () => {
    els.modalMemory.classList.add('hidden');
  });

  // Close modals on backdrop click
  [els.modalCharacter, els.modalMemory].forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });
}

// ── Boot ───────────────────────────────────────────────────
function init() {
  load();
  renderCharacter();
  renderSessions();

  if (state.activeSession) {
    activateSession(state.activeSession);
  }

  initEvents();
}

init();

// ══════════════════════════════════════════════════════════
// CONFIG & SUPABASE
// ══════════════════════════════════════════════════════════
const BACKEND_URL = '';
let sb = null; // Supabase client

// ══════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════
const MODEL_DISPLAY_NAMES = {
  'aurora-70': 'AURORA-70',
  'prism':     'PRISM-8X',
  'swift':     'SWIFT',
  'stellar':   'STELLAR',
};

const TIPS = [
  "Ajoutez un lore détaillé à votre personnage pour des réponses plus immersives.",
  "Utilisez votre Persona (Settings) pour que l'IA sache à qui elle parle.",
  "Partagez vos personnages avec la communauté en les rendant publics !",
  "La mémoire long-terme se déclenche automatiquement après 20 messages.",
  "Essayez différents modèles IA dans les paramètres pour varier les styles.",
  "Shift+Entrée pour aller à la ligne sans envoyer le message.",
  "Survolez un message pour l'éditer ou régénérer la réponse.",
];

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
const state = {
  user: null,            // Supabase user object
  profile: null,         // { username, bio, avatar_color, persona_name, persona_desc }
  characters: [],        // user's own characters from Supabase
  community: [],         // public characters from other users
  sessions: [],          // [{ id, name, characterId, messages: [] }] - localStorage
  activeSession: null,
  activeCharacter: null, // the selected character object
  activeTab: 'mine',     // 'mine' | 'discover'
  isWaiting: false,
  allTags: [],           // all unique tags from community characters
  searchQuery: '',       // current community search query
  activeTag: null,       // currently filtered tag
  modelKey: localStorage.getItem('nosignal_model') ?? 'aurora-70',
};

// ══════════════════════════════════════════════════════════
// DOM HELPERS
// ══════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

// ══════════════════════════════════════════════════════════
// SUPABASE INIT
// ══════════════════════════════════════════════════════════
async function initSupabase() {
  const res = await fetch('/api/config');
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  window.sb = sb;
}

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
async function checkAuth() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) {
    window.location.replace('/auth.html');
    return;
  }
  state.user = data.session.user;
}

async function logout() {
  await sb.auth.signOut();
  window.location.replace('/auth.html');
}

// ══════════════════════════════════════════════════════════
// USER PROFILE
// ══════════════════════════════════════════════════════════
async function loadProfile() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', state.user.id)
    .single();

  if (error || !data) {
    // Profile might not exist yet — create a default one
    const defaultProfile = {
      id: state.user.id,
      username: state.user.email.split('@')[0],
      bio: '',
      avatar_color: '#7c6af7',
      persona_name: '',
      persona_desc: '',
    };
    const { data: created, error: createErr } = await sb
      .from('profiles')
      .upsert(defaultProfile)
      .select()
      .single();

    if (createErr) {
      console.error('Failed to create profile:', createErr);
      state.profile = defaultProfile;
    } else {
      state.profile = created;
    }
  } else {
    state.profile = data;
  }
}

async function saveProfile(data) {
  const { error } = await sb
    .from('profiles')
    .upsert({ id: state.user.id, ...data });

  if (error) {
    console.error('Failed to save profile:', error);
    throw error;
  }
  state.profile = { ...state.profile, ...data };
}

// ══════════════════════════════════════════════════════════
// CHARACTERS (Supabase)
// ══════════════════════════════════════════════════════════
// Supabase SQL: ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS avatar_emoji text default '';
async function loadMyCharacters() {
  const { data, error } = await sb
    .from('characters')
    .select('*')
    .eq('creator_id', state.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load characters:', error);
    return;
  }
  state.characters = data ?? [];
}

async function createCharacter(data) {
  const { data: inserted, error } = await sb
    .from('characters')
    .insert({
      ...data,
      creator_id: state.user.id,
      creator_username: state.profile?.username ?? '',
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create character:', error);
    throw error;
  }
  return inserted;
}

async function updateCharacter(id, data) {
  const { error } = await sb
    .from('characters')
    .update(data)
    .eq('id', id)
    .eq('creator_id', state.user.id);

  if (error) {
    console.error('Failed to update character:', error);
    throw error;
  }
}

async function deleteCharacter(id) {
  const { error } = await sb
    .from('characters')
    .delete()
    .eq('id', id)
    .eq('creator_id', state.user.id);

  if (error) {
    console.error('Failed to delete character:', error);
    throw error;
  }
  state.characters = state.characters.filter(c => c.id !== id);

  // Deselect if this was the active character
  if (state.activeCharacter?.id === id) {
    state.activeCharacter = null;
    renderActiveCharacter();
  }
}

async function togglePublic(id, isPublic) {
  const { error } = await sb
    .from('characters')
    .update({ is_public: isPublic })
    .eq('id', id)
    .eq('creator_id', state.user.id);

  if (error) {
    console.error('Failed to toggle public:', error);
    throw error;
  }
  const char = state.characters.find(c => c.id === id);
  if (char) char.is_public = isPublic;
}

// ══════════════════════════════════════════════════════════
// COMMUNITY
// ══════════════════════════════════════════════════════════
async function loadCommunity() {
  const { data, error } = await sb
    .from('characters')
    .select('*')
    .eq('is_public', true)
    .neq('creator_id', state.user.id)
    .order('interactions', { ascending: false });

  if (error) {
    console.error('Failed to load community:', error);
    return;
  }
  state.community = data ?? [];

  // Extract unique tags from all public characters
  const tagCounts = {};
  state.community.forEach(char => {
    const tags = Array.isArray(char.tags) ? char.tags : [];
    tags.forEach(tag => {
      if (tag) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    });
  });
  // Sort by frequency descending
  state.allTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

async function incrementInteractions(id) {
  await sb.rpc('increment_interactions', { char_id: id }).catch(err => {
    console.error('Failed to increment interactions:', err);
  });
}

// ══════════════════════════════════════════════════════════
// PERSISTENCE (localStorage for sessions)
// ══════════════════════════════════════════════════════════
function saveSessions() {
  localStorage.setItem('nosignal_sessions', JSON.stringify({
    sessions:      state.sessions,
    activeSession: state.activeSession,
  }));
}

function loadSessions() {
  const raw = localStorage.getItem('nosignal_sessions');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    state.sessions      = data.sessions      ?? [];
    state.activeSession = data.activeSession ?? null;
  } catch (e) {
    console.error('Failed to parse sessions:', e);
  }
}

// ══════════════════════════════════════════════════════════
// SESSIONS
// ══════════════════════════════════════════════════════════
function getCurrentSession() {
  return state.sessions.find(s => s.id === state.activeSession) ?? null;
}

function createSession(character) {
  const id   = crypto.randomUUID();
  const name = `${character.name} — Session ${state.sessions.length + 1}`;
  state.sessions.push({ id, name, characterId: character.id, messages: [] });
  saveSessions();
  renderSessions();
  activateSession(id);
}

function activateSession(id) {
  state.activeSession = id;
  const session = getCurrentSession();
  $('chat-title').textContent = session?.name ?? 'Session';

  // Restore the character for this session
  if (session) {
    const charId = session.characterId;
    const char = [...state.characters, ...state.community].find(c => c.id === charId) ?? null;
    state.activeCharacter = char;
    renderActiveCharacter();
  }

  renderSessions();
  renderMessages();
  setInputEnabled(!!session && !state.isWaiting);
  saveSessions();
}

// ══════════════════════════════════════════════════════════
// CHAT / AI
// ══════════════════════════════════════════════════════════
async function sendMessage() {
  if (state.isWaiting) return;

  const content = $('user-input').value.trim();
  if (!content) return;

  const session = getCurrentSession();
  if (!session) return;

  // Add user message
  session.messages.push({ role: 'user', content });
  const userMsgIndex = session.messages.length - 1;
  appendMessage('user', content, true, userMsgIndex);
  $('user-input').value = '';
  autoResize();

  state.isWaiting = true;
  setInputEnabled(false);
  showTypingIndicator();
  saveSessions();

  try {
    const { data: { session: authSession } } = await sb.auth.getSession();
    const token = authSession?.access_token;
    const reply = await callAI(session, token);
    session.messages.push({ role: 'assistant', content: reply });
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `Error: ${err.message}`, true, session.messages.length);
  }

  state.isWaiting = false;
  setInputEnabled(true);
  $('user-input').focus();
  saveSessions();
}

async function callAI(session, token) {
  const payload = {
    character:   state.activeCharacter,
    messages:    session.messages,
    summary:     session.summary ?? null,
    userPersona: {
      name: state.profile?.persona_name ?? '',
      desc: state.profile?.persona_desc ?? '',
    },
    modelKey: state.modelKey,
  };

  const res = await fetch(`${BACKEND_URL}/chat`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error ?? `Server error ${res.status}`);
  }

  // Streaming: remove typing indicator, create empty assistant bubble
  removeTypingIndicator();
  const streamMsgIndex = session.messages.length; // will be pushed after stream
  const msgDiv = appendStreamMessage(streamMsgIndex);
  const bubble = msgDiv.querySelector('.message-bubble');
  const messagesEl = $('messages');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let pendingEventLine = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          pendingEventLine = null;
          continue;
        }

        // Check for summary event
        if (trimmed.startsWith('event: summary')) {
          pendingEventLine = 'summary';
          continue;
        }

        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);

          // Handle summary data
          if (pendingEventLine === 'summary') {
            pendingEventLine = null;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.summary) {
                session.summary = parsed.summary;
                // Trim messages to last 10
                session.messages = session.messages.slice(-10);
              }
            } catch (e) {
              console.error('Failed to parse summary event:', e);
            }
            continue;
          }

          pendingEventLine = null;

          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              bubble.textContent = fullContent;
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          } catch (e) {
            // Skip malformed JSON chunks
          }
        }
      }
    }
  } catch (err) {
    console.error('Stream read error:', err);
  }

  return fullContent;
}

// Creates an empty assistant message div for streaming into
function appendStreamMessage(msgIndex) {
  const messagesEl = $('messages');

  const empty = messagesEl.querySelector('#empty-state');
  if (empty) empty.remove();

  const avatarEmoji = state.activeCharacter?.avatar_emoji;
  const charName = state.activeCharacter?.name ?? 'AI';
  const senderLabel = avatarEmoji ? `${avatarEmoji} ${charName}` : charName;

  const div = document.createElement('div');
  div.className = 'message assistant';
  if (msgIndex !== undefined) div.dataset.msgIndex = msgIndex;
  div.innerHTML = `
    <span class="message-sender">${escapeHtml(senderLabel)}</span>
    <div class="message-bubble-wrapper">
      <div class="message-bubble"></div>
      <div class="message-actions">
        <button class="btn-msg-edit btn-icon" title="Edit">✏</button>
      </div>
    </div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Enable editing once content is available (after stream)
  enableMessageEditing(div, 'assistant', msgIndex);

  return div;
}

// ══════════════════════════════════════════════════════════
// MESSAGE EDITING
// ══════════════════════════════════════════════════════════
function enableMessageEditing(div, _role, msgIndex) {
  const editBtn = div.querySelector('.btn-msg-edit');
  const regenBtn = div.querySelector('.btn-msg-regen');

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      const session = getCurrentSession();
      if (!session) return;

      const wrapper = div.querySelector('.message-bubble-wrapper');
      const bubble = div.querySelector('.message-bubble');
      const currentContent = session.messages[msgIndex]?.content ?? bubble.textContent ?? '';

      // Replace bubble with textarea
      const textarea = document.createElement('textarea');
      textarea.className = 'msg-edit-textarea';
      textarea.value = currentContent;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'msg-edit-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn-primary';
      saveBtn.textContent = 'Save';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-secondary';
      cancelBtn.style.width = 'auto';
      cancelBtn.textContent = 'Cancel';

      actionsDiv.appendChild(cancelBtn);
      actionsDiv.appendChild(saveBtn);

      bubble.replaceWith(textarea);
      // Hide original message-actions while editing
      const msgActions = wrapper.querySelector('.message-actions');
      if (msgActions) msgActions.style.display = 'none';
      wrapper.appendChild(actionsDiv);
      textarea.focus();
      textarea.select();

      cancelBtn.addEventListener('click', () => {
        const newBubble = document.createElement('div');
        newBubble.className = 'message-bubble';
        newBubble.textContent = currentContent;
        textarea.replaceWith(newBubble);
        actionsDiv.remove();
        if (msgActions) msgActions.style.display = '';
      });

      saveBtn.addEventListener('click', () => {
        const newContent = textarea.value.trim();
        if (!newContent) return;

        if (session.messages[msgIndex]) {
          session.messages[msgIndex].content = newContent;
        }
        saveSessions();
        renderMessages();
      });
    });
  }

  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      const session = getCurrentSession();
      if (!session) return;
      if (state.isWaiting) return;

      const wrapper = div.querySelector('.message-bubble-wrapper');
      const bubble = div.querySelector('.message-bubble');
      const currentContent = session.messages[msgIndex]?.content ?? bubble.textContent ?? '';

      // Get edited content from textarea if in edit mode, otherwise use current
      const textarea = wrapper.querySelector('.msg-edit-textarea');
      const editedContent = textarea ? textarea.value.trim() : currentContent;
      if (!editedContent) return;

      // Update the message content and trim everything after this user message
      if (session.messages[msgIndex]) {
        session.messages[msgIndex].content = editedContent;
      }
      session.messages = session.messages.slice(0, msgIndex + 1);
      saveSessions();

      // Re-render messages up to this point
      renderMessages();

      // Trigger AI response
      state.isWaiting = true;
      setInputEnabled(false);
      showTypingIndicator();

      try {
        const { data: { session: authSession } } = await sb.auth.getSession();
        const token = authSession?.access_token;
        const reply = await callAI(session, token);
        session.messages.push({ role: 'assistant', content: reply });
      } catch (err) {
        removeTypingIndicator();
        appendMessage('assistant', `Error: ${err.message}`, true, session.messages.length);
      }

      state.isWaiting = false;
      setInputEnabled(true);
      $('user-input').focus();
      saveSessions();
    });
  }
}

// ══════════════════════════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════════════════════════
function openSettings() {
  const profile = state.profile ?? {};

  $('settings-username').value     = profile.username     ?? '';
  $('settings-bio').value          = profile.bio          ?? '';
  $('settings-persona-name').value = profile.persona_name ?? '';
  $('settings-persona-desc').value = profile.persona_desc ?? '';

  // Mark active color swatch
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.classList.toggle('selected', swatch.dataset.color === (profile.avatar_color ?? '#7c6af7'));
  });

  // Set the correct model radio button
  const modelRadio = document.querySelector(`input[name="model-select"][value="${state.modelKey}"]`);
  if (modelRadio) modelRadio.checked = true;

  // Reset to profile tab
  switchSettingsTab('profile');
  $('modal-settings').classList.remove('hidden');
}

async function saveSettings() {
  const username     = $('settings-username').value.trim();
  const bio          = $('settings-bio').value.trim();
  const persona_name = $('settings-persona-name').value.trim();
  const persona_desc = $('settings-persona-desc').value.trim();

  const selectedSwatch = document.querySelector('.color-swatch.selected');
  const avatar_color = selectedSwatch?.dataset.color ?? state.profile?.avatar_color ?? '#7c6af7';

  // Save model selection
  const selectedModel = document.querySelector('input[name="model-select"]:checked')?.value;
  if (selectedModel) {
    state.modelKey = selectedModel;
    localStorage.setItem('nosignal_model', selectedModel);
  }

  const btn = $('btn-save-settings');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await saveProfile({ username, bio, avatar_color, persona_name, persona_desc });
    $('modal-settings').classList.add('hidden');
    renderUserBar();
    renderModelBadge();
  } catch (err) {
    console.error('Save settings failed:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.stab === tab);
  });
  document.querySelectorAll('.settings-section').forEach(s => {
    s.classList.toggle('hidden', s.id !== `stab-${tab}`);
  });
}

// ══════════════════════════════════════════════════════════
// MODEL BADGE
// ══════════════════════════════════════════════════════════
function renderModelBadge() {
  const badge = $('model-badge-header');
  if (!badge) return;
  const displayName = MODEL_DISPLAY_NAMES[state.modelKey] ?? state.modelKey.toUpperCase();
  badge.id = 'model-badge-header';
  badge.textContent = displayName;
}

// ══════════════════════════════════════════════════════════
// WELCOME MODAL + GREETING
// ══════════════════════════════════════════════════════════
function showWelcomeIfNeeded() {
  if (localStorage.getItem('nosignal_welcomed')) return;

  const welcomeTitle = $('welcome-title');
  if (welcomeTitle) {
    welcomeTitle.textContent = `Bienvenue, ${state.profile?.username ?? 'ami'} !`;
  }

  $('modal-welcome').classList.remove('hidden');

  $('btn-welcome-ok').addEventListener('click', () => {
    localStorage.setItem('nosignal_welcomed', '1');
    $('modal-welcome').classList.add('hidden');
  });
}

function renderGreeting() {
  const greetingEl = $('greeting-text');
  if (greetingEl) {
    greetingEl.textContent = `Bonjour, ${state.profile?.username ?? 'ami'} 👋`;
  }

  const tipEl = $('tip-text');
  if (tipEl) {
    const randomTip = TIPS[Math.floor(Math.random() * TIPS.length)];
    tipEl.textContent = randomTip;
  }
}

// ══════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════
function renderUserBar() {
  const profile = state.profile;
  const initial = (profile?.username ?? state.user?.email ?? '?')[0].toUpperCase();
  const color   = profile?.avatar_color ?? '#7c6af7';

  const avatar = $('user-avatar-small');
  avatar.textContent = initial;
  avatar.style.background = color;

  $('user-username').textContent   = profile?.username ?? 'User';
  $('user-email-small').textContent = state.user?.email ?? '';
}

function renderCharacterList() {
  const container = $('my-chars-list');
  container.innerHTML = '';

  if (state.characters.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = 'No characters yet.';
    container.appendChild(empty);
    return;
  }

  state.characters.forEach(char => {
    const avatarContent = char.avatar_emoji ? char.avatar_emoji : char.name[0].toUpperCase();
    const card = document.createElement('div');
    card.className = 'char-card' + (state.activeCharacter?.id === char.id ? ' active' : '');
    card.innerHTML = `
      <div class="char-card-avatar" style="background:${state.profile?.avatar_color ?? '#7c6af7'}">${escapeHtml(avatarContent)}</div>
      <div class="char-card-body">
        <span class="char-card-name">${escapeHtml(char.name)}</span>
        <span class="char-card-sub">${escapeHtml(char.personality ?? '')}</span>
      </div>
      <div class="char-actions">
        <button class="btn-icon char-btn-public" title="${char.is_public ? 'Make private' : 'Make public'}">${char.is_public ? '🌐' : '🔒'}</button>
        <button class="btn-icon char-btn-edit" title="Edit">✏</button>
        <button class="btn-icon char-btn-delete" title="Delete">✕</button>
      </div>
    `;

    // Select character (click on card body)
    card.querySelector('.char-card-body').addEventListener('click', () => {
      state.activeCharacter = char;
      renderActiveCharacter();
      renderCharacterList();
    });

    // Toggle public
    card.querySelector('.char-btn-public').addEventListener('click', async e => {
      e.stopPropagation();
      const newVal = !char.is_public;
      try {
        await togglePublic(char.id, newVal);
        renderCharacterList();
      } catch (err) {
        console.error(err);
      }
    });

    // Edit
    card.querySelector('.char-btn-edit').addEventListener('click', e => {
      e.stopPropagation();
      openCharacterModal(char);
    });

    // Delete
    card.querySelector('.char-btn-delete').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete "${char.name}"?`)) return;
      try {
        await deleteCharacter(char.id);
        renderCharacterList();
      } catch (err) {
        console.error(err);
      }
    });

    container.appendChild(card);
  });
}

// ── Feature 5: filter community by search + tag ────────────
function filterCommunity() {
  let list = state.community;

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q));
  }

  if (state.activeTag) {
    list = list.filter(c => Array.isArray(c.tags) && c.tags.includes(state.activeTag));
  }

  return list;
}

function renderCommunity() {
  const container = $('community-list');
  container.innerHTML = '';

  // Render tag filter chips (top 10 most common tags)
  const tagFilters = $('tag-filters');
  tagFilters.innerHTML = '';
  const topTags = state.allTags.slice(0, 10);
  topTags.forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'tag-chip' + (state.activeTag === tag ? ' active' : '');
    chip.dataset.tag = tag;
    chip.textContent = tag;
    tagFilters.appendChild(chip);
  });

  const filtered = filterCommunity();

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = state.searchQuery || state.activeTag
      ? 'No results.'
      : 'No community characters yet.';
    container.appendChild(empty);
    return;
  }

  filtered.forEach(char => {
    const tags = Array.isArray(char.tags) ? char.tags.filter(Boolean) : [];
    const tagsHtml = tags.length
      ? `<div class="char-tags">${tags.map(t => `<span class="char-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    const avatarContent = char.avatar_emoji ? char.avatar_emoji : char.name[0].toUpperCase();
    const card = document.createElement('div');
    card.className = 'community-card' + (state.activeCharacter?.id === char.id ? ' active' : '');
    card.innerHTML = `
      <div class="char-card-avatar" style="background:#5ab4e0">${escapeHtml(avatarContent)}</div>
      <div class="char-card-body">
        <span class="char-card-name">${escapeHtml(char.name)}</span>
        <span class="char-card-sub">${escapeHtml(char.personality ?? '')}</span>
        <span class="char-card-creator">by ${escapeHtml(char.creator_username ?? 'Unknown')}</span>
        ${tagsHtml}
      </div>
    `;

    card.addEventListener('click', async () => {
      state.activeCharacter = char;
      renderActiveCharacter();
      renderCommunity();
      await incrementInteractions(char.id);
    });

    container.appendChild(card);
  });
}

// ── Feature 4: render sessions with rename/delete ──────────
function renderSessions() {
  const list = $('session-list');
  list.innerHTML = '';

  state.sessions.forEach(session => {
    const li = document.createElement('li');
    li.dataset.id = session.id;
    if (session.id === state.activeSession) li.classList.add('active');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'session-name';
    nameSpan.textContent = session.name;
    nameSpan.title = session.name;
    nameSpan.addEventListener('click', () => activateSession(session.id));

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-icon';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✏';
    renameBtn.addEventListener('click', e => {
      e.stopPropagation();
      const newName = prompt('Rename session:', session.name);
      if (newName && newName.trim()) {
        session.name = newName.trim();
        if (state.activeSession === session.id) {
          $('chat-title').textContent = session.name;
        }
        saveSessions();
        renderSessions();
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`Delete session "${session.name}"?`)) return;
      const wasActive = state.activeSession === session.id;
      state.sessions = state.sessions.filter(s => s.id !== session.id);
      if (wasActive) {
        state.activeSession = null;
        $('chat-title').textContent = 'Select a session';
        renderMessages();
        setInputEnabled(false);
      }
      saveSessions();
      renderSessions();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(nameSpan);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

function renderMessages() {
  const session = getCurrentSession();
  const messagesEl = $('messages');
  messagesEl.innerHTML = '';

  if (!session || session.messages.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.id = 'empty-state';
    emptyState.innerHTML = `
      <p id="greeting-text" class="greeting"></p>
      <p class="empty-icon">◈</p>
      <p class="empty-subtitle">Sélectionnez un personnage et démarrez une session.</p>
      <div id="tips-container">
        <p class="tip-label">💡 Le saviez-vous ?</p>
        <p id="tip-text" class="tip-text"></p>
      </div>
    `;
    messagesEl.appendChild(emptyState);
    renderGreeting();
    return;
  }

  session.messages.forEach((msg, index) => appendMessage(msg.role, msg.content, false, index));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderActiveCharacter() {
  const char = state.activeCharacter;
  if (char) {
    $('character-name').textContent   = char.name;
    $('character-status').textContent = char.personality ?? '';
    // Show emoji avatar if available, otherwise first letter
    if (char.avatar_emoji) {
      $('character-avatar').textContent = char.avatar_emoji;
    } else {
      $('character-avatar').textContent = char.name[0].toUpperCase();
    }
  } else {
    $('character-name').textContent   = 'No character';
    $('character-status').textContent = 'Select or create one';
    $('character-avatar').textContent = '?';
  }
}

function appendMessage(role, content, scroll = true, msgIndex) {
  const messagesEl = $('messages');

  const empty = messagesEl.querySelector('#empty-state');
  if (empty) empty.remove();

  const isUser = role === 'user';
  const avatarEmoji = state.activeCharacter?.avatar_emoji;
  const charName = state.activeCharacter?.name ?? 'AI';

  const senderLabel = isUser
    ? (state.profile?.persona_name || 'You')
    : (avatarEmoji ? `${avatarEmoji} ${charName}` : charName);

  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (msgIndex !== undefined) div.dataset.msgIndex = msgIndex;

  div.innerHTML = `
    <span class="message-sender">${escapeHtml(senderLabel)}</span>
    <div class="message-bubble-wrapper">
      <div class="message-bubble">${escapeHtml(content)}</div>
      <div class="message-actions">
        <button class="btn-msg-edit btn-icon" title="Edit">✏</button>
        ${isUser ? '<button class="btn-msg-regen btn-icon" title="Regenerate from here">↺</button>' : ''}
      </div>
    </div>
  `;
  messagesEl.appendChild(div);

  enableMessageEditing(div, role, msgIndex);

  if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function showTypingIndicator() {
  const messagesEl = $('messages');
  const avatarEmoji = state.activeCharacter?.avatar_emoji;
  const charName = state.activeCharacter?.name ?? 'AI';
  const senderLabel = avatarEmoji ? `${avatarEmoji} ${charName}` : charName;

  const div = document.createElement('div');
  div.className = 'message assistant typing-indicator';
  div.id = 'typing';
  div.innerHTML = `
    <span class="message-sender">${escapeHtml(senderLabel)}</span>
    <div class="message-bubble">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTypingIndicator() {
  $('typing')?.remove();
}

function setInputEnabled(enabled) {
  $('user-input').disabled = !enabled;
  $('btn-send').disabled   = !enabled;
}

// ══════════════════════════════════════════════════════════
// CHARACTER MODAL
// ══════════════════════════════════════════════════════════
// Note: run in Supabase SQL: ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS tags text[] default '{}';
// Note: run in Supabase SQL: ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS avatar_emoji text default '';
function openCharacterModal(existingChar = null) {
  $('modal-character-title').textContent = existingChar ? 'Edit character' : 'Create a character';
  $('char-edit-id').value      = existingChar?.id ?? '';
  $('char-name').value         = existingChar?.name         ?? '';
  $('char-avatar-emoji').value = existingChar?.avatar_emoji ?? '';
  $('char-personality').value  = existingChar?.personality  ?? '';
  $('char-tone').value         = existingChar?.tone         ?? '';
  $('char-lore').value         = existingChar?.lore         ?? '';
  $('char-is-public').checked  = existingChar?.is_public    ?? false;
  $('char-tags').value         = (existingChar?.tags ?? []).join(', ');

  $('modal-character').classList.remove('hidden');
  $('char-name').focus();
}

async function saveCharacterModal() {
  const name = $('char-name').value.trim();
  if (!name) { $('char-name').focus(); return; }

  // Collect tags: split by comma, trim, filter empty
  const tagsRaw = $('char-tags').value;
  const tags = tagsRaw
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);

  const charData = {
    name,
    avatar_emoji: $('char-avatar-emoji').value.trim(),
    personality: $('char-personality').value.trim(),
    tone:        $('char-tone').value.trim(),
    lore:        $('char-lore').value.trim(),
    is_public:   $('char-is-public').checked,
    tags,
  };

  const editId = $('char-edit-id').value;
  const btn = $('btn-save-character');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    if (editId) {
      await updateCharacter(editId, charData);
      const idx = state.characters.findIndex(c => c.id === editId);
      if (idx !== -1) state.characters[idx] = { ...state.characters[idx], ...charData };
      if (state.activeCharacter?.id === editId) {
        state.activeCharacter = state.characters[idx];
        renderActiveCharacter();
      }
    } else {
      const newChar = await createCharacter(charData);
      state.characters.unshift(newChar);
    }

    $('modal-character').classList.add('hidden');
    renderCharacterList();
  } catch (err) {
    console.error('Save character failed:', err);
    alert('Failed to save character. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ══════════════════════════════════════════════════════════
// MEMORY VIEWER
// ══════════════════════════════════════════════════════════
function openMemoryModal() {
  const session = getCurrentSession();
  if (!session) return;

  const recent = session.messages.slice(-6);
  $('memory-short').textContent = recent.length
    ? recent.map(m => `[${m.role}] ${m.content}`).join('\n\n')
    : 'No messages yet.';

  $('memory-long').textContent = session.summary ?? 'No summary yet.';
  $('modal-memory').classList.remove('hidden');
}

// ══════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function autoResize() {
  const el = $('user-input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════
function initEvents() {
  // Send message
  $('btn-send').addEventListener('click', sendMessage);
  $('user-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('user-input').addEventListener('input', autoResize);

  // Sidebar buttons
  $('btn-new-session').addEventListener('click', () => {
    if (!state.activeCharacter) {
      alert('Select a character first before starting a session.');
      return;
    }
    createSession(state.activeCharacter);
  });
  $('btn-new-character').addEventListener('click', () => openCharacterModal());

  // Sidebar tabs
  $('tab-mine').addEventListener('click', () => switchSidebarTab('mine'));
  $('tab-discover').addEventListener('click', () => switchSidebarTab('discover'));

  // Header
  $('btn-memory').addEventListener('click', openMemoryModal);

  // User bar
  $('btn-logout').addEventListener('click', logout);
  $('btn-settings-open').addEventListener('click', openSettings);

  // Character modal
  $('btn-save-character').addEventListener('click', saveCharacterModal);
  $('btn-cancel-character').addEventListener('click', () => {
    $('modal-character').classList.add('hidden');
  });

  // Memory modal
  $('btn-close-memory').addEventListener('click', () => {
    $('modal-memory').classList.add('hidden');
  });

  // Settings modal
  $('btn-cancel-settings').addEventListener('click', () => {
    $('modal-settings').classList.add('hidden');
  });
  $('btn-save-settings').addEventListener('click', saveSettings);

  // Settings tabs
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => switchSettingsTab(tab.dataset.stab));
  });

  // Avatar color swatches
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
  });

  // Close modals on backdrop click
  [$('modal-character'), $('modal-memory'), $('modal-settings'), $('modal-welcome')].forEach(modal => {
    if (!modal) return;
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // Feature 2: Mobile sidebar toggle
  $('btn-menu').addEventListener('click', () => {
    $('sidebar').classList.toggle('open');
    $('sidebar-overlay').classList.toggle('visible');
  });
  $('sidebar-overlay').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('visible');
  });

  // Feature 5: Community search input
  $('search-input').addEventListener('input', e => {
    state.searchQuery = e.target.value.trim();
    renderCommunity();
  });

  // Feature 5: Tag filter chip clicks (event delegation)
  $('tag-filters').addEventListener('click', e => {
    const chip = e.target.closest('.tag-chip');
    if (!chip) return;
    const tag = chip.dataset.tag;
    state.activeTag = state.activeTag === tag ? null : tag;
    renderCommunity();
  });
}

function switchSidebarTab(tab) {
  state.activeTab = tab;
  $('tab-mine').classList.toggle('active', tab === 'mine');
  $('tab-discover').classList.toggle('active', tab === 'discover');
  $('section-mine').classList.toggle('hidden', tab !== 'mine');
  $('section-discover').classList.toggle('hidden', tab !== 'discover');
}

// ══════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════
async function init() {
  await initSupabase();
  await checkAuth();          // redirect to /auth.html if not logged in
  await loadProfile();
  await loadMyCharacters();
  await loadCommunity();
  loadSessions();
  renderUserBar();
  renderCharacterList();
  renderCommunity();
  renderSessions();
  renderActiveCharacter();
  renderModelBadge();
  renderGreeting();
  showWelcomeIfNeeded();

  if (state.activeSession) {
    activateSession(state.activeSession);
  }

  initEvents();
}

init();

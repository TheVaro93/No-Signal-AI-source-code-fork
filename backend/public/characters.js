const BACKEND_URL = (window.NO_SIGNAL_BACKEND_URL || '').replace(/\/$/, '');

let characters        = [];
let editingId         = null;   // null = create mode, string UUID = edit mode
let pendingAvatarPath = null;   // storage path saved to DB (not the signed URL)

// ── Token helper (always await) ──────────────────────────────
async function getToken() {
  const { data } = await window.sb.auth.getSession();
  return data.session?.access_token ?? null;
}

// ── Auth guard ───────────────────────────────────────────────
async function checkAuth() {
  const { data } = await window.sb.auth.getSession();
  if (!data.session) window.location.replace('/auth.html');
}

// ── HTML escape (always use when injecting user data into innerHTML) ──
function escHtml(str) {
  return (str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load characters from API ─────────────────────────────────
async function loadCharacters() {
  const token = await getToken();
  const res = await fetch(`${BACKEND_URL}/api/characters`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Erreur chargement personnages');
  characters = await res.json();
}

// ── Render all cards ─────────────────────────────────────────
// Not async: avatar loading is fire-and-forget via loadAvatar()
function renderCards() {
  const grid  = document.getElementById('chars-grid');
  const empty = document.getElementById('chars-empty');
  grid.innerHTML = '';

  if (characters.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const char of characters) {
    const card = buildCard(char);
    grid.appendChild(card);
    // Load avatar in background — failures fall back silently to ◈
    if (char.avatar_url) loadAvatar(char.avatar_url, card.querySelector('.char-avatar'));
  }
}

function buildCard(char) {
  const card = document.createElement('div');
  card.className = 'char-card';
  card.dataset.id = char.id;

  const preview = (char.personality || '').slice(0, 80) + ((char.personality?.length ?? 0) > 80 ? '…' : '');

  card.innerHTML = `
    <div class="char-card-top">
      <div class="char-avatar">◈</div>
      <div class="char-name">${escHtml(char.name)}</div>
    </div>
    ${preview ? `<div class="char-preview">${escHtml(preview)}</div>` : ''}
    <div class="char-actions">
      <button class="btn-edit">Modifier</button>
      <button class="btn-delete">Supprimer</button>
    </div>
  `;

  card.querySelector('.btn-edit').addEventListener('click',   () => openModal(char));
  card.querySelector('.btn-delete').addEventListener('click', () => deleteCharacter(char.id));
  return card;
}

// ── Load signed avatar URL and update element ─────────────────
async function loadAvatar(path, avatarEl) {
  try {
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/api/uploads/signed?path=${encodeURIComponent(path)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;
    const { url } = await res.json();
    avatarEl.innerHTML = `<img src="${url}" alt="avatar" />`;
  } catch { /* silent fallback to ◈ */ }
}

// ── Reload after create/edit/delete ──────────────────────────
async function reload() {
  await loadCharacters();
  renderCards();
}

// ── Modal helpers ─────────────────────────────────────────────
function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function resetModal() {
  document.getElementById('field-name').value        = '';
  document.getElementById('field-personality').value = '';
  document.getElementById('field-tone').value        = '';
  document.getElementById('field-lore').value        = '';
  document.getElementById('avatar-preview').innerHTML = '◈';
  document.getElementById('upload-error').style.display = 'none';
  showModalError('');
  pendingAvatarPath = null;
  editingId = null;
}

function openModal(char = null) {
  resetModal();
  if (char) {
    editingId = char.id;
    document.getElementById('modal-title').textContent        = 'Modifier le personnage';
    document.getElementById('field-name').value               = char.name ?? '';
    document.getElementById('field-personality').value        = char.personality ?? '';
    document.getElementById('field-tone').value               = char.tone ?? '';
    document.getElementById('field-lore').value               = char.lore ?? '';
    if (char.avatar_url) {
      pendingAvatarPath = char.avatar_url;
      // Refresh signed URL for preview — avatar_url in DB is a path, not a URL
      loadAvatar(char.avatar_url, document.getElementById('avatar-preview'));
    }
  } else {
    document.getElementById('modal-title').textContent = 'Nouveau personnage';
  }
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('field-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  resetModal();
}

async function saveCharacter(e) {
  e.preventDefault();  // form submit event

  const name        = document.getElementById('field-name').value.trim();
  const personality = document.getElementById('field-personality').value;
  const tone        = document.getElementById('field-tone').value;
  const lore        = document.getElementById('field-lore').value;

  if (!name) { showModalError('Le nom est requis.'); return; }

  const btn = document.getElementById('btn-modal-save');
  btn.disabled = true;
  btn.textContent = 'Sauvegarde…';
  showModalError('');

  try {
    const token  = await getToken();
    const body   = { name, personality, tone, lore, avatar_url: pendingAvatarPath ?? '' };
    const url    = editingId
      ? `${BACKEND_URL}/api/characters/${editingId}`
      : `${BACKEND_URL}/api/characters`;
    const method = editingId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const { error } = await res.json();
      showModalError(error ?? 'Erreur serveur.');
      return;
    }

    closeModal();
    await reload();
  } catch (err) {
    showModalError('Erreur réseau.');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sauvegarder';
  }
}

// ── Delete ────────────────────────────────────────────────────
async function deleteCharacter(id) {
  if (!confirm('Supprimer ce personnage ? Cette action est irréversible.')) return;
  try {
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/api/characters/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      const { error } = await res.json();
      alert(error ?? 'Erreur suppression.');
      return;
    }
    await reload();
  } catch (err) {
    console.error('delete error:', err);
  }
}

// ── Avatar upload ─────────────────────────────────────────────
// Intentional simplification: uses the fresh signed URL returned directly by
// /api/upload for the immediate modal preview (not a second call to /api/uploads/signed).
// Only the path is stored in pendingAvatarPath (and saved to the DB).
async function uploadAvatar(file) {
  const uploadErr = document.getElementById('upload-error');
  uploadErr.style.display = 'none';
  try {
    const token = await getToken();
    const form  = new FormData();
    form.append('file', file);

    const res = await fetch(`${BACKEND_URL}/api/upload`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    form,
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      uploadErr.textContent  = error ?? 'Erreur upload.';
      uploadErr.style.display = 'block';
      return;
    }

    const { path, url } = await res.json();
    pendingAvatarPath = path;  // path stored in DB, not the expiring URL
    document.getElementById('avatar-preview').innerHTML = `<img src="${url}" alt="avatar" />`;
  } catch (err) {
    uploadErr.textContent  = "Erreur réseau lors de l'upload.";
    uploadErr.style.display = 'block';
    console.error('uploadAvatar error:', err);
  }
}

// ── Init all modal interactions ───────────────────────────────
// NOTE: ALL listeners are registered here, including the "+ Nouveau personnage"
// button and the file input. Do NOT wire these at module scope.
function initModal() {
  // Open modal for new character
  document.getElementById('btn-new-char').addEventListener('click', () => openModal());

  // Form submit (save button is type="submit" inside <form id="char-form">)
  document.getElementById('char-form').addEventListener('submit', saveCharacter);

  // Cancel button
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);

  // Close on overlay backdrop click
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Avatar file input — trigger hidden input on button click, upload on file select
  const fileInput = document.getElementById('avatar-file-input');
  document.getElementById('btn-upload-avatar').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) uploadAvatar(file);
    fileInput.value = ''; // reset so same file can be re-selected
  });
}

// ── Boot ─────────────────────────────────────────────────────
async function boot() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/config`);
    const { supabaseUrl, supabaseAnonKey } = await res.json();
    window.sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

    await checkAuth();
    await loadCharacters();
    renderCards();
    initModal();
  } catch (err) {
    console.error('boot error:', err);
  }
}

boot();

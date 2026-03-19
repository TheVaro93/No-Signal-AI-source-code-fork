// ── Supabase Init ───────────────────────────────────────────
async function initSupabase() {
  const res = await fetch('/api/config');
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  window.sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}

// ── Auth callback (email confirmation redirect) ─────────────
async function handleAuthCallback() {
  const hash = window.location.hash;
  if (!hash) return;
  if (!hash.includes('access_token') && !hash.includes('type=signup')) return;

  const { data } = await window.sb.auth.getSession();
  if (data?.session) {
    window.location.replace('/');
  }
}

// ── Session check ───────────────────────────────────────────
async function checkSession() {
  const { data } = await window.sb.auth.getSession();
  if (data?.session) {
    window.location.replace('/');
  }
}

// ── Tab switching ───────────────────────────────────────────
function initTabs() {
  const tabs = document.querySelectorAll('.auth-tab');
  const formLogin    = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      if (tab.dataset.tab === 'login') {
        formLogin.classList.remove('hidden');
        formRegister.classList.add('hidden');
        clearMessages();
      } else {
        formRegister.classList.remove('hidden');
        formLogin.classList.add('hidden');
        clearMessages();
      }
    });
  });
}

// ── Message helpers ─────────────────────────────────────────
function showMessage(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'auth-message ' + type;
}

function clearMessages() {
  ['login-message', 'register-message'].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = '';
    el.className = 'auth-message';
  });
}

// ── Login form ──────────────────────────────────────────────
function initLoginForm() {
  const form = document.getElementById('form-login');
  const btn  = document.getElementById('btn-login-submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearMessages();

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      showMessage('login-message', 'Please fill in all fields.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const { error } = await window.sb.auth.signInWithPassword({ email, password });

    if (error) {
      showMessage('login-message', error.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    } else {
      window.location.replace('/');
    }
  });
}

// ── Register form ───────────────────────────────────────────
function initRegisterForm() {
  const form = document.getElementById('form-register');
  const btn  = document.getElementById('btn-register-submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearMessages();

    const email    = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    if (!email || !password) {
      showMessage('register-message', 'Please fill in all fields.', 'error');
      return;
    }

    if (password.length < 6) {
      showMessage('register-message', 'Password must be at least 6 characters.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';

    const { error } = await window.sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + '/auth.html',
      },
    });

    if (error) {
      showMessage('register-message', error.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Create Account';
    } else {
      showMessage('register-message', 'Account created! Check your email to confirm your address.', 'success');
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });
}

// ── Boot ────────────────────────────────────────────────────
async function boot() {
  try {
    await initSupabase();
    await handleAuthCallback();
    await checkSession();
    initTabs();
    initLoginForm();
    initRegisterForm();
  } catch (err) {
    console.error('Auth boot error:', err);
  }
}

boot();

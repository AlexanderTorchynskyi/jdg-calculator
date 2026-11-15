import './styles.css';
import { FIELDS, validateInputs, calculate, money } from './calculator.js';
import { currentMonth, emptyWorkspace, monthLabel, selectMonth, validMonth } from './workspace.js';
import { createBackend } from './backend.js';

const $ = (id) => document.getElementById(id);
const fieldNames = Object.keys(FIELDS);
let backend;
let workspace = emptyWorkspace();
let month = currentMonth();
let original = {};
let user = null;
let busy = false;
let authBusy = false;
let authMode = 'login';
let generation = 0;
let touched = new Set();
let isSaved = false;
let ready = false;

function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle('error', error);
}

function values() {
  return Object.fromEntries(fieldNames.map((key) => [key, $(key).value]));
}

function normalized(value, field) {
  const result = validateInputs({ ...values(), [field]: value });
  return result.errors[field] ? value.trim() : result.inputs[field];
}

function dirty() {
  const draft = values();
  return fieldNames.some((field) => normalized(draft[field], field) !== normalized(original[field] ?? '', field));
}

function allowDiscard() {
  return !dirty() || window.confirm('You have unsaved changes. Discard them?');
}

function updateControls() {
  const connected = Boolean(backend && user && ready);
  $('save').disabled = busy || !connected;
  $('save').textContent = busy ? 'Please wait…' : 'Save month ↗';
  $('refresh').disabled = busy || !backend || !user;
  for (const id of ['month', 'previous-month', 'next-month', ...fieldNames]) $(id).disabled = busy;
  $('sign-out').disabled = busy || authBusy;
  for (const button of $('history-list').querySelectorAll('button')) button.disabled = busy;
  $('save-state').textContent = dirty() ? 'Unsaved changes' : isSaved ? 'Saved snapshot' : 'Not saved yet';
  $('save-state').classList.toggle('dirty', dirty());
  $('save-hint').textContent = connected
    ? 'Saved securely to your account.'
    : backend && user ? 'Refresh to load your workspace before saving.' : 'Preview only. Sign in to save your month.';
  for (const id of ['auth-submit', 'toggle-auth', 'reset-password', 'back-to-login', 'email', 'password']) {
    $(id).disabled = authBusy;
  }
}

function renderCalculation() {
  const result = validateInputs(values());
  for (const field of fieldNames) {
    const message = touched.has(field) ? result.errors[field] ?? '' : '';
    $(`${field}-error`).textContent = message;
    $(field).setAttribute('aria-invalid', String(Boolean(message)));
  }
  const totals = result.valid ? calculate(result.inputs) : null;
  for (const key of ['brutto', 'netto']) $(key).textContent = totals ? money(totals[key]) : '—';
  for (const key of ['base', 'vat', 'tax', 'accounting', 'card', 'zus']) {
    $(`breakdown-${key}`).textContent = totals ? `${['tax', 'accounting', 'card', 'zus'].includes(key) ? '− ' : ''}${money(totals[key])}` : '—';
  }
  updateControls();
}

function renderHistory() {
  $('history-list').replaceChildren();
  const records = [...workspace.records].sort((a, b) => b.month.localeCompare(a.month));
  $('history-empty').hidden = records.length > 0;
  for (const record of records) {
    const button = document.createElement('button');
    button.className = 'history-item';
    if (record.month === month) button.setAttribute('aria-current', 'date');
    const title = document.createElement('strong');
    title.textContent = monthLabel(record.month);
    const amount = document.createElement('span');
    amount.textContent = `${money(calculate(record).netto)} netto`;
    button.append(title, amount);
    button.addEventListener('click', () => changeMonth(record.month));
    $('history-list').append(button);
  }
}

function applyMonth(nextMonth) {
  const selected = selectMonth(workspace, nextMonth);
  month = nextMonth;
  $('month').value = month;
  original = { ...selected.values };
  isSaved = selected.saved;
  touched = new Set();
  for (const field of fieldNames) $(field).value = selected.values[field];
  renderHistory();
  renderCalculation();
}

async function sync(nextMonth, confirmDiscard = true) {
  if (busy) return;
  if (confirmDiscard && !allowDiscard()) {
    $('month').value = month;
    return;
  }
  if (!backend || !user) {
    applyMonth(nextMonth);
    status('app-status', '');
    return;
  }
  const requestGeneration = generation;
  busy = true;
  status('app-status', 'Loading your workspace…');
  updateControls();
  try {
    const loaded = await backend.load();
    if (requestGeneration !== generation) return;
    workspace = loaded;
    ready = true;
    applyMonth(nextMonth);
    status('app-status', 'Up to date.');
  } catch (error) {
    if (requestGeneration !== generation) return;
    $('month').value = month;
    status('app-status', `Could not load your records: ${error.message} Your current edits have been kept. Use Refresh to retry.`, true);
  } finally {
    if (requestGeneration === generation) {
      busy = false;
      updateControls();
    }
  }
}

async function changeMonth(nextMonth) {
  if (!validMonth(nextMonth)) {
    $('month').value = month;
    status('app-status', 'Select a valid month between 1000 and 9999.', true);
    return;
  }
  if (nextMonth === month) return;
  await sync(nextMonth);
}

function shiftMonth(offset) {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + number - 1 + offset;
  changeMonth(`${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`);
}

function setAuthMode(mode) {
  authMode = mode;
  $('auth-form').reset();
  const recovery = mode === 'recovery';
  const reset = mode === 'reset';
  const signup = mode === 'signup';
  $('auth-title').textContent = recovery ? 'Choose a new password.' : reset ? 'Reset your password.' : signup ? 'Make room for clarity.' : 'Welcome to Monthline.';
  $('auth-description').textContent = recovery ? 'Use a new password of at least 8 characters.' : reset ? 'We will email you a secure password reset link.' : signup ? 'Create your personal workspace for monthly JDG earnings.' : 'Sign in to keep your monthly earnings together, on every device.';
  $('email-field').hidden = recovery;
  $('email').required = !recovery;
  $('password-field').hidden = reset;
  $('password').required = !reset;
  $('password').minLength = signup || recovery ? 8 : 1;
  $('password').autocomplete = signup || recovery ? 'new-password' : 'current-password';
  $('password-label').textContent = recovery ? 'New password' : 'Password';
  $('auth-submit').textContent = recovery ? 'Update password' : reset ? 'Send reset link' : signup ? 'Create account' : 'Sign in';
  $('toggle-auth').textContent = signup ? 'Already registered? Sign in' : 'Create an account';
  $('toggle-auth').hidden = recovery || reset;
  $('reset-password').hidden = recovery || reset;
  $('back-to-login').hidden = !reset && !recovery;
  $('auth-panel').hidden = !backend || Boolean(user && !recovery);
  $('dashboard').hidden = Boolean(backend && (!user || recovery));
  status('auth-status', '');
  updateControls();
}

async function handleSession(event, session) {
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
  if (event === 'PASSWORD_RECOVERY') {
    generation++;
    busy = false;
    ready = false;
    user = session?.user ?? null;
    workspace = emptyWorkspace();
    applyMonth(currentMonth());
    $('account-email').textContent = user?.email ?? '';
    $('sign-out').hidden = !user;
    setAuthMode('recovery');
    return;
  }
  const nextUser = session?.user ?? null;
  if (nextUser && user?.id === nextUser.id) return;
  generation++;
  busy = false;
  ready = false;
  workspace = emptyWorkspace();
  user = nextUser;
  applyMonth(currentMonth());
  $('account-email').textContent = user?.email ?? '';
  $('sign-out').hidden = !user;
  setAuthMode('login');
  status('app-status', '');
  if (user) await sync(month, false);
  else if (event === 'SIGNED_OUT') status('auth-status', 'Signed out. Your saved records are still in your account.');
}

$('calculator-form').addEventListener('input', (event) => {
  if (!fieldNames.includes(event.target.id)) return;
  touched.add(event.target.id);
  status('app-status', '');
  renderCalculation();
});

$('calculator-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  if (!backend || !user || !ready) {
    status('app-status', 'Connect Supabase, sign in, and load your workspace before saving.', true);
    return;
  }
  touched = new Set(fieldNames);
  const result = validateInputs(values());
  renderCalculation();
  if (!result.valid) {
    status('app-status', 'Please correct the highlighted fields.', true);
    $(Object.keys(result.errors)[0]).focus();
    return;
  }
  const requestGeneration = generation;
  busy = true;
  status('app-status', 'Saving your month…');
  updateControls();
  try {
    const saved = await backend.save(month, result.inputs, workspace.revision);
    if (requestGeneration !== generation) return;
    workspace = saved;
    applyMonth(month);
    status('app-status', `${monthLabel(month)} saved. Your other saved months are unchanged.`);
  } catch (error) {
    if (requestGeneration !== generation) return;
    status('app-status', `Save could not be confirmed: ${error.message} Your edits have been kept. Refresh to check the saved version before retrying.`, true);
  } finally {
    if (requestGeneration === generation) {
      busy = false;
      updateControls();
    }
  }
});

$('month').addEventListener('change', () => changeMonth($('month').value));
$('previous-month').addEventListener('click', () => shiftMonth(-1));
$('next-month').addEventListener('click', () => shiftMonth(1));
$('refresh').addEventListener('click', () => sync(month));
window.addEventListener('beforeunload', (event) => {
  if (dirty() || busy) {
    event.preventDefault();
    event.returnValue = '';
  }
});

$('toggle-auth').addEventListener('click', () => setAuthMode(authMode === 'signup' ? 'login' : 'signup'));
$('reset-password').addEventListener('click', () => setAuthMode('reset'));
$('back-to-login').addEventListener('click', async () => {
  if (authMode === 'recovery' && user) {
    $('sign-out').click();
    return;
  }
  setAuthMode('login');
});

$('sign-out').addEventListener('click', async () => {
  if (!backend || busy || authBusy || !allowDiscard()) return;
  authBusy = true;
  updateControls();
  try {
    const { error } = await backend.auth.signOut({ scope: 'local' });
    if (error) throw error;
    await handleSession('SIGNED_OUT', null);
  } catch (error) {
    status(authMode === 'recovery' ? 'auth-status' : 'app-status', `Could not sign out: ${error.message}`, true);
  } finally {
    authBusy = false;
    updateControls();
  }
});

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!backend || authBusy) return;
  const mode = authMode;
  const email = $('email').value.trim();
  const password = $('password').value;
  authBusy = true;
  status('auth-status', 'Please wait…');
  updateControls();
  const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  try {
    if (mode === 'reset') {
      const { error } = await backend.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      status('auth-status', 'If that account exists, a reset link has been sent. Check your email.');
    } else if (mode === 'recovery') {
      const { error } = await backend.auth.updateUser({ password });
      if (error) throw error;
      setAuthMode('login');
      await sync(month, false);
      status('app-status', 'Password updated.');
    } else if (mode === 'signup') {
      const { data, error } = await backend.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      $('password').value = '';
      if (data.session) await handleSession('SIGNED_IN', data.session);
      else status('auth-status', 'Check your email to confirm your account, then sign in. If already registered, use Sign in or Forgot password.');
    } else {
      const { data, error } = await backend.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $('password').value = '';
      await handleSession('SIGNED_IN', data.session);
    }
  } catch (error) {
    status('auth-status', error.message, true);
  } finally {
    authBusy = false;
    updateControls();
  }
});

applyMonth(month);
try {
  backend = createBackend(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
} catch (error) {
  $('setup-message').textContent = `Invalid Supabase configuration: ${error.message} Correct your environment configuration and restart the app. This preview cannot save data.`;
}

if (!backend) {
  $('setup-notice').hidden = false;
  $('dashboard').hidden = false;
  updateControls();
} else {
  setAuthMode('login');
  status('auth-status', 'Checking your session…');
  backend.auth.onAuthStateChange((event, session) => {
    // Supabase callbacks must return before making additional auth/database requests.
    setTimeout(() => {
      handleSession(event, session).catch((error) => {
        status('auth-status', `Could not restore your session: ${error.message}`, true);
      });
    }, 0);
  });
}

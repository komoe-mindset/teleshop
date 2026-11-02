import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { platformConfig, isConfigured } from './config.js';

const $ = id => document.getElementById(id);

let client = null;
let editingId = null;
let currentUser = null;
let isSubmittingProduct = false;
let isConnectingBot = false;

// Notification helper
let noticeTimer = null;
function notify(text, isError = false) {
  const notice = $('notice');
  notice.textContent = text;
  notice.style.borderColor = isError ? '#cf4b4b' : '#7b70c0';
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.textContent = '';
  }, 6000);
}

// Section visibility helper
function showSection(activeId) {
  ['setupNotice', 'auth', 'dashboard'].forEach(id => {
    const el = $(id);
    if (el) el.hidden = (id !== activeId);
  });
}

// Application initialization
function initApp() {
  if (!isConfigured()) {
    showSection('setupNotice');
    $('logout').hidden = true;
    $('userEmail').textContent = '';
    return;
  }

  try {
    client = createClient(platformConfig.supabaseUrl, platformConfig.supabaseAnonKey);
  } catch (err) {
    showSection('setupNotice');
    notify('Failed to initialize Supabase client: ' + err.message, true);
    return;
  }

  // Listen for auth state changes
  client.auth.onAuthStateChange((_event, session) => {
    handleAuthState(session);
  });

  // Check initial session
  client.auth.getSession().then(({ data, error }) => {
    if (error) {
      notify('Authentication check failed: ' + error.message, true);
    }
    handleAuthState(data?.session);
  });
}

async function handleAuthState(session) {
  currentUser = session?.user || null;

  if (!currentUser) {
    $('logout').hidden = true;
    $('userEmail').textContent = '';
    showSection('auth');
    return;
  }

  $('logout').hidden = false;
  $('userEmail').textContent = currentUser.email || 'Merchant';
  showSection('dashboard');

  await Promise.all([loadBotStatus(), loadProducts()]);
}

// -------------------------------------------------------------
// Authentication Event Listeners
// -------------------------------------------------------------

$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;

  if (!email || !password) {
    notify('Please enter both email and password.', true);
    return;
  }

  const signinBtn = $('signinBtn');
  signinBtn.disabled = true;
  signinBtn.textContent = 'Signing in…';

  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (err) {
    notify('Sign in failed: ' + err.message, true);
  } finally {
    signinBtn.disabled = false;
    signinBtn.textContent = 'Sign in';
  }
};

$('signupBtn').onclick = async () => {
  const email = $('email').value.trim();
  const password = $('password').value;

  if (!email || password.length < 6) {
    notify('Please enter a valid email and a password of at least 6 characters.', true);
    return;
  }

  const signupBtn = $('signupBtn');
  signupBtn.disabled = true;
  signupBtn.textContent = 'Creating account…';

  try {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;

    if (data.session) {
      notify('Merchant account created and signed in.');
    } else {
      notify('Account created. If email confirmation is enabled, check your inbox before signing in.');
    }
  } catch (err) {
    notify('Sign up error: ' + err.message, true);
  } finally {
    signupBtn.disabled = false;
    signupBtn.textContent = 'Create merchant account';
  }
};

$('logout').onclick = async () => {
  const { error } = await client.auth.signOut();
  if (error) {
    notify('Sign out error: ' + error.message, true);
  } else {
    resetProductForm();
    notify('Signed out.');
  }
};

// -------------------------------------------------------------
// Telegram Bot Management
// -------------------------------------------------------------

async function loadBotStatus() {
  const statusEl = $('botStatus');
  statusEl.textContent = 'Checking bot connection…';

  try {
    const { data, error } = await client
      .from('bots')
      .select('username, created_at')
      .maybeSingle();

    if (error) throw error;

    if (data) {
      statusEl.innerHTML = `Connected: <strong>@${escapeHtml(data.username)}</strong> (active)`;
    } else {
      statusEl.textContent = 'No bot connected yet.';
    }
  } catch (err) {
    statusEl.textContent = 'Could not load bot connection status.';
    console.error('Error loading bot status:', err);
  }
}

$('botForm').onsubmit = async (e) => {
  e.preventDefault();
  if (isConnectingBot) return;

  const tokenInput = $('token');
  const token = tokenInput.value.trim();

  if (!token) {
    notify('Please enter a bot token.', true);
    return;
  }

  // Telegram bot token format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) {
    notify('Invalid Telegram bot token format. Tokens look like 123456:ABC-DEF...', true);
    return;
  }

  const button = $('connectBotBtn');
  isConnectingBot = true;
  button.disabled = true;
  button.textContent = 'Connecting…';

  try {
    const { data, error } = await client.functions.invoke('connect-bot', {
      body: { token }
    });

    if (error) throw new Error(error.message || 'Function invocation failed');
    if (data?.error) throw new Error(data.error);

    tokenInput.value = '';
    notify(`Bot connected successfully! Send /start to @${data.username} in Telegram.`);
    await loadBotStatus();
  } catch (err) {
    notify('Bot connection failed: ' + err.message, true);
  } finally {
    isConnectingBot = false;
    button.disabled = false;
    button.textContent = 'Connect bot';
  }
};

// -------------------------------------------------------------
// Product Management (CRUD)
// -------------------------------------------------------------

async function loadProducts() {
  const box = $('products');
  const countBadge = $('productCount');
  box.textContent = 'Loading products…';

  try {
    const { data, error } = await client
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    box.replaceChildren();
    countBadge.textContent = `${data.length} product${data.length === 1 ? '' : 's'}`;

    if (!data.length) {
      box.textContent = 'No products found. Add your first physical product using the form above.';
      return;
    }

    for (const p of data) {
      const row = document.createElement('div');
      row.className = 'item';

      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = p.name;

      const detail = document.createElement('p');
      const minorNote = p.currency === 'USD' ? ` ($${(p.price_minor / 100).toFixed(2)})` : '';
      detail.textContent = `${p.currency} ${p.price_minor.toLocaleString()} minor units${minorNote} · ${p.stock} in stock${p.active ? '' : ' · inactive'}`;

      if (p.description) {
        const desc = document.createElement('p');
        desc.style.color = '#7f84a8';
        desc.style.fontSize = '12px';
        desc.textContent = p.description.length > 90 ? p.description.slice(0, 87) + '…' : p.description;
        info.append(title, detail, desc);
      } else {
        info.append(title, detail);
      }

      const controls = document.createElement('div');
      controls.className = 'item-controls';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'secondary';
      editBtn.textContent = 'Edit';
      editBtn.onclick = () => startEditProduct(p);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => deleteProduct(p);

      controls.append(editBtn, delBtn);
      row.append(info, controls);
      box.append(row);
    }
  } catch (err) {
    box.textContent = 'Could not load products: ' + err.message;
    console.error('Error loading products:', err);
  }
}

function startEditProduct(p) {
  editingId = p.id;
  $('name').value = p.name;
  $('description').value = p.description || '';
  $('price').value = p.price_minor;
  $('currency').value = p.currency;
  $('stock').value = p.stock;

  $('productFormTitle').textContent = 'Edit product';
  $('saveProduct').textContent = 'Save changes';
  $('cancelEdit').hidden = false;
  $('name').focus();
}

function resetProductForm() {
  editingId = null;
  $('productForm').reset();
  $('currency').value = 'MMK';
  $('productFormTitle').textContent = '02   Add a product';
  $('saveProduct').textContent = 'Add product';
  $('cancelEdit').hidden = true;
}

$('cancelEdit').onclick = resetProductForm;

async function deleteProduct(p) {
  if (!confirm(`Are you sure you want to delete "${p.name}"?`)) return;

  try {
    const { error } = await client
      .from('products')
      .delete()
      .eq('id', p.id)
      .eq('merchant_id', currentUser.id);

    if (error) throw error;

    notify(`Product "${p.name}" deleted.`);
    if (editingId === p.id) resetProductForm();
    await loadProducts();
  } catch (err) {
    notify('Failed to delete product: ' + err.message, true);
  }
}

// Product Form Submission with validation & duplicate prevention
$('productForm').onsubmit = async (e) => {
  e.preventDefault();
  if (isSubmittingProduct) return;

  const name = $('name').value.trim();
  const description = $('description').value.trim();
  const priceRaw = $('price').value.trim();
  const currency = $('currency').value.trim().toUpperCase();
  const stockRaw = $('stock').value.trim();

  // Client-side validations mirroring Postgres schema constraints
  if (!name || name.length > 120) {
    notify('Product name must be between 1 and 120 characters.', true);
    return;
  }

  if (description.length > 2000) {
    notify('Description must not exceed 2000 characters.', true);
    return;
  }

  const priceMinor = Number(priceRaw);
  if (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > 1000000000) {
    notify('Price must be an integer between 0 and 1,000,000,000 minor units.', true);
    return;
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    notify('Currency must be a 3-letter uppercase code (e.g. MMK, USD, EUR).', true);
    return;
  }

  const stock = Number(stockRaw);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) {
    notify('Stock must be an integer between 0 and 1,000,000.', true);
    return;
  }

  const productData = {
    name,
    description,
    price_minor: priceMinor,
    currency,
    stock
  };

  const submitBtn = $('saveProduct');
  isSubmittingProduct = true;
  submitBtn.disabled = true;
  submitBtn.textContent = editingId ? 'Saving…' : 'Adding…';

  try {
    let resultError;

    if (editingId) {
      const { error } = await client
        .from('products')
        .update(productData)
        .eq('id', editingId)
        .eq('merchant_id', currentUser.id);
      resultError = error;
    } else {
      const { error } = await client
        .from('products')
        .insert({
          ...productData,
          merchant_id: currentUser.id
        });
      resultError = error;
    }

    if (resultError) throw resultError;

    notify(editingId ? 'Product updated successfully.' : 'Product added successfully.');
    resetProductForm();
    await loadProducts();
  } catch (err) {
    notify('Failed to save product: ' + err.message, true);
  } finally {
    isSubmittingProduct = false;
    submitBtn.disabled = false;
    submitBtn.textContent = editingId ? 'Save changes' : 'Add product';
  }
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Start app
initApp();

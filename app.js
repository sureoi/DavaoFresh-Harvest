/**
 * DavaoFresh Harvest - Frontend Controller
 * Connects UI to Google Apps Script (Drive JSON DB) and Vercel (/api/paymongo)
 */

const CONFIG = {
  GAS_URL: 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE', // Paste your https://script.google.com/macros/s/.../exec URL
  PAYMONGO_API: '/api/paymongo',
  CURRENCY: '₱'
};

const state = {
  products: [],
  orders: [],
  reviews: [],
  cart: JSON.parse(localStorage.getItem('davaofresh_cart') || '[]'),
  uploadedImageBase64: ''
};

// --- Navigation ---
function showSection(sectionId) {
  document.querySelectorAll('.page-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === sectionId);
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === sectionId);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setStatus(message, isError = false) {
  const el = document.getElementById('statusBanner');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'status-banner error' : 'status-banner';
}

// --- Google Apps Script API Helpers ---
async function fetchStoreData() {
  if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_APPS_SCRIPT_WEB_APP_URL_HERE')) {
    setStatus('Set your Google Apps Script /exec URL in app.js to load live Google Drive data.', true);
    renderProducts();
    renderOrders();
    renderReviews();
    return;
  }

  try {
    setStatus('Syncing fresh produce & orders with Google Drive...');
    const res = await fetch(`${CONFIG.GAS_URL}?action=getAll`);
    const json = await res.json();

    if (json.status !== 'success') {
      throw new Error(json.message || 'Failed to read Google Drive database');
    }

    state.products = json.data.products || [];
    state.orders = json.data.orders || [];
    state.reviews = json.data.reviews || [];

    renderProducts();
    renderOrders();
    renderReviews();
    setStatus(`Connected to Google Drive JSON (${state.products.length} products loaded).`);
  } catch (err) {
    console.error(err);
    setStatus(`Drive sync error: ${err.message}`, true);
  }
}

async function postToGas(payload) {
  if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_APPS_SCRIPT_WEB_APP_URL_HERE')) {
    throw new Error('GAS_URL is not configured yet.');
  }

  // text/plain avoids unnecessary CORS preflight issues with Google Apps Script
  const res = await fetch(CONFIG.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(json.message || 'Backend request failed');
  }
  return json;
}

// --- Products & Cart ---
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  if (!state.products.length) {
    grid.innerHTML = '<p class="muted">No products available yet. Add one in the Seller / Admin tab.</p>';
    return;
  }

  grid.innerHTML = state.products
    .map(
      (item) => `
      <article class="card product-card">
        <img src="${item.image}" alt="${escapeHtml(item.name)}" />
        <div class="muted">${escapeHtml(item.category)} • ${escapeHtml(item.farm || 'Davao Farm')}</div>
        <h3>${escapeHtml(item.name)}</h3>
        <p class="muted">${escapeHtml(item.description || '')}</p>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.85rem;">
          <span class="price-tag">${CONFIG.CURRENCY}${Number(item.price).toFixed(2)} / ${escapeHtml(item.unit || 'kg')}</span>
          <button class="btn btn-primary" onclick="addToCart('${item.id}')">Add to Basket</button>
        </div>
      </article>
    `
    )
    .join('');
}

function addToCart(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;

  const existing = state.cart.find((c) => c.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      unit: product.unit || 'kg',
      qty: 1
    });
  }

  saveCart();
  renderCart();
  setStatus(`Added ${product.name} to your basket.`);
}

function updateQty(productId, delta) {
  const item = state.cart.find((c) => c.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter((c) => c.id !== productId);
  }
  saveCart();
  renderCart();
}

function saveCart() {
  localStorage.setItem('davaofresh_cart', JSON.stringify(state.cart));
}

function getCartTotal() {
  return state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function renderCart() {
  const container = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const countEl = document.getElementById('cartCount');

  const totalQty = state.cart.reduce((s, i) => s + i.qty, 0);
  if (countEl) countEl.textContent = totalQty;
  if (totalEl) totalEl.textContent = `${CONFIG.CURRENCY}${getCartTotal().toFixed(2)}`;

  if (!container) return;
  if (!state.cart.length) {
    container.innerHTML = '<p class="muted">Your vegetable basket is empty.</p>';
    return;
  }

  container.innerHTML = state.cart
    .map(
      (item) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <div class="muted">${CONFIG.CURRENCY}${item.price.toFixed(2)} × ${item.qty} ${escapeHtml(item.unit)}</div>
        </div>
        <div style="display:flex; gap:0.35rem;">
          <button class="btn btn-outline" onclick="updateQty('${item.id}', -1)">-</button>
          <button class="btn btn-outline" onclick="updateQty('${item.id}', 1)">+</button>
        </div>
      </div>
    `
    )
    .join('');
}

// --- Checkout & PayMongo Integration ---
async function handleCheckout(event) {
  event.preventDefault();
  if (!state.cart.length) {
    setStatus('Please add vegetables to your basket before checking out.', true);
    return;
  }

  const customerName = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const paymentMethod = document.getElementById('paymentMethod').value;
  const totalAmount = getCartTotal();

  try {
    setStatus('Creating order and preparing payment...');

    // 1. Save order to Google Drive JSON via Apps Script
    const orderResult = await postToGas({
      action: 'createOrder',
      customerName,
      phone,
      address,
      items: state.cart,
      totalAmount,
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'COD - Due on Delivery' : 'Awaiting PayMongo'
    });

    // 2. If online payment chosen, call Vercel serverless function /api/paymongo
    let checkoutUrl = '';
    if (paymentMethod !== 'cod') {
      const pmRes = await fetch(CONFIG.PAYMONGO_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderResult.order.orderId,
          amountInPesos: totalAmount,
          paymentMethod,
          description: `DavaoFresh Order ${orderResult.order.orderId}`,
          customerName,
          phone
        })
      });
      const pmData = await pmRes.json();
      if (!pmRes.ok || !pmData.checkoutUrl) {
        throw new Error(pmData.error || 'Unable to initialize PayMongo checkout');
      }
      checkoutUrl = pmData.checkoutUrl;
    }

    state.cart = [];
    saveCart();
    renderCart();
    await fetchStoreData();

    if (checkoutUrl) {
      setStatus('Redirecting to PayMongo checkout...');
      window.location.href = checkoutUrl;
    } else {
      setStatus(`Order ${orderResult.order.orderId} placed for Cash on Delivery!`);
    }
  } catch (err) {
    console.error(err);
    setStatus(`Checkout error: ${err.message}`, true);
  }
}

// --- Product Photo Upload & Add Product ---
function handleImageFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    state.uploadedImageBase64 = reader.result;
    const preview = document.getElementById('productImagePreview');
    if (preview) {
      preview.src = reader.result;
      preview.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

async function handleAddProduct(event) {
  event.preventDefault();

  const name = document.getElementById('prodName').value.trim();
  const category = document.getElementById('prodCategory').value;
  const price = Number(document.getElementById('prodPrice').value);
  const unit = document.getElementById('prodUnit').value.trim() || 'kg';
  const farm = document.getElementById('prodFarm').value.trim() || 'Tagum / Davao Partner Farm';
  const description = document.getElementById('prodDesc').value.trim();
  const imageUrlInput = document.getElementById('prodImageUrl').value.trim();

  const image = state.uploadedImageBase64 || imageUrlInput || 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=600&q=80';

  try {
    setStatus('Saving new vegetable product to Google Drive...');
    await postToGas({
      action: 'addProduct',
      name,
      category,
      price,
      unit,
      farm,
      description,
      image
    });

    event.target.reset();
    state.uploadedImageBase64 = '';
    const preview = document.getElementById('productImagePreview');
    if (preview) preview.style.display = 'none';

    await fetchStoreData();
    setStatus(`Added "${name}" to your live catalog!`);
  } catch (err) {
    setStatus(`Could not add product: ${err.message}`, true);
  }
}

// --- Orders, Reviews & Contact ---
function renderOrders() {
  const list = document.getElementById('ordersList');
  if (!list) return;

  if (!state.orders.length) {
    list.innerHTML = '<p class="muted">No orders recorded yet.</p>';
    return;
  }

  list.innerHTML = state.orders
    .map(
      (ord) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(ord.orderId)}</strong> — ${escapeHtml(ord.customerName)}
          <div class="muted">${CONFIG.CURRENCY}${Number(ord.totalAmount).toFixed(2)} • ${escapeHtml(ord.paymentStatus)} • <strong>${escapeHtml(ord.orderStatus)}</strong></div>
        </div>
        <select class="form-control" style="width:auto;" onchange="updateOrderStatus('${ord.orderId}', this.value)">
          <option ${ord.orderStatus === 'Preparing Harvest' ? 'selected' : ''}>Preparing Harvest</option>
          <option ${ord.orderStatus === 'Out for Delivery' ? 'selected' : ''}>Out for Delivery</option>
          <option ${ord.orderStatus === 'Delivered' ? 'selected' : ''}>Delivered</option>
        </select>
      </div>
    `
    )
    .join('');
}

async function updateOrderStatus(orderId, orderStatus) {
  try {
    await postToGas({ action: 'updateOrderStatus', orderId, orderStatus });
    await fetchStoreData();
    setStatus(`Updated ${orderId} to "${orderStatus}".`);
  } catch (err) {
    setStatus(`Status update failed: ${err.message}`, true);
  }
}

function renderReviews() {
  const list = document.getElementById('reviewsList');
  if (!list) return;

  list.innerHTML = state.reviews
    .map(
      (rev) => `
      <div class="card">
        <strong>${escapeHtml(rev.customer)}</strong> <span class="muted">(${escapeHtml(rev.location || 'Davao Region')})</span>
        <div>${'★'.repeat(Number(rev.rating) || 5)}</div>
        <p style="margin-top:0.4rem;">"${escapeHtml(rev.comment)}"</p>
      </div>
    `
    )
    .join('');
}

async function handleContactSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('contactName').value.trim();
  const email = document.getElementById('contactEmail').value.trim();
  const message = document.getElementById('contactMessage').value.trim();

  try {
    await postToGas({ action: 'addMessage', name, email, message });
    event.target.reset();
    setStatus('Message sent and saved to Google Drive!');
  } catch (err) {
    setStatus(`Message error: ${err.message}`, true);
  }
}

// --- VeggieBot Assistant ---
function handleChatSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  appendChatMsg(text, 'user');
  input.value = '';

  const q = text.toLowerCase();
  let reply = 'We deliver fresh vegetables daily across Tagum City and nearby Davao areas. Ask me about delivery, payment methods (GCash, Maya, GrabPay, Card, COD), or recipe ideas!';

  if (q.includes('delivery') || q.includes('tagum') || q.includes('davao')) {
    reply = 'Morning harvests are packed and dispatched for same-day delivery around Tagum City and partner Davao zones.';
  } else if (q.includes('pay') || q.includes('gcash') || q.includes('maya') || q.includes('paymongo')) {
    reply = 'We support GCash, Maya, GrabPay, credit/debit cards via PayMongo checkout, plus Cash on Delivery.';
  } else if (q.includes('pinakbet') || q.includes('recipe') || q.includes('cook')) {
    reply = 'For classic Pinakbet, pair our native ampalaya, squash, okra, and eggplant with sautéed garlic, onion, tomato, and bagoong.';
  }

  setTimeout(() => appendChatMsg(reply, 'bot'), 200);
}

function appendChatMsg(text, sender) {
  const box = document.getElementById('chatBox');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${sender}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showSection(btn.dataset.target));
  });

  renderCart();
  fetchStoreData();
});

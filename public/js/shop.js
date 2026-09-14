let catalog = [];
let cart = [];
let profile = null; // { id, name, title, phone, email }

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', async () => {
  loadProfile();
  bindNav();
  bindProfileModal();
  bindCartDrawer();
  bindSpecialForm();
  bindHistorySearch();
  bindSpecialSearch();

  try {
    catalog = await Api.get('/api/catalog');
    renderCatalog();
  } catch (err) {
    document.getElementById('subcats-container').innerHTML =
      `<div class="empty-state"><div class="icon">⚠️</div>商品目錄載入失敗：${escapeHtml(err.message)}</div>`;
  }
});

// ============================================================
// 身份：註冊 / 登入（不需密碼，用聯絡手機辨識）
// ============================================================
function loadProfile() {
  const raw = localStorage.getItem('os_profile');
  profile = raw ? JSON.parse(raw) : null;
  renderProfileBadge();
}

function saveProfile(user) {
  profile = user;
  localStorage.setItem('os_profile', JSON.stringify(user));
  renderProfileBadge();
}

function renderProfileBadge() {
  const badge = document.getElementById('profile-badge');
  badge.textContent = profile ? `👤 ${profile.name}（${profile.title}）` : '👤 尚未登入 / 註冊';
  const spLine = document.getElementById('sp-identity-line');
  if (spLine) {
    spLine.textContent = profile
      ? `將以「${profile.name}（${profile.title}）」的身份送出申請，如需更換請點右上角身份按鈕。`
      : '尚未登入，送出前請先點右上角完成註冊/登入。';
  }
}

function openProfileModal() {
  document.getElementById('profile-modal').style.display = 'flex';
  document.getElementById('pf-step-lookup').style.display = 'block';
  document.getElementById('pf-step-register').style.display = 'none';
  document.getElementById('pf-phone-lookup').value = profile ? profile.phone : '';
}
function closeProfileModal() {
  document.getElementById('profile-modal').style.display = 'none';
}

function bindProfileModal() {
  document.getElementById('profile-badge').addEventListener('click', openProfileModal);
  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);

  document.getElementById('pf-lookup-btn').addEventListener('click', async () => {
    const phone = document.getElementById('pf-phone-lookup').value.trim();
    if (!phone) return showToast('請輸入聯絡手機', 'error');
    try {
      const user = await Api.get(`/api/users/lookup?phone=${encodeURIComponent(phone)}`);
      saveProfile(user);
      closeProfileModal();
      showToast(`歡迎回來，${user.name}`, 'success');
    } catch (err) {
      // 查無資料 -> 顯示註冊欄位，讓使用者補填姓名/職稱完成註冊
      document.getElementById('pf-phone-register').value = phone;
      document.getElementById('pf-name').value = '';
      document.getElementById('pf-title').value = '';
      document.getElementById('pf-email').value = '';
      document.getElementById('pf-step-lookup').style.display = 'none';
      document.getElementById('pf-step-register').style.display = 'block';
    }
  });

  document.getElementById('pf-back-to-lookup').addEventListener('click', () => {
    document.getElementById('pf-step-register').style.display = 'none';
    document.getElementById('pf-step-lookup').style.display = 'block';
  });

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('pf-name').value.trim(),
      title: document.getElementById('pf-title').value.trim(),
      phone: document.getElementById('pf-phone-register').value.trim(),
      email: document.getElementById('pf-email').value.trim(),
    };
    if (!payload.name) return showToast('請填寫姓名', 'error');
    if (!payload.title) return showToast('請填寫職稱', 'error');
    if (!payload.phone) return showToast('請填寫聯絡手機', 'error');
    try {
      const user = await Api.post('/api/register', payload);
      saveProfile(user);
      closeProfileModal();
      showToast('註冊完成，歡迎使用', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// 需要先登入才能執行的動作（下單／送出特殊採購申請）呼叫這個檢查
function requireProfile() {
  if (profile) return true;
  showToast('請先完成註冊/登入', 'error');
  openProfileModal();
  return false;
}

// ---------- 頁籤切換 ----------
function bindNav() {
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'history') loadHistory();
  if (view === 'special') loadSpecialRequests();
}

// ---------- 商城渲染 ----------
function renderCatalog() {
  const nav = document.getElementById('cat-nav');
  const container = document.getElementById('subcats-container');

  if (!catalog.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📦</div>目前還沒有任何品項，請管理員到後台新增。</div>`;
    nav.innerHTML = '';
    return;
  }

  nav.innerHTML = catalog.map((cat, i) =>
    `<button class="cat-nav-item${i === 0 ? ' active' : ''}" data-cat="cat-${cat.id}">${escapeHtml(cat.name)}</button>`
  ).join('');

  nav.querySelectorAll('.cat-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      nav.querySelectorAll('.cat-nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.cat)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  container.innerHTML = catalog.map((cat) => `
    <div id="cat-${cat.id}">
      ${cat.subcategories.map((sub) => renderSubcatSection(cat, sub)).join('') || ''}
    </div>
  `).join('');

  container.querySelectorAll('.item-card').forEach(bindItemCard);
}

function renderSubcatSection(cat, sub) {
  if (!sub.items.length) return '';
  return `
    <div class="subcat-section">
      <div class="subcat-title">
        <span class="eyebrow">${escapeHtml(cat.name)}</span>
        <h3>${escapeHtml(sub.name)}</h3>
      </div>
      <div class="item-grid">
        ${sub.items.map(renderItemCard).join('')}
      </div>
    </div>
  `;
}

function renderItemCard(item) {
  const specOptions = item.specs.length
    ? `<select class="item-spec"><option value="">選擇規格</option>${item.specs.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>`
    : '';
  const colorOptions = item.colors.length
    ? `<select class="item-color"><option value="">選擇顏色</option>${item.colors.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>`
    : '';

  return `
    <div class="item-card" data-item='${JSON.stringify({
      id: item.id, name: item.name, image_url: item.image_url, unit: item.unit,
    }).replace(/'/g, '&apos;')}'>
      <img class="item-img" src="${escapeAttr(item.image_url || placeholderFor(item.name))}" alt="${escapeAttr(item.name)}" loading="lazy">
      <div class="item-body">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
        <div class="item-controls">
          ${specOptions}
          ${colorOptions}
          <div class="qty-row">
            <div class="qty-stepper">
              <button type="button" class="qty-minus">−</button>
              <input type="number" class="qty-input" value="1" min="1">
              <button type="button" class="qty-plus">+</button>
            </div>
            <span class="small-note">${escapeHtml(item.unit || '')}</span>
          </div>
          <button type="button" class="btn btn-primary btn-block add-to-cart">加入購物車</button>
        </div>
      </div>
    </div>
  `;
}

function placeholderFor(name) {
  return `https://placehold.co/300x300?text=${encodeURIComponent(name || '商品')}`;
}

function bindItemCard(card) {
  const qtyInput = card.querySelector('.qty-input');
  card.querySelector('.qty-minus').addEventListener('click', () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
  });
  card.querySelector('.qty-plus').addEventListener('click', () => {
    qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
  });
  qtyInput.addEventListener('change', () => {
    qtyInput.value = Math.max(1, parseInt(qtyInput.value, 10) || 1);
  });

  card.querySelector('.add-to-cart').addEventListener('click', () => {
    const data = JSON.parse(card.dataset.item.replace(/&apos;/g, "'"));
    const specEl = card.querySelector('.item-spec');
    const colorEl = card.querySelector('.item-color');

    if (specEl && !specEl.value) return showToast('請選擇規格', 'error');
    if (colorEl && !colorEl.value) return showToast('請選擇顏色', 'error');

    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    addToCart({
      item_id: data.id,
      item_name: data.name,
      image_url: data.image_url,
      unit: data.unit,
      spec: specEl ? specEl.value : '',
      color: colorEl ? colorEl.value : '',
      quantity: qty,
    });
    qtyInput.value = 1;
    showToast(`已加入購物車：${data.name}`, 'success');
  });
}

// ---------- 購物車 ----------
function addToCart(line) {
  const existing = cart.find(
    (l) => l.item_id === line.item_id && l.spec === line.spec && l.color === line.color
  );
  if (existing) existing.quantity += line.quantity;
  else cart.push(line);
  renderCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  renderCart();
}

function renderCart() {
  const count = cart.reduce((sum, l) => sum + l.quantity, 0);
  document.getElementById('cart-count').textContent = count;

  const body = document.getElementById('cart-lines');
  if (!cart.length) {
    body.innerHTML = `<div class="empty-state"><div class="icon">🛒</div>購物車是空的</div>`;
    return;
  }

  body.innerHTML = cart.map((l, i) => `
    <div class="cart-line">
      <img src="${escapeAttr(l.image_url || placeholderFor(l.item_name))}" alt="">
      <div class="cart-line-info">
        <div class="cart-line-name">${escapeHtml(l.item_name)}</div>
        <div class="cart-line-meta">${[l.spec, l.color].filter(Boolean).map(escapeHtml).join(' · ') || '—'}</div>
        <div class="cart-line-actions">
          <div class="qty-stepper">
            <button type="button" class="qty-minus" data-i="${i}">−</button>
            <input type="number" class="qty-input" value="${l.quantity}" min="1" data-i="${i}">
            <button type="button" class="qty-plus" data-i="${i}">+</button>
          </div>
          <span class="small-note">${escapeHtml(l.unit || '')}</span>
          <button type="button" class="btn btn-danger btn-sm cart-remove" data-i="${i}" style="margin-left:auto;">移除</button>
        </div>
      </div>
    </div>
  `).join('');

  body.querySelectorAll('.qty-minus').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i;
    cart[i].quantity = Math.max(1, cart[i].quantity - 1);
    renderCart();
  }));
  body.querySelectorAll('.qty-plus').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i;
    cart[i].quantity += 1;
    renderCart();
  }));
  body.querySelectorAll('.qty-input').forEach((inp) => inp.addEventListener('change', () => {
    const i = +inp.dataset.i;
    cart[i].quantity = Math.max(1, parseInt(inp.value, 10) || 1);
    renderCart();
  }));
  body.querySelectorAll('.cart-remove').forEach((b) => b.addEventListener('click', () => {
    removeFromCart(+b.dataset.i);
  }));
}

function bindCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('overlay');

  document.getElementById('cart-btn').addEventListener('click', () => {
    drawer.classList.add('open');
    overlay.classList.add('open');
  });
  document.getElementById('cart-close').addEventListener('click', closeCart);
  overlay.addEventListener('click', closeCart);

  function closeCart() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }

  document.getElementById('cart-submit').addEventListener('click', submitOrder);
  document.getElementById('confirm-close').addEventListener('click', () => {
    document.getElementById('confirm-modal').style.display = 'none';
  });
}

async function submitOrder() {
  if (!requireProfile()) return;
  if (!cart.length) return showToast('購物車是空的', 'error');

  const note = document.getElementById('cart-note').value.trim();
  const submitBtn = document.getElementById('cart-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = '送出中…';

  try {
    const order = await Api.post('/api/orders', {
      requester_name: profile.name,
      title: profile.title,
      phone: profile.phone,
      email: profile.email,
      note,
      items: cart,
    });
    cart = [];
    renderCart();
    document.getElementById('cart-note').value = '';
    document.getElementById('cart-drawer').classList.remove('open');
    document.getElementById('overlay').classList.remove('open');
    showOrderConfirmation(order);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '送出叫料單';
  }
}

function showOrderConfirmation(order) {
  document.getElementById('confirm-no').textContent = `單號 #${String(order.id).padStart(5, '0')}`;
  document.getElementById('confirm-date').textContent = order.created_at;
  document.getElementById('confirm-items').innerHTML = order.items.map((it) => `
    <div class="ticket-row">
      <span class="name">${escapeHtml(it.item_name)} ${[it.spec, it.color].filter(Boolean).map((s) => `· ${escapeHtml(s)}`).join(' ')}</span>
      <span class="sub">x${it.quantity} ${escapeHtml(it.unit || '')}</span>
    </div>
  `).join('');
  document.getElementById('confirm-modal').style.display = 'flex';
}

// ---------- 歷史紀錄 ----------
function bindHistorySearch() {
  document.getElementById('hist-search').addEventListener('click', loadHistory);
}

async function loadHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = `<div class="empty-state"><div class="icon">⏳</div>查詢中…</div>`;

  const params = new URLSearchParams();
  const name = document.getElementById('hist-name').value.trim();
  const title = document.getElementById('hist-title').value.trim();
  const from = document.getElementById('hist-from').value;
  const to = document.getElementById('hist-to').value;
  if (name) params.set('name', name);
  if (title) params.set('title', title);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const orders = await Api.get(`/api/orders?${params.toString()}`);
    if (!orders.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📭</div>沒有符合條件的叫料紀錄</div>`;
      return;
    }
    list.innerHTML = orders.map((o) => `
      <div class="ticket">
        <div class="ticket-head">
          <span class="ticket-no">單號 #${String(o.id).padStart(5, '0')}</span>
          <span class="ticket-meta">${escapeHtml(o.created_at)}</span>
        </div>
        <div class="ticket-row">
          <span class="name">${escapeHtml(o.requester_name)}　<span class="sub">${escapeHtml(o.title)}</span></span>
        </div>
        ${o.items.map((it) => `
          <div class="ticket-row">
            <span class="name">${escapeHtml(it.item_name)} ${[it.spec, it.color].filter(Boolean).map((s) => `· ${escapeHtml(s)}`).join(' ')}</span>
            <span class="sub">x${it.quantity} ${escapeHtml(it.unit || '')}</span>
          </div>
        `).join('')}
        ${o.note ? `<div class="ticket-row sub" style="margin-top:6px;">備註：${escapeHtml(o.note)}</div>` : ''}
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div>${escapeHtml(err.message)}</div>`;
  }
}

// ---------- 特殊設備採購 ----------
function bindSpecialForm() {
  document.getElementById('special-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireProfile()) return;

    const payload = {
      requester_name: profile.name,
      title: profile.title,
      phone: profile.phone,
      email: profile.email,
      item_name: document.getElementById('sp-item').value.trim(),
      vendor: document.getElementById('sp-vendor').value.trim(),
      purpose: document.getElementById('sp-purpose').value.trim(),
      budget: document.getElementById('sp-budget').value.trim(),
      quantity: parseInt(document.getElementById('sp-qty').value, 10) || 1,
      note: document.getElementById('sp-note').value.trim(),
    };
    try {
      await Api.post('/api/special-requests', payload);
      showToast('申請已送出，管理員將盡快審核', 'success');
      document.getElementById('special-form').reset();
      document.getElementById('sp-qty').value = 1;
      loadSpecialRequests();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function bindSpecialSearch() {
  document.getElementById('sp-hist-search').addEventListener('click', loadSpecialRequests);
}

const STATUS_LABEL = { pending: '待審核', approved: '已核准', rejected: '已拒絕' };
const STATUS_CLASS = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' };

async function loadSpecialRequests() {
  const list = document.getElementById('special-list');
  list.innerHTML = `<div class="empty-state"><div class="icon">⏳</div>查詢中…</div>`;

  const params = new URLSearchParams();
  const name = document.getElementById('sp-hist-name').value.trim();
  const title = document.getElementById('sp-hist-title').value.trim();
  if (name) params.set('name', name);
  if (title) params.set('title', title);

  try {
    const reqs = await Api.get(`/api/special-requests?${params.toString()}`);
    if (!reqs.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📭</div>目前沒有申請紀錄</div>`;
      return;
    }
    list.innerHTML = reqs.map((r) => `
      <div class="ticket">
        <div class="ticket-head">
          <span class="ticket-no">申請 #${String(r.id).padStart(5, '0')}</span>
          <span class="badge ${STATUS_CLASS[r.status]}">${STATUS_LABEL[r.status]}</span>
        </div>
        <div class="ticket-row"><span class="name">${escapeHtml(r.item_name)}</span><span class="sub">x${r.quantity}</span></div>
        <div class="ticket-row sub">${escapeHtml(r.requester_name)} · ${escapeHtml(r.title)} · ${escapeHtml(r.created_at)}</div>
        ${r.vendor ? `<div class="ticket-row sub">廠商：${escapeHtml(r.vendor)}</div>` : ''}
        ${r.budget ? `<div class="ticket-row sub">預算：${escapeHtml(r.budget)}</div>` : ''}
        ${r.purpose ? `<div class="ticket-row sub">用途：${escapeHtml(r.purpose)}</div>` : ''}
        ${r.reviewer_note ? `<div class="ticket-row sub">審核意見：${escapeHtml(r.reviewer_note)}</div>` : ''}
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div>${escapeHtml(err.message)}</div>`;
  }
}

// ---------- 共用工具 ----------
function showToast(msg, type = '') {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

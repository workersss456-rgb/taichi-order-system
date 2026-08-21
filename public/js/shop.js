let catalog = [];
let cart = [];

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', async () => {
  restoreIdentity();
  bindNav();
  bindIdentityInputs();
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

function restoreIdentity() {
  document.getElementById('id-name').value = localStorage.getItem('os_name') || '';
  document.getElementById('id-dept').value = localStorage.getItem('os_dept') || '';
}

function bindIdentityInputs() {
  document.getElementById('id-name').addEventListener('input', (e) => {
    localStorage.setItem('os_name', e.target.value);
  });
  document.getElementById('id-dept').addEventListener('input', (e) => {
    localStorage.setItem('os_dept', e.target.value);
  });
}

function getIdentity() {
  return {
    name: document.getElementById('id-name').value.trim(),
    dept: document.getElementById('id-dept').value.trim(),
  };
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
  const { name, dept } = getIdentity();
  if (!name) return showToast('請先在上方填寫姓名', 'error');
  if (!dept) return showToast('請先在上方填寫部門', 'error');
  if (!cart.length) return showToast('購物車是空的', 'error');

  const note = document.getElementById('cart-note').value.trim();
  const submitBtn = document.getElementById('cart-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = '送出中…';

  try {
    const order = await Api.post('/api/orders', {
      requester_name: name,
      department: dept,
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
  const dept = document.getElementById('hist-dept').value.trim();
  const from = document.getElementById('hist-from').value;
  const to = document.getElementById('hist-to').value;
  if (name) params.set('name', name);
  if (dept) params.set('department', dept);
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
          <span class="name">${escapeHtml(o.requester_name)}　<span class="sub">${escapeHtml(o.department)}</span></span>
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
    const payload = {
      requester_name: document.getElementById('sp-name').value.trim(),
      department: document.getElementById('sp-dept').value.trim(),
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

  // 帶入目前識別資訊，方便使用者少打一次字
  document.getElementById('special-form').addEventListener('focusin', () => {
    const { name, dept } = getIdentity();
    const nameEl = document.getElementById('sp-name');
    const deptEl = document.getElementById('sp-dept');
    if (!nameEl.value && name) nameEl.value = name;
    if (!deptEl.value && dept) deptEl.value = dept;
  }, { once: true });
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
  const dept = document.getElementById('sp-hist-dept').value.trim();
  if (name) params.set('name', name);
  if (dept) params.set('department', dept);

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
        <div class="ticket-row sub">${escapeHtml(r.requester_name)} · ${escapeHtml(r.department)} · ${escapeHtml(r.created_at)}</div>
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

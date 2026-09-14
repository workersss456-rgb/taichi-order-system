let categories = [];
let subcategories = [];
let items = [];

document.addEventListener('DOMContentLoaded', () => {
  bindLogin();
  bindAdminNav();
  bindCatalogManagement();
  bindSpecialReview();
  bindHistoryPanel();

  if (sessionStorage.getItem('adminPassword')) {
    tryEnterAdmin();
  }
});

// ---------- 登入 ----------
function bindLogin() {
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-pw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('adminPassword');
    document.getElementById('admin-shell').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  });
}

async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  sessionStorage.setItem('adminPassword', pw);
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    await Api.post('/api/admin/login', {}, true);
    enterAdmin();
  } catch (err) {
    sessionStorage.removeItem('adminPassword');
    errEl.textContent = '密碼錯誤，請再試一次';
  }
}

async function tryEnterAdmin() {
  try {
    await Api.post('/api/admin/login', {}, true);
    enterAdmin();
  } catch (err) {
    sessionStorage.removeItem('adminPassword');
  }
}

function enterAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-shell').style.display = 'grid';
  loadCatalogManagement();
  loadSpecialReview();
  loadHistoryPanel();
}

// ---------- 側邊欄切換 ----------
function bindAdminNav() {
  document.querySelectorAll('.admin-nav-item[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-item[data-panel]').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.admin-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${btn.dataset.panel}`));
    });
  });
}

// ============================================================
// 品項管理
// ============================================================
function bindCatalogManagement() {
  document.getElementById('add-cat-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-cat-name');
    const name = input.value.trim();
    if (!name) return showToast('請輸入分類名稱', 'error');
    try {
      await Api.post('/api/admin/categories', { name }, true);
      input.value = '';
      loadCatalogManagement();
      showToast('分類已新增', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('new-item-btn').addEventListener('click', () => openItemForm());
  document.getElementById('item-form-cancel').addEventListener('click', closeItemForm);
  document.getElementById('item-form').addEventListener('submit', submitItemForm);
}

async function loadCatalogManagement() {
  try {
    const [catalog, allItems] = await Promise.all([
      Api.get('/api/catalog'),
      Api.get('/api/admin/items', true),
    ]);
    // catalog 只含上架品項，這裡另外組出完整的分類/子分類清單（含空的）
    categories = catalog.map((c) => ({ id: c.id, name: c.name }));
    subcategories = [];
    catalog.forEach((c) => c.subcategories.forEach((s) => subcategories.push({ id: s.id, name: s.name, category_id: c.id })));
    items = allItems;

    renderCatTree(catalog);
    renderItemsTable();
    populateSubcatSelect();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderCatTree(catalog) {
  const tree = document.getElementById('cat-tree');
  if (!catalog.length) {
    tree.innerHTML = `<p class="small-note">還沒有任何分類，先在上面新增一個吧。</p>`;
    return;
  }
  tree.innerHTML = catalog.map((cat) => `
    <div style="margin-bottom:10px; border:1px solid var(--border); border-radius:8px; padding:10px 12px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <strong>${escapeHtml(cat.name)}</strong>
        <button class="btn btn-danger btn-sm" data-del-cat="${cat.id}">刪除分類</button>
      </div>
      <div class="tag-input-list" style="margin-top:8px;">
        ${cat.subcategories.map((s) => `
          <span class="tag-pill">${escapeHtml(s.name)}<button data-del-sub="${s.id}" title="刪除子分類">×</button></span>
        `).join('')}
        <span class="tag-pill" style="background:transparent; border-style:dashed;">
          <input type="text" placeholder="+ 新增子分類" data-new-sub="${cat.id}" style="border:none; background:transparent; width:100px; outline:none;">
        </span>
      </div>
    </div>
  `).join('');

  tree.querySelectorAll('[data-del-cat]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('刪除分類會一併刪除底下的子分類與品項設定（歷史紀錄不受影響），確定嗎？')) return;
    try {
      await Api.del(`/api/admin/categories/${btn.dataset.delCat}`, true);
      loadCatalogManagement();
      showToast('分類已刪除', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));

  tree.querySelectorAll('[data-del-sub]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('刪除子分類會一併刪除底下的品項設定（歷史紀錄不受影響），確定嗎？')) return;
    try {
      await Api.del(`/api/admin/subcategories/${btn.dataset.delSub}`, true);
      loadCatalogManagement();
      showToast('子分類已刪除', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));

  tree.querySelectorAll('[data-new-sub]').forEach((inp) => inp.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const name = inp.value.trim();
    if (!name) return;
    try {
      await Api.post('/api/admin/subcategories', { category_id: +inp.dataset.newSub, name }, true);
      loadCatalogManagement();
      showToast('子分類已新增', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));
}

function populateSubcatSelect() {
  const sel = document.getElementById('item-subcat');
  sel.innerHTML = subcategories.map((s) => {
    const catName = categories.find((c) => c.id === s.category_id)?.name || '';
    return `<option value="${s.id}">${escapeHtml(catName)} / ${escapeHtml(s.name)}</option>`;
  }).join('');
}

function renderItemsTable() {
  const tbody = document.getElementById('items-tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="small-note" style="text-align:center; padding:20px;">還沒有任何品項</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((it) => {
    const sub = subcategories.find((s) => s.id === it.subcategory_id);
    return `
      <tr>
        <td><img src="${escapeAttr(it.image_url || '')}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;background:var(--surface-sunken);"></td>
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(sub ? sub.name : '—')}</td>
        <td>${(it.specs || []).map(escapeHtml).join(', ') || '—'}</td>
        <td>${(it.colors || []).map(escapeHtml).join(', ') || '—'}</td>
        <td>${it.active ? '<span class="badge badge-approved">上架中</span>' : '<span class="badge badge-rejected">已下架</span>'}</td>
        <td class="actions">
          <button class="btn btn-secondary btn-sm" data-edit="${it.id}">編輯</button>
          <button class="btn btn-danger btn-sm" data-del="${it.id}">刪除</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const item = items.find((i) => i.id === +btn.dataset.edit);
    if (item) openItemForm(item);
  }));
  tbody.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('確定要刪除這個品項嗎？（過去的叫料歷史紀錄不會受影響）')) return;
    try {
      await Api.del(`/api/admin/items/${btn.dataset.del}`, true);
      loadCatalogManagement();
      showToast('品項已刪除', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));
}

function openItemForm(item) {
  const card = document.getElementById('item-form-card');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('item-form-title').textContent = item ? '編輯品項' : '新增品項';
  document.getElementById('item-id').value = item ? item.id : '';
  document.getElementById('item-name').value = item ? item.name : '';
  document.getElementById('item-subcat').value = item ? item.subcategory_id : (subcategories[0]?.id || '');
  document.getElementById('item-image').value = item ? item.image_url : '';
  document.getElementById('item-desc').value = item ? item.description : '';
  document.getElementById('item-unit').value = item ? item.unit : '個';
  document.getElementById('item-specs').value = item ? (item.specs || []).join(', ') : '';
  document.getElementById('item-colors').value = item ? (item.colors || []).join(', ') : '';
  document.getElementById('item-sort').value = item ? item.sort_order : 0;
  document.getElementById('item-active').checked = item ? !!item.active : true;
}

function closeItemForm() {
  document.getElementById('item-form-card').style.display = 'none';
  document.getElementById('item-form').reset();
}

async function submitItemForm(e) {
  e.preventDefault();
  const id = document.getElementById('item-id').value;
  const payload = {
    subcategory_id: +document.getElementById('item-subcat').value,
    name: document.getElementById('item-name').value.trim(),
    image_url: document.getElementById('item-image').value.trim(),
    description: document.getElementById('item-desc').value.trim(),
    unit: document.getElementById('item-unit').value.trim() || '個',
    specs: splitCsv(document.getElementById('item-specs').value),
    colors: splitCsv(document.getElementById('item-colors').value),
    sort_order: +document.getElementById('item-sort').value || 0,
    active: document.getElementById('item-active').checked,
  };
  try {
    if (id) await Api.put(`/api/admin/items/${id}`, payload, true);
    else await Api.post('/api/admin/items', payload, true);
    closeItemForm();
    loadCatalogManagement();
    showToast('品項已儲存', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function splitCsv(str) {
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

// ============================================================
// 特殊採購審核
// ============================================================
function bindSpecialReview() {
  document.getElementById('sp-filter-btn').addEventListener('click', loadSpecialReview);
}

const STATUS_LABEL = { pending: '待審核', approved: '已核准', rejected: '已拒絕' };
const STATUS_CLASS = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' };

async function loadSpecialReview() {
  const list = document.getElementById('admin-special-list');
  list.innerHTML = `<div class="empty-state"><div class="icon">⏳</div>載入中…</div>`;
  const status = document.getElementById('sp-filter-status').value;
  const params = status ? `?status=${status}` : '';

  try {
    const reqs = await Api.get(`/api/special-requests${params}`, true);
    if (!reqs.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📭</div>沒有符合條件的申請</div>`;
      return;
    }
    list.innerHTML = reqs.map((r) => `
      <div class="ticket">
        <div class="ticket-head">
          <span class="ticket-no">申請 #${String(r.id).padStart(5, '0')}</span>
          <span class="badge ${STATUS_CLASS[r.status]}">${STATUS_LABEL[r.status]}</span>
        </div>
        <div class="ticket-row"><span class="name">${escapeHtml(r.item_name)}</span><span class="sub">x${r.quantity}</span></div>
        <div class="ticket-row sub">${escapeHtml(r.requester_name)} · ${escapeHtml(r.title)} · ${escapeHtml(r.phone || '-')} · ${escapeHtml(r.created_at)}</div>
        ${r.vendor ? `<div class="ticket-row sub">廠商：${escapeHtml(r.vendor)}</div>` : ''}
        ${r.budget ? `<div class="ticket-row sub">預算：${escapeHtml(r.budget)}</div>` : ''}
        ${r.purpose ? `<div class="ticket-row sub">用途：${escapeHtml(r.purpose)}</div>` : ''}
        ${r.note ? `<div class="ticket-row sub">申請備註：${escapeHtml(r.note)}</div>` : ''}
        ${r.reviewer_note ? `<div class="ticket-row sub">審核意見：${escapeHtml(r.reviewer_note)}</div>` : ''}
        ${r.status === 'pending' ? `
          <div class="modal-actions" style="margin-top:10px;">
            <button class="btn btn-primary btn-sm" data-approve="${r.id}">核准</button>
            <button class="btn btn-danger btn-sm" data-reject="${r.id}">拒絕</button>
          </div>
        ` : ''}
      </div>
    `).join('');

    list.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => reviewRequest(btn.dataset.approve, 'approved')));
    list.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => reviewRequest(btn.dataset.reject, 'rejected')));
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div>${escapeHtml(err.message)}</div>`;
  }
}

async function reviewRequest(id, status) {
  const note = prompt(status === 'approved' ? '核准意見（選填）：' : '拒絕原因（選填）：', '') || '';
  try {
    await Api.put(`/api/admin/special-requests/${id}`, { status, reviewer_note: note }, true);
    loadSpecialReview();
    showToast(status === 'approved' ? '已核准申請' : '已拒絕申請', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================
// 歷史紀錄
// ============================================================
function bindHistoryPanel() {
  document.getElementById('ah-search').addEventListener('click', loadHistoryPanel);
  document.getElementById('ah-export').addEventListener('click', exportCsv);
}

async function loadHistoryPanel() {
  const list = document.getElementById('admin-history-list');
  list.innerHTML = `<div class="empty-state"><div class="icon">⏳</div>查詢中…</div>`;

  const params = new URLSearchParams();
  const name = document.getElementById('ah-name').value.trim();
  const title = document.getElementById('ah-title').value.trim();
  const from = document.getElementById('ah-from').value;
  const to = document.getElementById('ah-to').value;
  if (name) params.set('name', name);
  if (title) params.set('title', title);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const orders = await Api.get(`/api/orders?${params.toString()}`, true);
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
        <div class="ticket-row"><span class="name">${escapeHtml(o.requester_name)}　<span class="sub">${escapeHtml(o.title)}${o.phone ? ' · ' + escapeHtml(o.phone) : ''}</span></span></div>
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

async function exportCsv() {
  try {
    const res = await fetch('/api/admin/orders/export.csv', { headers: Api.adminHeaders() });
    if (!res.ok) throw new Error('匯出失敗，請確認已登入管理後台');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'order-history.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, 'error');
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

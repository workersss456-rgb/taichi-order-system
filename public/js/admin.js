let categories = [];
let subcategories = [];
let items = [];
let sites = [];
let vendors = [];
let discountGroups = [];

document.addEventListener('DOMContentLoaded', () => {
  bindLogin();
  bindAdminNav();
  bindCatalogManagement();
  bindSiteManagement();
  bindPricingPanel();
  bindReportPanel();
  bindApproveModal();
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
  loadPricingPanel();
  loadReportPanel();
  refreshSpecialBadge();
  loadSiteManagement();
  loadSpecialReview();
  loadHistoryPanel();
}

// ---------- 側邊欄切換 ----------
function bindAdminNav() {
  document.querySelectorAll('.admin-nav-item[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-item[data-panel]').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.admin-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${btn.dataset.panel}`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

  document.getElementById('filter-cat').addEventListener('change', () => {
    populateSubcatFilter();
    renderItemsTable();
  });
  document.getElementById('filter-subcat').addEventListener('change', renderItemsTable);

  // 規格欄位一改，下方牌價表就跟著增減列（已輸入的數字會保留）
  document.getElementById('item-specs').addEventListener('input', () => renderPriceEditor(collectPriceEditor()));

  document.getElementById('price-export-btn').addEventListener('click', exportPriceCsv);
  document.getElementById('price-import-btn').addEventListener('click', () => document.getElementById('price-import-file').click());
  document.getElementById('price-import-file').addEventListener('change', importPriceCsv);
}

async function loadCatalogManagement() {
  try {
    const [catalog, allItems, groups] = await Promise.all([
      Api.get('/api/catalog'),
      Api.get('/api/admin/items', true),
      Api.get('/api/admin/discount-groups', true),
    ]);
    discountGroups = groups;
    // catalog 只含上架品項，這裡另外組出完整的分類/子分類清單（含空的）
    categories = catalog.map((c) => ({ id: c.id, name: c.name }));
    subcategories = [];
    catalog.forEach((c) => c.subcategories.forEach((s) => subcategories.push({ id: s.id, name: s.name, category_id: c.id })));
    items = allItems;

    renderCatTree(catalog);
    populateCatFilter();
    renderItemsTable();
    populateSubcatSelect();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================
// 拖曳排序（通用輔助函式）
// container：包住這些可拖曳元素的容器
// itemSelector：可拖曳元素的選擇器（元素身上要有 data-sort-id）
// axis：'y' 直向排列（清單、表格列）、'x' 橫向排列（子分類標籤）
// onReorder：放開滑鼠後拿到「新順序的 id 陣列」，負責存回後端
// ============================================================
function enableDragSort(container, itemSelector, axis, onReorder) {
  let dragEl = null;

  container.querySelectorAll(itemSelector).forEach((el) => {
    el.setAttribute('draggable', 'true');
    el.classList.add('draggable-row');

    el.addEventListener('dragstart', (e) => {
      // 子分類標籤在分類區塊裡面，不擋住事件冒泡的話會連外層分類一起拖到
      e.stopPropagation();
      dragEl = el;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox 一定要設定資料才會真的開始拖曳
      e.dataTransfer.setData('text/plain', '');
    });

    el.addEventListener('dragend', async (e) => {
      e.stopPropagation();
      el.classList.remove('dragging');
      dragEl = null;
      const ids = [...container.querySelectorAll(itemSelector)].map((x) => +x.dataset.sortId);
      await onReorder(ids);
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragEl || dragEl === el || dragEl.parentNode !== el.parentNode) return;
      const rect = el.getBoundingClientRect();
      const after = axis === 'x'
        ? (e.clientX - rect.left) > rect.width / 2
        : (e.clientY - rect.top) > rect.height / 2;
      el.parentNode.insertBefore(dragEl, after ? el.nextSibling : el);
    });
  });
}

async function saveOrder(type, ids) {
  try {
    await Api.put('/api/admin/reorder', { type, ids }, true);
    showToast('排序已儲存', 'success');
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
  tree.innerHTML = `<p class="small-note" style="margin-bottom:10px;">💡 用滑鼠拖曳分類區塊或子分類標籤即可調整順序，放開就自動儲存。</p>` +
    catalog.map((cat) => `
    <div class="cat-block" data-sort-id="${cat.id}" style="margin-bottom:10px; border:1px solid var(--border); border-radius:8px; padding:10px 12px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <strong><span class="drag-handle">⋮⋮</span>${escapeHtml(cat.name)}</strong>
        <button class="btn btn-danger btn-sm" data-del-cat="${cat.id}">刪除分類</button>
      </div>
      <div class="tag-input-list sub-list" style="margin-top:8px;">
        ${cat.subcategories.map((s) => `
          <span class="tag-pill" data-sort-id="${s.id}">${escapeHtml(s.name)}<button data-del-sub="${s.id}" title="刪除子分類">×</button></span>
        `).join('')}
        <span class="tag-pill" style="background:transparent; border-style:dashed;">
          <input type="text" placeholder="+ 新增子分類" data-new-sub="${cat.id}" style="border:none; background:transparent; width:100px; outline:none;">
        </span>
      </div>
    </div>
  `).join('');

  // 分類本身可以上下拖曳
  enableDragSort(tree, '.cat-block', 'y', (ids) => saveOrder('categories', ids));
  // 每個分類底下的子分類標籤可以左右拖曳
  tree.querySelectorAll('.sub-list').forEach((list) => {
    enableDragSort(list, '.tag-pill[data-sort-id]', 'x', (ids) => saveOrder('subcategories', ids));
  });

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

// ---------- 品項清單的分類/子分類篩選 ----------
function populateCatFilter() {
  const sel = document.getElementById('filter-cat');
  const current = sel.value;
  sel.innerHTML = '<option value="">全部分類</option>' +
    categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = categories.some((c) => String(c.id) === current) ? current : '';
  populateSubcatFilter();
}

function populateSubcatFilter() {
  const catId = document.getElementById('filter-cat').value;
  const sel = document.getElementById('filter-subcat');
  const current = sel.value;
  const list = catId ? subcategories.filter((s) => String(s.category_id) === catId) : subcategories;
  sel.innerHTML = '<option value="">全部子分類</option>' +
    list.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  sel.value = list.some((s) => String(s.id) === current) ? current : '';
}

// 目前篩選出來的品項清單（給表格渲染跟「新增品項」預帶子分類共用）
function getFilteredItems() {
  const catId = document.getElementById('filter-cat').value;
  const subId = document.getElementById('filter-subcat').value;
  return items.filter((it) => {
    if (subId) return String(it.subcategory_id) === subId;
    if (catId) {
      const sub = subcategories.find((s) => s.id === it.subcategory_id);
      return sub && String(sub.category_id) === catId;
    }
    return true;
  });
}

function renderItemsTable() {
  const tbody = document.getElementById('items-tbody');
  const filtered = getFilteredItems();
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="small-note" style="text-align:center; padding:20px;">這個篩選條件下還沒有品項</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((it) => {
    const sub = subcategories.find((s) => s.id === it.subcategory_id);
    return `
      <tr data-sort-id="${it.id}">
        <td><span class="drag-handle">⋮⋮</span><img src="${escapeAttr(it.image_url || '')}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;background:var(--surface-sunken);vertical-align:middle;"></td>
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(sub ? sub.name : '—')}</td>
        <td>${(it.specs || []).map(escapeHtml).join(', ') || '—'}</td>
        <td>${(it.colors || []).map(escapeHtml).join(', ') || '—'}</td>
        <td>${renderPriceSummary(it)}</td>
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
  }));  tbody.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('確定要刪除這個品項嗎？（過去的叫料歷史紀錄不會受影響）')) return;
    try {
      await Api.del(`/api/admin/items/${btn.dataset.del}`, true);
      loadCatalogManagement();
      showToast('品項已刪除', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));

  const subFilterSelected = !!document.getElementById('filter-subcat').value;
  if (subFilterSelected) {
    enableDragSort(tbody, 'tr[data-sort-id]', 'y', (ids) => saveOrder('items', ids));
  } else {
    tbody.querySelectorAll('.drag-handle').forEach((h) => { h.style.opacity = '0.3'; h.title = '請先篩選單一子分類才能拖曳排序'; });
  }
}

function openItemForm(item) {
  const card = document.getElementById('item-form-card');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('item-form-title').textContent = item ? '編輯品項' : '新增品項';
  document.getElementById('item-id').value = item ? item.id : '';
  document.getElementById('item-name').value = item ? item.name : '';
  document.getElementById('item-subcat').value = item
    ? item.subcategory_id
    : (document.getElementById('filter-subcat').value || subcategories[0]?.id || '');
  document.getElementById('item-image').value = item ? item.image_url : '';
  document.getElementById('item-desc').value = item ? item.description : '';
  document.getElementById('item-unit').value = item ? item.unit : '個';
  document.getElementById('item-specs').value = item ? (item.specs || []).join(', ') : '';
  document.getElementById('item-colors').value = item ? (item.colors || []).join(', ') : '';
  document.getElementById('item-sort').value = item ? item.sort_order : 0;
  document.getElementById('item-active').checked = item ? !!item.active : true;
  renderPriceEditor(item ? (item.prices || []) : []);
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
    prices: collectPriceEditor(),
  };
  const badPrice = payload.prices.find((p) => p.list_price !== '' && !(Number(p.list_price.replace(/,/g, '')) >= 0));
  if (badPrice) return showToast(`規格「${badPrice.spec || '（無規格）'}」的牌價不是數字`, 'error');

  // 同一個子分類底下已經有同名品項的話，先提醒一下，讓使用者自己決定要不要繼續
  const dup = items.find((it) =>
    it.subcategory_id === payload.subcategory_id &&
    it.name.trim().toLowerCase() === payload.name.toLowerCase() &&
    String(it.id) !== id
  );
  if (dup && !confirm(`這個子分類底下已經有一個叫「${dup.name}」的品項了，確定要繼續新增/儲存嗎？`)) {
    return;
  }

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

// ---------- 品項牌價 ----------
function renderPriceSummary(it) {
  const specs = (it.specs && it.specs.length) ? it.specs : [''];
  const values = specs
    .map((sp) => (it.prices || []).find((p) => p.spec === sp))
    .map((p) => (p && p.list_price !== null && p.list_price !== undefined) ? Number(p.list_price) : null);
  const filled = values.filter((v) => v !== null);
  const missing = values.length - filled.length;
  if (!filled.length) return '<span class="price-missing">未設定</span>';
  const min = Math.min(...filled);
  const max = Math.max(...filled);
  const range = min === max ? money(min) : `${money(min)}–${money(max)}`;
  return `<span class="price-range">${range}</span>${missing ? `<div class="price-missing">${missing} 個規格未填</div>` : ''}`;
}

function renderPriceEditor(prices) {
  const specs = splitCsv(document.getElementById('item-specs').value);
  const rows = specs.length ? specs : [''];
  const groupOptions = (selected) => '<option value="">（未指定）</option>' +
    discountGroups.map((g) => `<option value="${g.id}" ${String(g.id) === String(selected ?? '') ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
  document.getElementById('item-price-editor').innerHTML = `
    <table class="price-editor-table">
      <thead><tr><th style="width:30%;">規格</th><th style="width:30%;">牌價</th><th>折扣群組</th></tr></thead>
      <tbody>
        ${rows.map((sp) => {
          const p = prices.find((x) => x.spec === sp) || {};
          return `<tr data-spec="${escapeAttr(sp)}">
            <td>${sp ? escapeHtml(sp) : '<span class="small-note">（無規格）</span>'}</td>
            <td><input type="text" inputmode="decimal" class="mini-input pe-price" value="${escapeAttr(p.list_price ?? '')}" placeholder="例如 1200"></td>
            <td><select class="mini-input pe-group">${groupOptions(p.group_id)}</select></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function collectPriceEditor() {
  return [...document.querySelectorAll('#item-price-editor tbody tr')].map((tr) => ({
    spec: tr.dataset.spec,
    list_price: tr.querySelector('.pe-price').value.trim(),
    group_id: tr.querySelector('.pe-group').value || null,
  }));
}

async function downloadAdminFile(url, filename) {
  const res = await fetch(url, { headers: Api.adminHeaders() });
  if (!res.ok) throw new Error('下載失敗，請確認已登入管理後台');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function exportPriceCsv() {
  try { await downloadAdminFile('/api/admin/item-prices/export.csv', 'item-prices.csv'); }
  catch (err) { showToast(err.message, 'error'); }
}

// Excel 另存 CSV 在繁中 Windows 常是 Big5，先試 UTF-8，失敗再用 Big5 解碼
function decodeCsvBuffer(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); }
  catch (e) { return new TextDecoder('big5').decode(buf); }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

async function importPriceCsv(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const table = parseCsv(decodeCsvBuffer(await file.arrayBuffer()));
    if (table.length < 2) throw new Error('CSV 裡沒有資料列');
    const head = table[0].map((h) => h.trim());
    const col = (name) => head.indexOf(name);
    const need = ['品項ID', '規格', '牌價', '折扣群組'];
    const lack = need.filter((n) => col(n) === -1);
    if (lack.length) throw new Error(`CSV 缺少欄位：${lack.join('、')}（請用「匯出牌價 CSV」的檔案修改後再匯入）`);

    const rows = table.slice(1).map((r) => ({
      item_id: r[col('品項ID')],
      spec: r[col('規格')] ?? '',
      list_price: r[col('牌價')] ?? '',
      group_name: r[col('折扣群組')] ?? '',
    }));
    if (!confirm(`即將匯入 ${rows.length} 列牌價資料，CSV 裡的牌價與折扣群組會覆蓋系統現有設定，確定嗎？`)) return;

    const result = await Api.post('/api/admin/item-prices/import', { rows }, true);
    let msg = `已更新 ${result.updated} 列`;
    if (result.created_groups.length) msg += `\n自動新增折扣群組：${result.created_groups.join('、')}`;
    if (result.skipped.length) msg += `\n\n略過 ${result.skipped.length} 列：\n${result.skipped.slice(0, 20).join('\n')}${result.skipped.length > 20 ? '\n…' : ''}`;
    alert(msg);
    loadCatalogManagement();
    loadPricingPanel();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function splitCsv(str) {
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

// ============================================================
// 案場管理
// ============================================================
function bindSiteManagement() {
  document.getElementById('site-form').addEventListener('submit', submitSiteForm);
  document.getElementById('site-form-cancel').addEventListener('click', closeSiteForm);
}

async function loadSiteManagement() {
  try {
    sites = await Api.get('/api/admin/sites', true);
    renderSitesTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderSitesTable() {
  const tbody = document.getElementById('sites-tbody');
  if (!sites.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="small-note" style="text-align:center; padding:20px;">還沒有任何案場，先在上面新增一個吧</td></tr>`;
    return;
  }
  tbody.innerHTML = sites.map((s) => `
    <tr data-sort-id="${s.id}">
      <td><span class="drag-handle">⋮⋮</span>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.address || '—')}</td>
      <td>${s.sort_order}</td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm" data-edit-site="${s.id}">編輯</button>
        <button class="btn btn-danger btn-sm" data-del-site="${s.id}">刪除</button>
      </td>
    </tr>
  `).join('');

  enableDragSort(tbody, 'tr[data-sort-id]', 'y', (ids) => saveOrder('sites', ids));

  tbody.querySelectorAll('[data-edit-site]').forEach((btn) => btn.addEventListener('click', () => {
    const site = sites.find((s) => s.id === +btn.dataset.editSite);
    if (site) openSiteForm(site);
  }));
  tbody.querySelectorAll('[data-del-site]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('確定要刪除這個案場嗎？（過去已送出的叫料單地址是快照保存，不受影響）')) return;
    try {
      await Api.del(`/api/admin/sites/${btn.dataset.delSite}`, true);
      loadSiteManagement();
      showToast('案場已刪除', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));
}

function openSiteForm(site) {
  document.getElementById('site-form-title').textContent = site ? '編輯案場' : '新增案場';
  document.getElementById('site-id').value = site ? site.id : '';
  document.getElementById('site-name').value = site ? site.name : '';
  document.getElementById('site-address').value = site ? (site.address || '') : '';
  document.getElementById('site-sort').value = site ? site.sort_order : 0;
  document.getElementById('site-form-cancel').style.display = site ? 'inline-block' : 'none';
}

function closeSiteForm() {
  document.getElementById('site-form').reset();
  document.getElementById('site-id').value = '';
  document.getElementById('site-form-title').textContent = '新增案場';
  document.getElementById('site-form-cancel').style.display = 'none';
}

async function submitSiteForm(e) {
  e.preventDefault();
  const id = document.getElementById('site-id').value;
  const payload = {
    name: document.getElementById('site-name').value.trim(),
    address: document.getElementById('site-address').value.trim(),
    sort_order: +document.getElementById('site-sort').value || 0,
  };
  try {
    if (id) await Api.put(`/api/admin/sites/${id}`, payload, true);
    else await Api.post('/api/admin/sites', payload, true);
    closeSiteForm();
    loadSiteManagement();
    showToast('案場已儲存', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================
// 廠商 / 折扣群組 / 每月折數
// ============================================================
function bindPricingPanel() {
  document.getElementById('add-vendor-btn').addEventListener('click', () => addNameEntry('vendors', 'new-vendor-name'));
  document.getElementById('add-group-btn').addEventListener('click', () => addNameEntry('discount-groups', 'new-group-name'));
  document.getElementById('new-vendor-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNameEntry('vendors', 'new-vendor-name'); });
  document.getElementById('new-group-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNameEntry('discount-groups', 'new-group-name'); });

  const monthInput = document.getElementById('disc-month');
  monthInput.value = currentTaipeiMonth();
  monthInput.addEventListener('change', loadDiscountGrid);
  document.getElementById('disc-save-btn').addEventListener('click', saveDiscountGrid);
}

function currentTaipeiMonth() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}

async function loadPricingPanel() {
  try {
    [vendors, discountGroups] = await Promise.all([
      Api.get('/api/admin/vendors', true),
      Api.get('/api/admin/discount-groups', true),
    ]);
    renderNameList('vendor-list', vendors, 'vendors', '筆訂單');
    renderGroupList();
    await loadDiscountGrid();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderNameList(containerId, list, apiPath, usageUnit) {
  const box = document.getElementById(containerId);
  if (!list.length) {
    box.innerHTML = '<p class="small-note">還沒有資料，先在上面新增。</p>';
    return;
  }
  box.innerHTML = list.map((x) => `
    <span class="tag-pill name-pill" data-sort-id="${x.id}">
      ${escapeHtml(x.name)} <span class="usage">${x.usage_count} ${usageUnit}</span>
      <button data-rename="${x.id}" title="改名">✎</button>
      <button data-remove="${x.id}" title="刪除">×</button>
    </span>`).join('');

  enableDragSort(box, '.tag-pill[data-sort-id]', 'x', async (ids) => {
    await saveOrder(apiPath === 'vendors' ? 'vendors' : 'discount_groups', ids);
    loadPricingPanel();
  });

  box.querySelectorAll('[data-rename]').forEach((btn) => btn.addEventListener('click', async () => {
    const cur = list.find((x) => x.id === +btn.dataset.rename);
    const name = prompt('新名稱：', cur.name);
    if (!name || !name.trim() || name.trim() === cur.name) return;
    try {
      await Api.put(`/api/admin/${apiPath}/${cur.id}`, { name: name.trim() }, true);
      showToast('已改名', 'success');
      loadPricingPanel();
      loadCatalogManagement();
    } catch (err) { showToast(err.message, 'error'); }
  }));

  box.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
    const cur = list.find((x) => x.id === +btn.dataset.remove);
    const warn = apiPath === 'vendors'
      ? `刪除廠商「${cur.name}」會一併刪除它所有月份的折數設定（已存的訂單報價不受影響），確定嗎？`
      : `刪除折扣群組「${cur.name}」會刪除所有月份的折數，${cur.usage_count} 個規格會變成「未指定群組」，確定嗎？`;
    if (!confirm(warn)) return;
    try {
      await Api.del(`/api/admin/${apiPath}/${cur.id}`, true);
      showToast('已刪除', 'success');
      loadPricingPanel();
      loadCatalogManagement();
    } catch (err) { showToast(err.message, 'error'); }
  }));
}

// 折扣群組：名稱 + 配合廠商（勾選）+ 主要廠商（估價時預設帶入的那一家）
function renderGroupList() {
  const box = document.getElementById('group-list');
  if (!discountGroups.length) {
    box.innerHTML = '<p class="small-note">還沒有折扣群組，先在上面新增，例如「PVC 管」「鋼管」。</p>';
    return;
  }
  if (!vendors.length) {
    box.innerHTML = '<p class="small-note">請先在左邊建立廠商，才能設定每個群組的配合廠商。</p>';
    return;
  }
  box.innerHTML = discountGroups.map((g) => {
    const linked = g.vendors || [];
    return `
    <div class="group-card" data-group="${g.id}">
      <div class="group-card-head">
        <strong>${escapeHtml(g.name)}</strong>
        <span class="usage">${g.usage_count} 個規格</span>
        <span style="flex:1;"></span>
        <button class="link-btn" data-rename="${g.id}">改名</button>
        <button class="link-btn danger" data-remove="${g.id}">刪除</button>
      </div>
      <div class="group-vendor-list">
        ${vendors.map((v) => {
          const link = linked.find((l) => l.vendor_id === v.id);
          return `<label class="group-vendor-row">
            <input type="checkbox" class="gv-check" data-vendor="${v.id}" ${link ? 'checked' : ''}>
            <span>${escapeHtml(v.name)}</span>
            <label class="primary-pick"><input type="radio" name="primary-${g.id}" class="gv-primary" data-vendor="${v.id}" ${link && link.is_primary ? 'checked' : ''}> 主要</label>
          </label>`;
        }).join('')}
      </div>
      <button class="btn btn-secondary btn-sm save-gv-btn" data-group="${g.id}">儲存配合廠商</button>
    </div>`;
  }).join('');

  box.querySelectorAll('.save-gv-btn').forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('.group-card');
    const list = [...card.querySelectorAll('.gv-check')].filter((c) => c.checked).map((c) => ({
      vendor_id: +c.dataset.vendor,
      is_primary: card.querySelector(`.gv-primary[data-vendor="${c.dataset.vendor}"]`).checked,
    }));
    try {
      await Api.put(`/api/admin/discount-groups/${btn.dataset.group}/vendors`, { vendors: list }, true);
      showToast('配合廠商已儲存', 'success');
      loadPricingPanel();
    } catch (err) { showToast(err.message, 'error'); }
  }));

  // 勾掉的廠商不能同時是主要廠商
  box.querySelectorAll('.gv-check').forEach((c) => c.addEventListener('change', () => {
    if (!c.checked) {
      const radio = c.closest('.group-card').querySelector(`.gv-primary[data-vendor="${c.dataset.vendor}"]`);
      if (radio.checked) radio.checked = false;
    }
  }));
  box.querySelectorAll('.gv-primary').forEach((r) => r.addEventListener('change', () => {
    if (r.checked) r.closest('.group-card').querySelector(`.gv-check[data-vendor="${r.dataset.vendor}"]`).checked = true;
  }));

  box.querySelectorAll('[data-rename]').forEach((btn) => btn.addEventListener('click', async () => {
    const cur = discountGroups.find((x) => x.id === +btn.dataset.rename);
    const name = prompt('新名稱：', cur.name);
    if (!name || !name.trim() || name.trim() === cur.name) return;
    try {
      await Api.put(`/api/admin/discount-groups/${cur.id}`, { name: name.trim() }, true);
      loadPricingPanel(); loadCatalogManagement();
    } catch (err) { showToast(err.message, 'error'); }
  }));
  box.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
    const cur = discountGroups.find((x) => x.id === +btn.dataset.remove);
    if (!confirm(`刪除折扣群組「${cur.name}」會一併刪除它所有月份的折數與配合廠商設定，${cur.usage_count} 個規格會變成「未指定群組」，確定嗎？`)) return;
    try {
      await Api.del(`/api/admin/discount-groups/${cur.id}`, true);
      loadPricingPanel(); loadCatalogManagement();
    } catch (err) { showToast(err.message, 'error'); }
  }));
}

async function addNameEntry(apiPath, inputId) {
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  if (!name) return;
  try {
    await Api.post(`/api/admin/${apiPath}`, { name }, true);
    input.value = '';
    showToast('已新增', 'success');
    loadPricingPanel();
    if (apiPath === 'discount-groups') loadCatalogManagement();
  } catch (err) { showToast(err.message, 'error'); }
}

async function loadDiscountGrid() {
  const grid = document.getElementById('disc-grid');
  const status = document.getElementById('disc-status');
  const month = document.getElementById('disc-month').value;
  if (!month) return;
  if (!vendors.length || !discountGroups.length) {
    grid.innerHTML = '<p class="small-note">請先在上方建立至少一個廠商與一個折扣群組。</p>';
    status.textContent = '';
    return;
  }
  const withVendors = discountGroups.filter((g) => (g.vendors || []).length);
  if (!withVendors.length) {
    grid.innerHTML = '<p class="small-note">每個折扣群組都還沒設定配合廠商，請先在上方的群組卡片裡勾選。</p>';
    status.textContent = '';
    return;
  }

  try {
    const data = await Api.get(`/api/admin/discounts?month=${month}`, true);
    const find = (g, v) => data.entries.find((e) => e.group_id === g && e.vendor_id === v);
    let own = 0, inherited = 0, blank = 0;

    grid.innerHTML = `<div class="disc-cards">${withVendors.map((g) => `
      <div class="disc-card">
        <div class="disc-card-head">${escapeHtml(g.name)}</div>
        ${g.vendors.map((v) => {
          const e = find(g.id, v.vendor_id);
          if (e && !e.inherited) own++; else if (e) inherited++; else blank++;
          return `<div class="disc-row">
            <span class="disc-vendor">${escapeHtml(v.name)}${v.is_primary ? '<span class="primary-tag">主要</span>' : ''}</span>
            <input type="text" inputmode="decimal" class="mini-input disc-cell ${e && e.inherited ? 'inherited' : ''}"
              data-group="${g.id}" data-vendor="${v.vendor_id}" value="${e ? e.discount : ''}"
              title="${e && e.inherited ? `沿用 ${e.month}` : ''}" placeholder="—">
            <span class="disc-unit">折</span>
          </div>`;
        }).join('')}
      </div>`).join('')}</div>`;

    status.textContent = own
      ? `本月已設定 ${own} 筆${inherited ? `，${inherited} 筆沿用前月` : ''}${blank ? `，${blank} 筆未填` : ''}`
      : (inherited ? `⚠️ ${month} 尚未儲存，畫面數字沿用前面月份` : `${month} 尚無任何折數`);

    grid.querySelectorAll('.disc-cell').forEach((inp) => inp.addEventListener('input', () => inp.classList.remove('inherited')));
  } catch (err) {
    grid.innerHTML = `<p class="small-note">${escapeHtml(err.message)}</p>`;
  }
}

async function saveDiscountGrid() {
  const month = document.getElementById('disc-month').value;
  const cells = [...document.querySelectorAll('#disc-grid .disc-cell')];
  if (!month || !cells.length) return;
  for (const c of cells) {
    const v = c.value.trim();
    if (v && !(Number(v) >= 0)) {
      c.focus();
      return showToast(`折數「${v}」不是有效的數字`, 'error');
    }
  }
  const entries = cells.map((c) => ({ group_id: +c.dataset.group, vendor_id: +c.dataset.vendor, discount: c.value.trim() }));
  try {
    await Api.put('/api/admin/discounts', { month, entries }, true);
    showToast(`${month} 折數已儲存`, 'success');
    loadDiscountGrid();
  } catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// 案場統計（當月各案場材料與預估金額）
// ============================================================
function bindReportPanel() {
  const m = document.getElementById('report-month');
  m.value = currentTaipeiMonth();
  m.addEventListener('change', loadReportPanel);
}

let reportSites = [];

async function loadReportPanel() {
  const chart = document.getElementById('report-chart');
  const status = document.getElementById('report-status');
  const month = document.getElementById('report-month').value;
  document.getElementById('report-detail-card').style.display = 'none';
  if (!month) return;
  chart.innerHTML = '<p class="small-note">載入中…</p>';
  try {
    const data = await Api.get(`/api/admin/site-summary?month=${month}`, true);
    reportSites = data.sites;
    if (!reportSites.length) {
      chart.innerHTML = '<div class="empty-state"><div class="icon">📭</div>這個月還沒有叫料紀錄</div>';
      status.textContent = '';
      return;
    }
    const total = reportSites.reduce((sum, s) => sum + s.total, 0);
    const unpriced = reportSites.reduce((sum, s) => sum + s.unpriced_count, 0);
    status.textContent = `${reportSites.length} 個案場有叫料，合計 NT$ ${money(total)}`
      + (unpriced ? `（另有 ${unpriced} 項尚未報價，未計入金額）` : '');
    chart.innerHTML = renderBarChart(reportSites);
    chart.querySelectorAll('.bar-hit').forEach((el) => el.addEventListener('click', () => showSiteDetail(+el.dataset.index)));
  } catch (err) {
    chart.innerHTML = `<p class="small-note">${escapeHtml(err.message)}</p>`;
  }
}

// 用 SVG 自己畫長條圖：Y 軸每 1000 一格，只畫當月有叫料的案場
function renderBarChart(sites) {
  const gridStep = 1000;
  const maxTotal = Math.max(...sites.map((s) => s.total), gridStep);
  const topValue = Math.ceil(maxTotal / gridStep) * gridStep;
  const gridCount = topValue / gridStep;

  const barW = 46, gap = 26, padLeft = 78, padRight = 20, padTop = 24, labelH = 64;
  const plotH = Math.max(240, Math.min(gridCount, 40) * 14);
  const width = padLeft + padRight + sites.length * (barW + gap);
  const height = padTop + plotH + labelH;
  const y = (v) => padTop + plotH - (v / topValue) * plotH;

  // 格線太密時只在整數倍標數字，避免文字疊在一起
  const labelEvery = Math.ceil(gridCount / 10);
  let grid = '';
  for (let i = 0; i <= gridCount; i++) {
    const gy = y(i * gridStep);
    grid += `<line x1="${padLeft - 6}" y1="${gy}" x2="${width - padRight}" y2="${gy}" stroke="var(--border)" stroke-width="1"${i % labelEvery ? ' stroke-dasharray="2 4"' : ''}></line>`;
    if (i % labelEvery === 0) {
      grid += `<text x="${padLeft - 10}" y="${gy + 4}" text-anchor="end" font-size="11" fill="var(--text-faint)">${(i * gridStep).toLocaleString('zh-TW')}</text>`;
    }
  }

  const bars = sites.map((s, i) => {
    const x = padLeft + i * (barW + gap) + gap / 2;
    const barY = y(s.total);
    const h = Math.max(padTop + plotH - barY, s.total > 0 ? 2 : 0);
    const short = s.site_name.length > 7 ? `${s.site_name.slice(0, 7)}…` : s.site_name;
    return `
      <g class="bar-hit" data-index="${i}" style="cursor:pointer;">
        <title>${escapeHtml(s.site_name)}：NT$ ${money(s.total)}（${s.order_count} 張單）</title>
        <rect x="${x}" y="${padTop}" width="${barW}" height="${plotH}" fill="transparent"></rect>
        <rect x="${x}" y="${barY}" width="${barW}" height="${h}" rx="3" fill="#1D2C6F"></rect>
        <text x="${x + barW / 2}" y="${barY - 6}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${money(s.total).replace('.00', '')}</text>
        <text x="${x + barW / 2}" y="${padTop + plotH + 18}" text-anchor="middle" font-size="11.5" fill="var(--text)">${escapeHtml(short)}</text>
        ${s.unpriced_count ? `<text x="${x + barW / 2}" y="${padTop + plotH + 34}" text-anchor="middle" font-size="10.5" fill="var(--danger)">${s.unpriced_count} 項未報價</text>` : ''}
      </g>`;
  }).join('');

  return `<div style="overflow-x:auto;"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${grid}
      <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" stroke="var(--text-faint)"></line>
      <text x="6" y="${padTop - 8}" font-size="11" fill="var(--text-faint)">金額 (NT$)</text>
      ${bars}
    </svg></div>`;
}

function showSiteDetail(index) {
  const site = reportSites[index];
  if (!site) return;
  const card = document.getElementById('report-detail-card');
  document.getElementById('report-detail-title').textContent =
    `${site.site_name}　${site.order_count} 張單　合計 NT$ ${money(site.total)}`;
  document.getElementById('report-detail-table').innerHTML = `
    <thead><tr><th>材料</th><th>規格</th><th style="text-align:center;">數量</th><th style="text-align:right;">金額</th></tr></thead>
    <tbody>${site.items.map((it) => `
      <tr>
        <td>${escapeHtml(it.item_name)}</td>
        <td>${escapeHtml([it.spec, it.color].filter(Boolean).join(' / '))}</td>
        <td style="text-align:center;">${it.quantity} ${escapeHtml(it.unit || '')}</td>
        <td style="text-align:right;">${it.unpriced_count ? '<span class="price-missing">未報價</span>' : money(it.amount)}</td>
      </tr>`).join('')}</tbody>`;
  card.style.display = '';
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

    list.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => {
      openApproveModal(reqs.find((x) => x.id === +btn.dataset.approve));
    }));
    list.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => reviewRequest(btn.dataset.reject, 'rejected')));
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div>${escapeHtml(err.message)}</div>`;
  }
}

async function reviewRequest(id, status) {
  const note = prompt('拒絕原因（選填）：', '') || '';
  try {
    await Api.put(`/api/admin/special-requests/${id}`, { status, reviewer_note: note }, true);
    loadSpecialReview();
    refreshSpecialBadge();
    showToast('已拒絕申請', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------- 核准 → 直接轉成一張叫料單（進入歷史紀錄的「收單」） ----------
function openApproveModal(r) {
  if (!r) return;
  document.getElementById('approve-request-id').value = r.id;
  document.getElementById('approve-summary').textContent =
    `申請 #${String(r.id).padStart(5, '0')}　${r.item_name} x${r.quantity}　申請人：${r.requester_name}`;
  const siteSel = document.getElementById('approve-site');
  siteSel.innerHTML = '<option value="">（不指定）</option>'
    + sites.map((x) => `<option value="${escapeAttr(x.name)}" data-address="${escapeAttr(x.address || '')}">${escapeHtml(x.name)}</option>`).join('');
  document.getElementById('approve-need-date').value = '';
  document.getElementById('approve-note').value = '';
  document.getElementById('approve-modal').style.display = 'flex';
}

function bindApproveModal() {
  document.getElementById('approve-cancel').addEventListener('click', () => {
    document.getElementById('approve-modal').style.display = 'none';
  });
  document.getElementById('approve-submit').addEventListener('click', async () => {
    const id = document.getElementById('approve-request-id').value;
    const siteSel = document.getElementById('approve-site');
    const payload = {
      status: 'approved',
      reviewer_note: document.getElementById('approve-note').value.trim(),
      site_name: siteSel.value,
      site_address: siteSel.selectedOptions[0] ? (siteSel.selectedOptions[0].dataset.address || '') : '',
      need_date: document.getElementById('approve-need-date').value || null,
    };
    try {
      const result = await Api.put(`/api/admin/special-requests/${id}`, payload, true);
      document.getElementById('approve-modal').style.display = 'none';
      showToast(`已核准，並建立叫料單 #${String(result.order_id).padStart(5, '0')}`, 'success');
      loadSpecialReview();
      refreshSpecialBadge();
      loadHistoryPanel();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

// 側邊欄「特殊採購審核」旁的紅色待辦圈圈
async function refreshSpecialBadge() {
  try {
    const { count } = await Api.get('/api/admin/special-requests/pending-count', true);
    const badge = document.getElementById('special-badge');
    badge.textContent = count;
    badge.style.display = count ? 'inline-flex' : 'none';
  } catch (err) { /* 徽章載入失敗不影響其他操作 */ }
}

// ============================================================
// 歷史紀錄
// ============================================================
function bindHistoryPanel() {
  document.getElementById('ah-search').addEventListener('click', loadHistoryPanel);
  document.getElementById('ah-export').addEventListener('click', exportCsv);
}

const ORDER_STATUS_LABEL = {
  submitted: '收單',
  sent: '送單',
  issue: '現場回報異常',
  received: '現場已收貨，待確認',
  closed: '結案',
  purchasing: '送單', // 舊資料
  vendor: '送單',     // 舊資料
};
const ORDER_STATUS_CLASS = {
  submitted: 'badge-pending',
  sent: 'badge-pending',
  issue: 'badge-issue',
  received: 'badge-pending',
  closed: 'badge-closed',
  purchasing: 'badge-pending',
  vendor: 'badge-pending',
};
// 四個頁籤：收單 / 送單 / 異常 / 結案，另外一個「已作廢」放最後
const HISTORY_TABS = [
  { key: 'submitted', label: '收單', statuses: ['submitted'] },
  { key: 'sent', label: '送單', statuses: ['sent', 'purchasing', 'vendor', 'received'] },
  { key: 'issue', label: '異常', statuses: ['issue'] },
  { key: 'closed', label: '結案', statuses: ['closed'] },
  { key: 'voided', label: '已作廢', statuses: [] },
];
// 每個狀態底下，後台可以按的「下一步」按鈕
const ORDER_NEXT_STEPS = {
  submitted: [{ status: 'sent', label: '→ 送單' }],
  sent: [{ status: 'closed', label: '✓ 直接結案' }],
  purchasing: [{ status: 'sent', label: '→ 送單' }],
  vendor: [{ status: 'closed', label: '✓ 直接結案' }],
  issue: [{ status: 'closed', label: '✓ 處理完成，結案' }],
  received: [{ status: 'closed', label: '✓ 確認收貨，結案' }],
  closed: [{ status: 'sent', label: '↩ 退回送單' }],
};

let adminOrders = [];
let adminActiveTab = 'submitted';

// 一張單可能跨廠商：整理出這張單用到的所有廠商
function vendorSummary(o) {
  const names = [...new Set(o.items.map((it) => it.vendor_name).filter(Boolean))];
  return names.length ? names.join('、') : (o.vendor || '');
}

function money(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 品項清單與報價合併成一張表：品項 / 數量 / 廠商 / 牌價 / 折數 / 單價 / 小計
function renderOrderTable(o) {
  const ro = o.voided ? ' disabled' : ''; // 作廢的單只能看，不能改報價
  const rows = o.items.map((it) => {
    const sub = (it.unit_price !== null && it.unit_price !== undefined && it.unit_price !== '')
      ? Number(it.unit_price) * it.quantity : null;
    return `
      <tr${it.has_issue ? ' class="row-issue"' : ''}>
        <td>
          ${it.has_issue ? '<span style="color:var(--danger); font-weight:700;">⚠️ </span>' : ''}${escapeHtml(it.item_name)}
          ${[it.spec, it.color].filter(Boolean).map((x) => `· ${escapeHtml(x)}`).join(' ')}
          ${it.note ? `<div class="small-note" style="margin:2px 0 0;">備註：${escapeHtml(it.note)}</div>` : ''}
          <div class="price-hint" data-item="${it.id}"></div>
        </td>
        <td style="text-align:center; white-space:nowrap;">${it.quantity} ${escapeHtml(it.unit || '')}</td>
        <td><select class="mini-input price-vendor" data-item="${it.id}" style="min-width:110px;"${ro}>
          <option value="">—</option>
          ${vendors.map((v) => `<option value="${v.id}" ${v.id === it.vendor_id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
        </select></td>
        <td><input type="number" step="0.01" min="0" class="mini-input price-list" data-item="${it.id}" value="${it.list_price ?? ''}" placeholder="牌價" style="width:92px;"${ro}></td>
        <td><input type="number" step="0.01" min="0" class="mini-input price-disc" data-item="${it.id}" value="${it.discount === null || it.discount === undefined ? '' : Number(it.discount)}" placeholder="75" style="width:72px;"${ro}></td>
        <td class="price-unit" data-item="${it.id}" style="text-align:right;">${money(it.unit_price)}</td>
        <td class="price-sub" data-item="${it.id}" style="text-align:right;">${money(sub)}</td>
      </tr>`;
  }).join('');

  const total = o.items.reduce((sum, it) => {
    const up = Number(it.unit_price);
    return sum + (isNaN(up) || it.unit_price === null ? 0 : up * it.quantity);
  }, 0);

  return `
    <div style="overflow-x:auto; margin-top:10px;">
      <table class="table pricing-table" data-id="${o.id}" style="font-size:12.5px;">
        <thead><tr>
          <th>品項</th><th style="text-align:center;">數量</th><th>廠商</th><th>牌價</th>
          <th>折數 %<br><span style="font-weight:400; font-size:11px;">(75 折填 75)</span></th>
          <th style="text-align:right;">單價</th><th style="text-align:right;">小計</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="6" style="text-align:right; font-weight:700;">預估總計</td>
          <td style="text-align:right; font-weight:700;">NT$ <span class="price-total" data-id="${o.id}">${money(total)}</span></td>
        </tr></tfoot>
      </table>
    </div>
    ${o.voided ? '' : `<div class="ticket-row" style="gap:8px; flex-wrap:wrap; margin-top:8px;">
      <button class="btn btn-secondary btn-sm autofill-pricing-btn" data-id="${o.id}">📥 自動帶入廠商＋牌價＋折數</button>
      <button class="btn btn-primary btn-sm save-pricing-btn" data-id="${o.id}">儲存報價</button>
    </div>`}
    <p class="small-note">「自動帶入」會依每個品項的折扣群組找出配合廠商（多家時取主要廠商），再帶入牌價與該廠商當月折數；廠商可逐項改。單價 = 牌價 × 折數 ÷ 100。</p>
  `;
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
    const [orderList, vendorList] = await Promise.all([
      Api.get(`/api/admin/orders?${params.toString()}`, true),
      Api.get('/api/admin/vendors', true),
    ]);
    vendors = vendorList;
    adminOrders = orderList;
    renderHistoryTabs();
    renderHistoryList();
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div>${escapeHtml(err.message)}</div>`;
  }
}

function ordersOfTab(key) {
  if (key === 'voided') return adminOrders.filter((o) => o.voided);
  const tab = HISTORY_TABS.find((t) => t.key === key);
  return adminOrders.filter((o) => !o.voided && tab.statuses.includes(o.status || 'submitted'));
}

function renderHistoryTabs() {
  const wrap = document.getElementById('ah-status-tabs');
  wrap.className = 'status-tabs';
  wrap.innerHTML = HISTORY_TABS.map((t) => {
    const list = ordersOfTab(t.key);
    // 送單頁籤另外提醒：現場已回報收貨、等後台確認的張數
    const waiting = t.key === 'sent' ? list.filter((o) => o.status === 'received').length : 0;
    const countClass = t.key === 'issue' && list.length ? ' danger' : '';
    return `<button type="button" class="status-tab${t.key === adminActiveTab ? ' active' : ''}" data-tab="${t.key}">
      ${t.label}<span class="count${countClass}">${list.length}</span>
      ${waiting ? `<span class="count alert">待確認 ${waiting}</span>` : ''}
    </button>`;
  }).join('');
  wrap.querySelectorAll('.status-tab').forEach((btn) => btn.addEventListener('click', () => {
    adminActiveTab = btn.dataset.tab;
    renderHistoryTabs();
    renderHistoryList();
  }));
}

function renderHistoryList() {
  const list = document.getElementById('admin-history-list');
  const orders = ordersOfTab(adminActiveTab);
  if (!orders.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📭</div>這個狀態底下沒有叫料紀錄</div>`;
    return;
  }

  list.innerHTML = orders.map((o) => {
    const st = o.status || 'submitted';
    const nextSteps = ORDER_NEXT_STEPS[st] || [];
    const itemCount = o.items.reduce((sum, it) => sum + it.quantity, 0);
    const total = o.items.reduce((sum, it) => {
      const up = Number(it.unit_price);
      return sum + (isNaN(up) || it.unit_price === null ? 0 : up * it.quantity);
    }, 0);
    return `
    <div class="ticket${o.voided ? ' ticket-voided' : ''}${!o.voided && st === 'received' ? ' ticket-waiting' : ''}${!o.voided && st === 'issue' ? ' ticket-issue' : ''}" data-order-id="${o.id}">
      <div class="ticket-summary">
        <div>
          <span class="ticket-no">單號 #${String(o.id).padStart(5, '0')}</span>
          <span class="badge ${o.voided ? 'badge-voided' : ORDER_STATUS_CLASS[st]}" style="margin-left:8px;">${o.voided ? '已作廢' : ORDER_STATUS_LABEL[st]}</span>
          <div class="ticket-row sub" style="margin-top:4px;">
            ${escapeHtml(o.requester_name)}　${escapeHtml(o.site_name || '-')}　共 ${o.items.length} 項 / ${itemCount} 件　預估 NT$ ${money(total) || '0.00'}　${escapeHtml(o.created_at)}
          </div>
        </div>
        <span class="expand-icon">▾</span>
      </div>
      <div class="ticket-detail">
        <div class="ticket-row"><span class="name">${escapeHtml(o.requester_name)}　<span class="sub">${escapeHtml(o.title)}${o.phone ? ' · ' + escapeHtml(o.phone) : ''}</span></span></div>
        <div class="ticket-row sub">案場：${escapeHtml(o.site_name || '-')}　需求日：${escapeHtml(o.need_date || '-')}　類別：${escapeHtml(o.delivery_type || '-')}</div>
        <div class="ticket-row sub">送貨地址：${escapeHtml(o.site_address || '-')}　施工用途：${escapeHtml(o.purpose || '-')}</div>
        <div class="ticket-row sub">廠商：${escapeHtml(vendorSummary(o)) || '（尚未指定，請在下表逐項選擇）'}</div>
        ${o.note ? `<div class="ticket-row sub">訂單備註：${escapeHtml(o.note)}</div>` : ''}
        ${o.issue_note ? `<div class="ticket-row sub" style="color:var(--danger);">⚠️ 現場回報異常：${escapeHtml(o.issue_note)}</div>` : ''}
        ${st === 'received' && !o.voided ? `<div class="ticket-row sub" style="color:#b8860b;">📦 現場已回報收貨無異常，請確認後結案</div>` : ''}
        ${o.voided ? `<div class="ticket-row sub">🚫 已作廢：${escapeHtml(o.void_reason || '')}</div>` : ''}

        ${renderOrderTable(o)}

        ${(st === 'issue' || o.purchase_reply) && !o.voided ? `
          <div class="field" style="margin-top:8px;">
            <label>採購處理內容</label>
            <textarea class="reply-input" data-id="${o.id}" placeholder="說明如何處理這個異常…">${escapeHtml(o.purchase_reply || '')}</textarea>
            <button class="btn btn-secondary btn-sm save-reply-btn" data-id="${o.id}">儲存處理內容</button>
          </div>
        ` : ''}

        <div class="ticket-row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
          ${o.voided ? '' : nextSteps.map((x) => `<button class="btn btn-primary btn-sm status-btn" data-id="${o.id}" data-status="${x.status}">${x.label}</button>`).join('')}
          <button class="btn btn-secondary btn-sm print-order-btn" data-id="${o.id}" data-mode="vendor">🖨️ 廠商訂購單（不含價格）</button>
          <button class="btn btn-secondary btn-sm print-order-btn" data-id="${o.id}" data-mode="internal">🖨️ 內部核簽單（含價格）</button>
          ${o.voided
            ? `<button class="btn btn-secondary btn-sm restore-btn" data-id="${o.id}">↩ 還原</button>`
            : `<button class="btn btn-danger btn-sm void-btn" data-id="${o.id}">🚫 作廢</button>`}
        </div>
      </div>
    </div>`;
  }).join('');

  // 點摘要列展開／收合；表單元件上的點擊不要觸發收合
  list.querySelectorAll('.ticket-summary').forEach((el) => el.addEventListener('click', () => {
    el.closest('.ticket').classList.toggle('expanded');
  }));
  bindHistoryActions(list);
}

function bindHistoryActions(list) {
  list.querySelectorAll('.void-btn').forEach((btn) => btn.addEventListener('click', async () => {
    const reason = prompt('請填寫作廢原因（例如：測試單、重複下單、下錯案場）：', '');
    if (reason === null) return;
    if (!reason.trim()) return showToast('請填寫作廢原因', 'error');
    try {
      await Api.put(`/api/admin/orders/${btn.dataset.id}/void`, { reason: reason.trim() }, true);
      showToast('已作廢，可在「已作廢」頁籤還原', 'success');
      loadHistoryPanel();
      loadReportPanel();
    } catch (err) { showToast(err.message, 'error'); }
  }));

  list.querySelectorAll('.restore-btn').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('要把這筆訂單還原回原本的狀態嗎？')) return;
    try {
      await Api.put(`/api/admin/orders/${btn.dataset.id}/restore`, {}, true);
      showToast('已還原', 'success');
      loadHistoryPanel();
      loadReportPanel();
    } catch (err) { showToast(err.message, 'error'); }
  }));

  list.querySelectorAll('.save-reply-btn').forEach((btn) => btn.addEventListener('click', async () => {
    const ta = list.querySelector(`.reply-input[data-id="${btn.dataset.id}"]`);
    try {
      await Api.put(`/api/admin/orders/${btn.dataset.id}/purchase-reply`, { purchase_reply: ta.value.trim() }, true);
      showToast('處理內容已儲存', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));

  list.querySelectorAll('.status-btn').forEach((btn) => btn.addEventListener('click', async () => {
    if (btn.dataset.status === 'closed' && !confirm('確定要結案嗎？結案後會寄送通知信給訂購人。')) return;
    try {
      await Api.put(`/api/admin/orders/${btn.dataset.id}/status`, { status: btn.dataset.status }, true);
      showToast('訂單狀態已更新', 'success');
      loadHistoryPanel();
    } catch (err) { showToast(err.message, 'error'); }
  }));

  list.querySelectorAll('.print-order-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.open(`print-order.html?id=${btn.dataset.id}&mode=${btn.dataset.mode}`, '_blank');
    });
  });

  // 報價：牌價/折數改變時，即時算出單價、小計與總計
  list.querySelectorAll('.pricing-table').forEach((table) => {
    const recalc = () => {
      let total = 0;
      table.querySelectorAll('tbody tr').forEach((tr) => {
        const listInput = tr.querySelector('.price-list');
        const discInput = tr.querySelector('.price-disc');
        const qty = parseFloat(tr.children[1].textContent) || 0;
        const l = parseFloat(listInput.value);
        const d = parseFloat(discInput.value);
        const unit = (!isNaN(l) && !isNaN(d)) ? Math.round(l * d) / 100 : null;
        tr.querySelector('.price-unit').textContent = unit === null ? '' : money(unit);
        const sub = unit === null ? null : unit * qty;
        tr.querySelector('.price-sub').textContent = sub === null ? '' : money(sub);
        if (sub !== null) total += sub;
      });
      const totalEl = list.querySelector(`.price-total[data-id="${table.dataset.id}"]`);
      if (totalEl) totalEl.textContent = money(total);
    };
    table.querySelectorAll('.price-list, .price-disc').forEach((inp) => inp.addEventListener('input', recalc));
  });

  list.querySelectorAll('.autofill-pricing-btn').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const table = list.querySelector(`.pricing-table[data-id="${id}"]`);
    const hasExisting = [...table.querySelectorAll('.price-list, .price-disc')].some((inp) => inp.value !== '');
    if (hasExisting && !confirm('帶入會覆蓋目前表格裡已填的廠商、牌價與折數（尚未儲存前都可以再改），確定嗎？')) return;
    try {
      const result = await Api.get(`/api/admin/orders/${id}/price-suggest`, true);
      let problems = 0;
      result.items.forEach((s) => {
        const listInp = table.querySelector(`.price-list[data-item="${s.id}"]`);
        if (!listInp) return;
        const discInp = table.querySelector(`.price-disc[data-item="${s.id}"]`);
        const vendorSel = table.querySelector(`.price-vendor[data-item="${s.id}"]`);
        const hint = table.querySelector(`.price-hint[data-item="${s.id}"]`);
        listInp.value = s.list_price ?? '';
        discInp.value = s.discount ?? '';
        if (s.vendor_id) vendorSel.value = s.vendor_id;
        const notes = [];
        if (s.group_name) notes.push(s.group_name);
        if (s.vendor_name && s.vendor_source === 'group') notes.push(`主要廠商：${s.vendor_name}`);
        if (s.discount_month && s.discount_month !== result.order_month) notes.push(`沿用 ${s.discount_month} 折數`);
        if (s.problem) { notes.push(`⚠️ ${s.problem}`); problems++; }
        hint.textContent = notes.join('・');
        hint.classList.toggle('warn', !!s.problem);
      });
      listInpDispatch(table);
      showToast(problems ? `已帶入，${problems} 項需要手動補填` : '已帶入，確認後請按「儲存報價」', problems ? 'error' : 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));

  list.querySelectorAll('.save-pricing-btn').forEach((btn) => btn.addEventListener('click', async () => {
    const table = list.querySelector(`.pricing-table[data-id="${btn.dataset.id}"]`);
    const items = [...table.querySelectorAll('tbody tr')].map((tr) => ({
      id: +tr.querySelector('.price-list').dataset.item,
      list_price: tr.querySelector('.price-list').value,
      discount: tr.querySelector('.price-disc').value,
      vendor_id: tr.querySelector('.price-vendor').value || null,
    }));
    try {
      await Api.put(`/api/admin/orders/${btn.dataset.id}/pricing`, { items }, true);
      showToast('報價已儲存', 'success');
      // 重新查詢會收合卡片，所以只更新這筆在記憶體裡的資料與畫面上的摘要
      const fresh = await Api.get(`/api/admin/orders/${btn.dataset.id}`, true);
      const idx = adminOrders.findIndex((o) => o.id === fresh.id);
      if (idx >= 0) adminOrders[idx] = fresh;
      const ticket = list.querySelector(`.ticket[data-order-id="${fresh.id}"]`);
      if (ticket) {
        const sub = ticket.querySelector('.ticket-summary .sub');
        const total = fresh.items.reduce((sum, it) => sum + (Number(it.unit_price) || 0) * it.quantity, 0);
        if (sub) sub.innerHTML = sub.innerHTML.replace(/預估 NT\$ [\d,.]+/, `預估 NT$ ${money(total)}`);
      }
    } catch (err) { showToast(err.message, 'error'); }
  }));
}

// 帶入後觸發一次 input 事件，讓單價、小計、總計重新計算
function listInpDispatch(table) {
  const first = table.querySelector('.price-list');
  if (first) first.dispatchEvent(new Event('input'));
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

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const root = document.getElementById('print-root');

  document.getElementById('print-btn').addEventListener('click', () => window.print());
  document.getElementById('close-btn').addEventListener('click', () => window.close());

  if (!id) {
    root.innerHTML = `<p style="text-align:center; padding:40px;">缺少訂單編號，請從歷史紀錄或送出成功畫面點「列印單據」進入。</p>`;
    return;
  }

  try {
    // mode=internal 內部核簽單（含價格）：必須是管理員，改走後台 API，沒有權限就不顯示
    // 其他一律當成 vendor 廠商訂購單（不含價格），走前台 API（前台 API 本身就不回傳價格）
    const showPrice = params.get('mode') === 'internal';
    let order;
    if (showPrice) {
      try {
        order = await Api.get(`/api/admin/orders/${id}`, true);
      } catch (e) {
        root.innerHTML = `<p style="text-align:center; padding:40px;">內部核簽單需要管理員權限，請先登入管理後台，再從後台的歷史紀錄點「內部核簽單」開啟。</p>`;
        return;
      }
    } else {
      order = await Api.get(`/api/orders/${id}`);
    }
    document.title = showPrice ? '列印訂購單（內部核簽）' : '列印訂購單（廠商）';
    if (showPrice) root.classList.add('with-price');

    if (showPrice) {
      // 內部核簽單：整張單一份，品項上多一欄廠商
      root.innerHTML = renderPrintHtml(order, order.items, true, null);
    } else {
      // 廠商訂購單：同一張叫料單可能跨廠商，依廠商拆成多張，各印各的
      const groups = splitByVendor(order.items);
      root.innerHTML = groups.map((g, i) => `
        <section class="doc-sheet"${i < groups.length - 1 ? ' style="break-after:page; page-break-after:always;"' : ''}>
          ${renderPrintHtml(order, g.items, false, groups.length > 1 ? g.name : (g.name || order.vendor || ''))}
        </section>`).join('');
      if (groups.length > 1) {
        document.getElementById('sheet-count').textContent = `這張叫料單跨 ${groups.length} 家廠商，已自動分成 ${groups.length} 張訂購單（列印時各自一頁）`;
      }
    }
  } catch (err) {
    root.innerHTML = `<p style="text-align:center; padding:40px;">載入失敗：${escapeHtml(err.message)}</p>`;
  }
});

// 依品項上的廠商分組；沒指定廠商的歸在「未指定廠商」，排在最後
function splitByVendor(items) {
  const map = new Map();
  items.forEach((it) => {
    const key = it.vendor_name || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  });
  const groups = [...map.entries()].map(([name, list]) => ({ name, items: list }));
  groups.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1));
  return groups;
}

function renderPrintHtml(order, items, showPrice, vendorLabel) {
  const docTitle = '太綺水電工程有限公司45149105';
  const orderNo = `#${String(order.id).padStart(5, '0')}`;
  const deliveryOrder = order.delivery_type === '訂貨' ? '☑' : '□';
  const deliverySelf = order.delivery_type === '自取' ? '☑' : '□';

  const money = (n) => (n === null || n === undefined || n === '')
    ? '' : Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let total = 0;
  const itemRows = items.map((it, i) => {
    const unit = (it.unit_price === null || it.unit_price === undefined || it.unit_price === '')
      ? null : Number(it.unit_price);
    const sub = unit === null ? null : unit * it.quantity;
    if (sub !== null) total += sub;
    return `
    <tr>
      <td class="cell-no">${i + 1}</td>
      <td>${escapeHtml(it.item_name)}</td>
      <td>${escapeHtml([it.spec, it.color].filter(Boolean).join(' / '))}</td>
      <td class="cell-qty">${it.quantity}</td>
      <td class="cell-unit">${escapeHtml(it.unit || '')}</td>
      ${showPrice ? `<td>${escapeHtml(it.vendor_name || '')}</td>
      <td class="cell-money">${money(it.list_price)}</td>
      <td class="cell-qty">${it.discount === null || it.discount === undefined || it.discount === '' ? '' : Number(it.discount)}</td>
      <td class="cell-money">${money(unit)}</td>
      <td class="cell-money">${money(sub)}</td>` : ''}
      <td>${escapeHtml(it.note || '')}</td>
    </tr>
  `;
  }).join('');

  const colCount = showPrice ? 11 : 6;
  const priceHead = showPrice
    ? '<th>廠商</th><th class="col-money">牌價</th><th class="col-qty">折數</th><th class="col-money">單價</th><th class="col-money">小計</th>'
    : '';
  const totalRow = showPrice
    ? `<tr><td colspan="${colCount - 2}" style="text-align:right; font-weight:700;">合計</td><td class="cell-money" style="font-weight:700;">${money(total)}</td><td></td></tr>`
    : '';

  return `
    <div class="doc-header">
      <img src="images/logo.png" alt="太綺水電 TaiChi EMP">
      <div class="doc-title">${escapeHtml(docTitle)}<div class="sub-line">訂購單　單號 ${orderNo}${showPrice ? '（內部核簽）' : ''}</div></div>
    </div>

    <table class="info-table">
      <tr>
        <th style="width:12%;">訂購人</th><td style="width:21%;">${escapeHtml(order.requester_name)}</td>
        <th style="width:12%;">聯絡手機</th><td style="width:21%;">${escapeHtml(order.phone || '')}</td>
        <th style="width:12%;">需求日</th><td>${escapeHtml(order.need_date || '')}</td>
      </tr>
      <tr>
        <th>案場名稱</th><td colspan="3">${escapeHtml(order.site_name || '')}</td>
        <th>施工用途</th><td>${escapeHtml(order.purpose || '')}</td>
      </tr>
      <tr>
        <th>送貨地址</th><td colspan="5">${escapeHtml(order.site_address || '')}</td>
      </tr>
      <tr>
        <th>廠商</th><td colspan="3">${escapeHtml(vendorLabel === null ? (order.vendor || '') : (vendorLabel || '未指定廠商'))}</td>
        <th>類別</th><td>${deliveryOrder}訂貨　${deliverySelf}自取</td>
      </tr>
    </table>

    <table class="item-table">
      <thead>
        <tr class="repeat-title"><th colspan="${colCount}"><img src="images/logo.png" alt="">${escapeHtml(docTitle)}　訂購單　單號 ${orderNo}</th></tr>
        <tr class="col-head">
          <th class="col-no">項次</th><th>名稱</th><th>規格</th><th class="col-qty">數量</th><th class="col-unit">單位</th>${priceHead}<th>備註</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${totalRow}
      </tbody>
    </table>
    <table class="footer-table">
      <tr><td colspan="${colCount}" class="remark-cell">備註：${escapeHtml(order.note || '')}</td></tr>
      <tr>
        <td colspan="${colCount}" style="padding:0;">
          <div class="sign-row">
            <div class="sign-box"><div class="sign-label">總經理</div><div class="sign-space"></div></div>
            <div class="sign-box"><div class="sign-label">成控部</div><div class="sign-space"></div></div>
            <div class="sign-box"><div class="sign-label">採購課</div><div class="sign-space"></div></div>
            <div class="sign-box"><div class="sign-label">工務部</div><div class="sign-space"></div></div>
          </div>
        </td>
      </tr>
    </table>
  `;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

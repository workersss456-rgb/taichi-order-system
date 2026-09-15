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
    const order = await Api.get(`/api/orders/${id}`);
    root.innerHTML = renderPrintHtml(order);
  } catch (err) {
    root.innerHTML = `<p style="text-align:center; padding:40px;">載入失敗：${escapeHtml(err.message)}</p>`;
  }
});

function renderPrintHtml(order) {
  const docTitle = '太綺水電工程有限公司45149105';
  const orderNo = `#${String(order.id).padStart(5, '0')}`;
  const deliveryOrder = order.delivery_type === '訂貨' ? '☑' : '□';
  const deliverySelf = order.delivery_type === '自取' ? '☑' : '□';

  const itemRows = order.items.map((it, i) => `
    <tr>
      <td class="cell-no">${i + 1}</td>
      <td>${escapeHtml(it.item_name)}</td>
      <td>${escapeHtml([it.spec, it.color].filter(Boolean).join(' / '))}</td>
      <td class="cell-qty">${it.quantity}</td>
      <td class="cell-unit">${escapeHtml(it.unit || '')}</td>
      <td>${escapeHtml(it.note || '')}</td>
    </tr>
  `).join('');

  return `
    <div class="doc-header">
      <img src="images/logo.png" alt="太綺水電 TaiChi EMP">
      <div class="doc-title">${escapeHtml(docTitle)}<div class="sub-line">訂購單　單號 ${orderNo}</div></div>
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
        <th>廠商</th><td colspan="3">${escapeHtml(order.vendor || '')}</td>
        <th>類別</th><td>${deliveryOrder}訂貨　${deliverySelf}自取</td>
      </tr>
    </table>

    <table class="item-table">
      <thead>
        <tr class="repeat-title"><th colspan="6"><img src="images/logo.png" alt="">${escapeHtml(docTitle)}　訂購單　單號 ${orderNo}</th></tr>
        <tr class="col-head">
          <th class="col-no">項次</th><th>名稱</th><th>規格</th><th class="col-qty">數量</th><th class="col-unit">單位</th><th>備註</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    <table class="footer-table">
      <tr><td colspan="6" class="remark-cell">備註：${escapeHtml(order.note || '')}</td></tr>
      <tr>
        <td colspan="6" style="padding:0;">
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

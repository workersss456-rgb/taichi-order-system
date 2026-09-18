const express = require('express');
const { pool } = require('../db');
const requireAdmin = require('../middleware/adminAuth');
const { notifyOrderStatusEvent } = require('../mailer');

const router = express.Router();

// 用來讓前端確認密碼是否正確（登入用）
router.post('/login', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

router.use(requireAdmin);

// ---------- 分類 ----------
router.post('/categories', async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '請輸入分類名稱' });
    const row = (await pool.query(
      'INSERT INTO categories (name, sort_order) VALUES ($1,$2) RETURNING *',
      [name.trim(), sort_order || 0]
    )).rows[0];
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '新增分類失敗' });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    const row = (await pool.query(
      'UPDATE categories SET name=$1, sort_order=$2 WHERE id=$3 RETURNING *',
      [name, sort_order || 0, req.params.id]
    )).rows[0];
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新分類失敗' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '刪除分類失敗' });
  }
});

// ---------- 子分類 ----------
router.post('/subcategories', async (req, res) => {
  try {
    const { category_id, name, sort_order } = req.body;
    if (!category_id) return res.status(400).json({ error: '請選擇所屬分類' });
    if (!name || !name.trim()) return res.status(400).json({ error: '請輸入子分類名稱' });
    const row = (await pool.query(
      'INSERT INTO subcategories (category_id, name, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [category_id, name.trim(), sort_order || 0]
    )).rows[0];
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '新增子分類失敗' });
  }
});

router.put('/subcategories/:id', async (req, res) => {
  try {
    const { name, sort_order, category_id } = req.body;
    const row = (await pool.query(
      'UPDATE subcategories SET name=$1, sort_order=$2, category_id=$3 WHERE id=$4 RETURNING *',
      [name, sort_order || 0, category_id, req.params.id]
    )).rows[0];
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新子分類失敗' });
  }
});

router.delete('/subcategories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM subcategories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '刪除子分類失敗' });
  }
});

// ---------- 品項 ----------
router.get('/items', async (req, res) => {
  try {
    // 管理後台要看到所有品項，包含下架的
    const items = (await pool.query('SELECT * FROM items ORDER BY sort_order, id')).rows;
    const priceRows = (await pool.query('SELECT item_id, spec, list_price, group_id FROM item_prices')).rows;
    res.json(items.map((it) => ({
      ...it,
      specs: JSON.parse(it.specs || '[]'),
      colors: JSON.parse(it.colors || '[]'),
      prices: priceRows.filter((p) => p.item_id === it.id)
        .map((p) => ({ spec: p.spec, list_price: p.list_price, group_id: p.group_id })),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '讀取品項失敗' });
  }
});

router.post('/items', async (req, res) => {
  try {
    const { subcategory_id, name, image_url, description, unit, specs, colors, sort_order } = req.body;
    if (!subcategory_id) return res.status(400).json({ error: '請選擇所屬子分類' });
    if (!name || !name.trim()) return res.status(400).json({ error: '請輸入品項名稱' });

    const item = (await pool.query(
      `INSERT INTO items (subcategory_id, name, image_url, description, unit, specs, colors, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        subcategory_id, name.trim(), image_url || '', description || '', unit || '個',
        JSON.stringify(specs || []), JSON.stringify(colors || []), sort_order || 0,
      ]
    )).rows[0];
    await saveItemPrices(item.id, specs || [], req.body.prices);
    res.status(201).json({ ...item, specs: JSON.parse(item.specs), colors: JSON.parse(item.colors) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '新增品項失敗' });
  }
});

router.put('/items/:id', async (req, res) => {
  try {
    const { subcategory_id, name, image_url, description, unit, specs, colors, sort_order, active } = req.body;
    const item = (await pool.query(
      `UPDATE items SET subcategory_id=$1, name=$2, image_url=$3, description=$4, unit=$5,
        specs=$6, colors=$7, sort_order=$8, active=$9 WHERE id=$10 RETURNING *`,
      [
        subcategory_id, name, image_url || '', description || '', unit || '個',
        JSON.stringify(specs || []), JSON.stringify(colors || []), sort_order || 0,
        active === undefined ? 1 : (active ? 1 : 0),
        req.params.id,
      ]
    )).rows[0];
    if (!item) return res.status(404).json({ error: '找不到這個品項' });
    await saveItemPrices(item.id, specs || [], req.body.prices);
    res.json({ ...item, specs: JSON.parse(item.specs), colors: JSON.parse(item.colors) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新品項失敗' });
  }
});

// 儲存品項的牌價設定：每個規格一組（牌價、折扣群組）；沒有規格的品項用空字串當規格
// prices 沒傳（undefined）代表這次沒有要改價格，不動既有資料
async function saveItemPrices(itemId, specs, prices) {
  if (!Array.isArray(prices)) return;
  const validSpecs = specs.length ? specs : [''];
  await pool.query(
    'DELETE FROM item_prices WHERE item_id = $1 AND NOT (spec = ANY($2::text[]))',
    [itemId, validSpecs]
  );
  for (const p of prices) {
    const spec = String(p.spec ?? '');
    if (!validSpecs.includes(spec)) continue;
    const listPrice = toNumberOrNull(p.list_price);
    const groupId = p.group_id ? Number(p.group_id) : null;
    if (listPrice === null && groupId === null) {
      await pool.query('DELETE FROM item_prices WHERE item_id = $1 AND spec = $2', [itemId, spec]);
      continue;
    }
    await pool.query(
      `INSERT INTO item_prices (item_id, spec, list_price, group_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, spec) DO UPDATE SET list_price = EXCLUDED.list_price, group_id = EXCLUDED.group_id`,
      [itemId, spec, listPrice, groupId]
    );
  }
}

function toNumberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

router.delete('/items/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '刪除品項失敗' });
  }
});

// ---------- 批次排序（拖曳排序用） ----------
// 傳入 { type: 'categories' | 'subcategories' | 'items', ids: [依畫面上新順序排列的 id] }
// 依陣列順序把 sort_order 重新編號成 1, 2, 3…，使用者就不用自己記數字。
router.put('/reorder', async (req, res) => {
  const { type, ids } = req.body;
  const allowed = { categories: 'categories', subcategories: 'subcategories', items: 'items', sites: 'sites', vendors: 'vendors', discount_groups: 'discount_groups' };
  const table = allowed[type];
  if (!table) return res.status(400).json({ error: '排序對象不正確' });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '沒有收到排序資料' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query(`UPDATE ${table} SET sort_order = $1 WHERE id = $2`, [i + 1, ids[i]]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '排序儲存失敗' });
  } finally {
    client.release();
  }
});

// ---------- 案場管理（名稱 + 送貨地址對照） ----------
router.get('/sites', async (req, res) => {
  try {
    const rows = (await pool.query('SELECT * FROM sites ORDER BY sort_order, id')).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '讀取案場清單失敗' });
  }
});

router.post('/sites', async (req, res) => {
  try {
    const { name, address, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '請輸入案場名稱' });
    const row = (await pool.query(
      'INSERT INTO sites (name, address, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), address || '', sort_order || 0]
    )).rows[0];
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '新增案場失敗' });
  }
});

router.put('/sites/:id', async (req, res) => {
  try {
    const { name, address, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '請輸入案場名稱' });
    const row = (await pool.query(
      'UPDATE sites SET name=$1, address=$2, sort_order=$3 WHERE id=$4 RETURNING *',
      [name.trim(), address || '', sort_order || 0, req.params.id]
    )).rows[0];
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新案場失敗' });
  }
});

router.delete('/sites/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '刪除案場失敗' });
  }
});

// ---------- 訂單廠商填寫（採購處理後填入，供列印單據使用） ----------
router.put('/orders/:id/vendor', async (req, res) => {
  try {
    const { vendor } = req.body;
    // 從廠商清單選的會帶 vendor_id，名稱以清單為準；沒選清單就只存文字（相容舊資料）
    const vendorId = req.body.vendor_id ? Number(req.body.vendor_id) : null;
    let vendorName = vendor || '';
    if (vendorId) {
      const v = (await pool.query('SELECT name FROM vendors WHERE id = $1', [vendorId])).rows[0];
      if (!v) return res.status(400).json({ error: '找不到這個廠商' });
      vendorName = v.name;
    }
    const row = (await pool.query(
      `UPDATE orders SET vendor=$1, vendor_id=$2 WHERE id=$3
       RETURNING *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt`,
      [vendorName, vendorId, req.params.id]
    )).rows[0];
    if (!row) return res.status(404).json({ error: '找不到這筆叫料單' });
    row.created_at = row.created_at_fmt; delete row.created_at_fmt;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新廠商失敗' });
  }
});

// ---------- 訂單狀態流程 ----------
// submitted 送出訂單 → purchasing 採購處理中 → vendor 廠商處理中
//   → closed 已結案（現場收貨無異常）
//   或 issue 現場回報異常 → 採購回報處理內容 → closed 已結案
const ORDER_STATUSES = ['submitted', 'purchasing', 'vendor', 'issue', 'closed'];

router.put('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: '狀態不正確' });

    // 結案時記錄結案時間
    const closedSql = status === 'closed' ? ', closed_at = NOW()' : '';
    const row = (await pool.query(
      `UPDATE orders SET status = $1${closedSql} WHERE id = $2
       RETURNING *, TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt`,
      [status, req.params.id]
    )).rows[0];
    if (!row) return res.status(404).json({ error: '找不到這筆叫料單' });
    row.need_date = row.need_date_fmt; delete row.need_date_fmt;

    if (status === 'closed') {
      notifyOrderStatusEvent({ order: row, eventType: 'closed', extra: row.purchase_reply })
        .catch((err) => console.error('結案通知失敗：', err.message));
    }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新訂單狀態失敗' });
  }
});

// 採購針對現場回報的異常，填寫處理內容（填完可再按結案）
router.put('/orders/:id/purchase-reply', async (req, res) => {
  try {
    const { purchase_reply } = req.body;
    const row = (await pool.query(
      'UPDATE orders SET purchase_reply = $1 WHERE id = $2 RETURNING *',
      [purchase_reply || '', req.params.id]
    )).rows[0];
    if (!row) return res.status(404).json({ error: '找不到這筆叫料單' });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '儲存處理內容失敗' });
  }
});

// ---------- 廠商報價（採購填寫，單價 = 牌價 × 折數） ----------
router.put('/orders/:id/pricing', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: '沒有收到報價資料' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const it of items) {
      const list = it.list_price === '' || it.list_price === null || it.list_price === undefined
        ? null : Number(it.list_price);
      const disc = it.discount === '' || it.discount === null || it.discount === undefined
        ? null : Number(it.discount);
      // 單價由後端算，避免前端算的跟存的不一致；折數是百分比（75 折 = 75，可以超過 100）
      const unit = (list !== null && disc !== null) ? Math.round(list * disc) / 100 : null;
      const vendorId = it.vendor_id ? Number(it.vendor_id) : null;
      await client.query(
        'UPDATE order_items SET list_price = $1, discount = $2, unit_price = $3, vendor_id = $4 WHERE id = $5 AND order_id = $6',
        [list, disc, unit, vendorId, it.id, req.params.id]
      );
    }
    // 整張單的「廠商」欄位＝品項上出現過的所有廠商（列印表頭與 CSV 用）
    await client.query(
      `UPDATE orders o SET vendor = COALESCE((
         SELECT STRING_AGG(DISTINCT v.name, '、') FROM order_items oi
         JOIN vendors v ON v.id = oi.vendor_id WHERE oi.order_id = o.id
       ), o.vendor) WHERE o.id = $1`, [req.params.id]
    );
    await client.query('COMMIT');

    const rows = (await pool.query(
      `SELECT oi.*, v.name AS vendor_name FROM order_items oi
       LEFT JOIN vendors v ON v.id = oi.vendor_id
       WHERE oi.order_id = $1 ORDER BY oi.id`, [req.params.id]
    )).rows;
    res.json({ ok: true, items: rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '儲存報價失敗' });
  } finally {
    client.release();
  }
});

// ---------- 特殊設備採購審核 ----------
router.put('/special-requests/:id', async (req, res) => {
  try {
    const { status, reviewer_note } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: '狀態不正確' });
    }
    const row = (await pool.query(
      `UPDATE special_requests SET status=$1, reviewer_note=$2, reviewed_at=NOW()
       WHERE id=$3
       RETURNING *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt,
                 TO_CHAR(reviewed_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS reviewed_at_fmt`,
      [status, reviewer_note || '', req.params.id]
    )).rows[0];
    row.created_at = row.created_at_fmt; delete row.created_at_fmt;
    row.reviewed_at = row.reviewed_at_fmt; delete row.reviewed_at_fmt;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新審核狀態失敗' });
  }
});

// ---------- 匯出叫料歷史紀錄 CSV ----------
router.get('/orders/export.csv', async (req, res) => {
  try {
    const orders = (await pool.query(
      `SELECT *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt,
                 TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt
       FROM orders ORDER BY id DESC`
    )).rows;

    const rows = [['單號', '狀態', '申請人', '職稱', '聯絡手機', '需求日', '案場名稱', '送貨地址', '施工用途', '類別', '廠商', '時間', '品項', '規格', '顏色', '數量', '單位', '牌價', '折數', '單價', '小計', '品項備註', '訂單備註', '異常說明', '採購處理內容']];
    const STATUS_TEXT = { submitted: '送出訂單', purchasing: '採購處理中', vendor: '廠商處理中', issue: '現場回報異常', closed: '已結案' };
    for (const o of orders) {
      const items = (await pool.query('SELECT * FROM order_items WHERE order_id = $1', [o.id])).rows;
      for (const it of items) {
        const sub = (it.unit_price === null || it.unit_price === undefined)
          ? '' : (Number(it.unit_price) * it.quantity).toFixed(2);
        rows.push([
          o.id, STATUS_TEXT[o.status || 'submitted'] || o.status,
          o.requester_name, o.title, o.phone, o.need_date_fmt, o.site_name, o.site_address, o.purpose, o.delivery_type, o.vendor,
          o.created_at_fmt, it.item_name, it.spec, it.color, it.quantity, it.unit,
          it.list_price ?? '', it.discount ?? '', it.unit_price ?? '', sub,
          it.note, o.note, o.issue_note, o.purchase_reply,
        ]);
      }
    }

    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="order-history.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '匯出 CSV 失敗' });
  }
});

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ============================================================
// 廠商 / 折扣群組（名稱清單，兩者結構相同，共用一套 CRUD）
// ============================================================
function registerNameList(pathName, table, label) {
  router.get(`/${pathName}`, async (req, res) => {
    try {
      const usageSql = table === 'discount_groups'
        ? '(SELECT COUNT(*)::int FROM item_prices p WHERE p.group_id = t.id) AS usage_count'
        : '(SELECT COUNT(*)::int FROM orders o WHERE o.vendor_id = t.id) AS usage_count';
      const rows = (await pool.query(`SELECT t.*, ${usageSql} FROM ${table} t ORDER BY t.sort_order, t.id`)).rows;
      if (table === 'discount_groups') {
        const links = (await pool.query(
          `SELECT gv.group_id, gv.vendor_id, gv.is_primary, v.name
           FROM group_vendors gv JOIN vendors v ON v.id = gv.vendor_id
           ORDER BY v.sort_order, v.id`
        )).rows;
        rows.forEach((g) => { g.vendors = links.filter((l) => l.group_id === g.id); });
      }
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `讀取${label}失敗` });
    }
  });

  router.post(`/${pathName}`, async (req, res) => {
    try {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: `請輸入${label}名稱` });
      const maxSort = (await pool.query(`SELECT COALESCE(MAX(sort_order),0)::int AS m FROM ${table}`)).rows[0].m;
      const row = (await pool.query(
        `INSERT INTO ${table} (name, sort_order) VALUES ($1,$2) RETURNING *`, [name, maxSort + 1]
      )).rows[0];
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') return res.status(400).json({ error: `已經有同名的${label}了` });
      console.error(err);
      res.status(500).json({ error: `新增${label}失敗` });
    }
  });

  router.put(`/${pathName}/:id`, async (req, res) => {
    try {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: `請輸入${label}名稱` });
      const row = (await pool.query(`UPDATE ${table} SET name=$1 WHERE id=$2 RETURNING *`, [name, req.params.id])).rows[0];
      if (!row) return res.status(404).json({ error: `找不到這個${label}` });
      if (table === 'vendors') {
        await pool.query('UPDATE orders SET vendor = $1 WHERE vendor_id = $2', [name, req.params.id]);
      }
      res.json(row);
    } catch (err) {
      if (err.code === '23505') return res.status(400).json({ error: `已經有同名的${label}了` });
      console.error(err);
      res.status(500).json({ error: `更新${label}失敗` });
    }
  });

  router.delete(`/${pathName}/:id`, async (req, res) => {
    try {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `刪除${label}失敗` });
    }
  });
}
registerNameList('vendors', 'vendors', '廠商');
registerNameList('discount-groups', 'discount_groups', '折扣群組');

// 設定某個折扣群組的配合廠商：vendors = [{ vendor_id, is_primary }]
router.put('/discount-groups/:id/vendors', async (req, res) => {
  const groupId = Number(req.params.id);
  const list = Array.isArray(req.body.vendors) ? req.body.vendors : [];
  if (list.filter((v) => v.is_primary).length > 1) {
    return res.status(400).json({ error: '主要廠商只能指定一家' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM group_vendors WHERE group_id = $1', [groupId]);
    for (const v of list) {
      await client.query(
        'INSERT INTO group_vendors (group_id, vendor_id, is_primary) VALUES ($1,$2,$3)',
        [groupId, Number(v.vendor_id), !!v.is_primary]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '儲存配合廠商失敗' });
  } finally {
    client.release();
  }
});

// ============================================================
// 每月折數（折扣群組 × 廠商 × 月份）
// ============================================================
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// 查某個月份的折數表：當月有填的回傳 month=該月；沒填的回傳最近一個更早月份的數字（沿用）
router.get('/discounts', async (req, res) => {
  try {
    const { month } = req.query;
    if (!MONTH_RE.test(month || '')) return res.status(400).json({ error: '月份格式不正確（YYYY-MM）' });
    const rows = (await pool.query(
      `SELECT DISTINCT ON (group_id, vendor_id) group_id, vendor_id, month, discount
       FROM monthly_discounts WHERE month <= $1
       ORDER BY group_id, vendor_id, month DESC`, [month]
    )).rows;
    res.json({ month, entries: rows.map((r) => ({ ...r, discount: Number(r.discount), inherited: r.month !== month })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '讀取折數失敗' });
  }
});

// 儲存某月份的折數：entries = [{ group_id, vendor_id, discount }]，discount 空白代表刪除該月設定
router.put('/discounts', async (req, res) => {
  const { month, entries } = req.body;
  if (!MONTH_RE.test(month || '')) return res.status(400).json({ error: '月份格式不正確（YYYY-MM）' });
  if (!Array.isArray(entries)) return res.status(400).json({ error: '沒有收到折數資料' });

  for (const e of entries) {
    const d = toNumberOrNull(e.discount);
    if (e.discount !== '' && e.discount !== null && e.discount !== undefined && (d === null || d < 0)) {
      return res.status(400).json({ error: `折數「${e.discount}」不是有效的數字` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const d = toNumberOrNull(e.discount);
      if (d === null) {
        await client.query(
          'DELETE FROM monthly_discounts WHERE group_id=$1 AND vendor_id=$2 AND month=$3',
          [e.group_id, e.vendor_id, month]
        );
      } else {
        await client.query(
          `INSERT INTO monthly_discounts (group_id, vendor_id, month, discount) VALUES ($1,$2,$3,$4)
           ON CONFLICT (group_id, vendor_id, month) DO UPDATE SET discount = EXCLUDED.discount, updated_at = NOW()`,
          [e.group_id, e.vendor_id, month, d]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '儲存折數失敗' });
  } finally {
    client.release();
  }
});

// ============================================================
// 報價自動帶入：依「品項規格的牌價」＋「廠商 × 折扣群組 × 訂單月份的折數」算出建議值
// 只回傳建議，不寫入；採購確認後按「儲存報價」才會存
// ============================================================
router.get('/orders/:id/price-suggest', async (req, res) => {
  try {
    const order = (await pool.query(
      `SELECT id, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') AS order_month FROM orders WHERE id = $1`,
      [req.params.id]
    )).rows[0];
    if (!order) return res.status(404).json({ error: '找不到這筆叫料單' });

    const orderItems = (await pool.query(
      'SELECT id, item_id, spec, vendor_id FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]
    )).rows;

    const suggestions = [];
    for (const oi of orderItems) {
      const sug = {
        id: oi.id, vendor_id: null, vendor_name: null, vendor_source: null,
        list_price: null, discount: null, discount_month: null, group_name: null, problem: null,
      };
      if (!oi.item_id) { sug.problem = '品項已不在目錄'; suggestions.push(sug); continue; }

      const price = (await pool.query(
        `SELECT p.list_price, p.group_id, g.name AS group_name FROM item_prices p
         LEFT JOIN discount_groups g ON g.id = p.group_id
         WHERE p.item_id = $1 AND p.spec = $2`, [oi.item_id, oi.spec || '']
      )).rows[0];
      if (!price || price.list_price === null) sug.problem = '尚未設定牌價';
      else sug.list_price = Number(price.list_price);
      if (!price || !price.group_id) {
        sug.problem = sug.problem || '尚未指定折扣群組';
        suggestions.push(sug); continue;
      }
      sug.group_name = price.group_name;

      // 廠商：品項上已指定就沿用；否則用這個群組的主要廠商，
      // 沒設主要廠商但只配合一家時就用那一家
      const groupVendors = (await pool.query(
        `SELECT gv.vendor_id, gv.is_primary, v.name FROM group_vendors gv JOIN vendors v ON v.id = gv.vendor_id
         WHERE gv.group_id = $1 ORDER BY v.sort_order, v.id`, [price.group_id]
      )).rows;
      let vendor = null;
      if (oi.vendor_id) {
        vendor = groupVendors.find((v) => v.vendor_id === oi.vendor_id)
          || (await pool.query('SELECT id AS vendor_id, name FROM vendors WHERE id = $1', [oi.vendor_id])).rows[0]
          || null;
        if (vendor) sug.vendor_source = 'item';
      }
      if (!vendor) {
        vendor = groupVendors.find((v) => v.is_primary) || (groupVendors.length === 1 ? groupVendors[0] : null);
        if (vendor) sug.vendor_source = 'group';
      }
      if (!vendor) {
        sug.problem = sug.problem || (groupVendors.length
          ? `「${price.group_name}」配合多家廠商，請先選廠商`
          : `「${price.group_name}」尚未設定配合廠商`);
        suggestions.push(sug); continue;
      }
      sug.vendor_id = vendor.vendor_id;
      sug.vendor_name = vendor.name;

      const disc = (await pool.query(
        `SELECT month, discount FROM monthly_discounts
         WHERE group_id = $1 AND vendor_id = $2 AND month <= $3 ORDER BY month DESC LIMIT 1`,
        [price.group_id, sug.vendor_id, order.order_month]
      )).rows[0];
      if (disc) { sug.discount = Number(disc.discount); sug.discount_month = disc.month; }
      else sug.problem = sug.problem || `${vendor.name} 在「${price.group_name}」尚無折數`;

      suggestions.push(sug);
    }
    res.json({ order_month: order.order_month, items: suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '計算建議報價失敗' });
  }
});

// ============================================================
// 牌價 CSV 匯出 / 匯入（第一次建檔、大量調整用）
// ============================================================
router.get('/item-prices/export.csv', async (req, res) => {
  try {
    const items = (await pool.query(
      `SELECT i.id, i.name, i.specs, i.unit, s.name AS sub_name, c.name AS cat_name
       FROM items i JOIN subcategories s ON s.id = i.subcategory_id JOIN categories c ON c.id = s.category_id
       ORDER BY c.sort_order, c.id, s.sort_order, s.id, i.sort_order, i.id`
    )).rows;
    const prices = (await pool.query(
      `SELECT p.item_id, p.spec, p.list_price, g.name AS group_name FROM item_prices p
       LEFT JOIN discount_groups g ON g.id = p.group_id`
    )).rows;
    const rows = [['品項ID', '分類', '子分類', '品項名稱', '規格', '單位', '牌價', '折扣群組']];
    for (const it of items) {
      const specs = JSON.parse(it.specs || '[]');
      for (const spec of (specs.length ? specs : [''])) {
        const p = prices.find((x) => x.item_id === it.id && x.spec === spec);
        rows.push([it.id, it.cat_name, it.sub_name, it.name, spec, it.unit, p?.list_price ?? '', p?.group_name ?? '']);
      }
    }
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="item-prices.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '匯出牌價失敗' });
  }
});

// rows = [{ item_id, spec, list_price, group_name }]（前端已把 CSV 解析成物件）
// 以「品項ID + 規格」對應；折扣群組用名稱對應，不存在的群組會自動建立
router.post('/item-prices/import', async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'CSV 裡沒有資料' });

  const client = await pool.connect();
  const skipped = [];
  let updated = 0;
  const createdGroups = [];
  try {
    await client.query('BEGIN');
    const items = (await client.query('SELECT id, name, specs FROM items')).rows;
    const groups = (await client.query('SELECT id, name FROM discount_groups')).rows;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2; // CSV 第 1 列是標題
      const item = items.find((it) => it.id === Number(r.item_id));
      if (!item) { skipped.push(`第 ${line} 列：找不到品項ID ${r.item_id}`); continue; }
      const specs = JSON.parse(item.specs || '[]');
      const spec = String(r.spec ?? '').trim();
      if (!(specs.length ? specs : ['']).includes(spec)) {
        skipped.push(`第 ${line} 列：「${item.name}」沒有規格「${spec || '（空白）'}」`); continue;
      }
      const priceText = String(r.list_price ?? '').trim();
      const listPrice = toNumberOrNull(priceText);
      if (priceText && listPrice === null) { skipped.push(`第 ${line} 列：牌價「${priceText}」不是數字`); continue; }

      let groupId = null;
      const groupName = String(r.group_name ?? '').trim();
      if (groupName) {
        let g = groups.find((x) => x.name === groupName);
        if (!g) {
          g = (await client.query(
            `INSERT INTO discount_groups (name, sort_order)
             VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM discount_groups)) RETURNING id, name`, [groupName]
          )).rows[0];
          groups.push(g);
          createdGroups.push(groupName);
        }
        groupId = g.id;
      }

      if (listPrice === null && groupId === null) {
        await client.query('DELETE FROM item_prices WHERE item_id=$1 AND spec=$2', [item.id, spec]);
      } else {
        await client.query(
          `INSERT INTO item_prices (item_id, spec, list_price, group_id) VALUES ($1,$2,$3,$4)
           ON CONFLICT (item_id, spec) DO UPDATE SET list_price = EXCLUDED.list_price, group_id = EXCLUDED.group_id`,
          [item.id, spec, listPrice, groupId]
        );
      }
      updated++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, updated, skipped, created_groups: createdGroups });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '匯入牌價失敗' });
  } finally {
    client.release();
  }
});

// ============================================================
// 訂單查詢（後台專用，含牌價/折數/單價）
// 注意：必須放在 /orders/export.csv 之後，否則 export.csv 會被當成 :id
// ============================================================
function formatOrderRow(o) {
  o.created_at = o.created_at_fmt; delete o.created_at_fmt;
  o.need_date = o.need_date_fmt; delete o.need_date_fmt;
  return o;
}

router.get('/orders', async (req, res) => {
  try {
    const { name, title, from, to } = req.query;
    let sql = `SELECT *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt,
                 TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt
               FROM orders WHERE 1=1`;
    const params = [];
    if (name) { params.push(`%${name}%`); sql += ` AND requester_name ILIKE $${params.length}`; }
    if (title) { params.push(`%${title}%`); sql += ` AND title ILIKE $${params.length}`; }
    if (from) { params.push(from); sql += ` AND created_at AT TIME ZONE 'Asia/Taipei' >= $${params.length}::date`; }
    if (to) { params.push(to); sql += ` AND created_at AT TIME ZONE 'Asia/Taipei' < ($${params.length}::date + INTERVAL '1 day')`; }
    sql += ' ORDER BY id DESC';

    const orders = (await pool.query(sql, params)).rows.map(formatOrderRow);
    const ids = orders.map((o) => o.id);
    const allItems = ids.length
      ? (await pool.query(
          `SELECT oi.*, v.name AS vendor_name FROM order_items oi
           LEFT JOIN vendors v ON v.id = oi.vendor_id
           WHERE oi.order_id = ANY($1::int[]) ORDER BY oi.id`, [ids])).rows
      : [];
    res.json(orders.map((o) => ({ ...o, items: allItems.filter((it) => it.order_id === o.id) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查詢歷史紀錄失敗' });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const order = (await pool.query(
      `SELECT *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt,
                 TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt
       FROM orders WHERE id = $1`, [req.params.id]
    )).rows[0];
    if (!order) return res.status(404).json({ error: '找不到這筆叫料單' });
    const items = (await pool.query(
      `SELECT oi.*, v.name AS vendor_name FROM order_items oi
       LEFT JOIN vendors v ON v.id = oi.vendor_id
       WHERE oi.order_id = $1 ORDER BY oi.id`, [order.id])).rows;
    res.json({ ...formatOrderRow(order), items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查詢叫料單失敗' });
  }
});

module.exports = router;

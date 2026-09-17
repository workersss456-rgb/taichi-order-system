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
    res.json(items.map((it) => ({
      ...it,
      specs: JSON.parse(it.specs || '[]'),
      colors: JSON.parse(it.colors || '[]'),
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
    res.json({ ...item, specs: JSON.parse(item.specs), colors: JSON.parse(item.colors) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新品項失敗' });
  }
});

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
  const allowed = { categories: 'categories', subcategories: 'subcategories', items: 'items', sites: 'sites' };
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
    const row = (await pool.query(
      `UPDATE orders SET vendor=$1 WHERE id=$2
       RETURNING *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt`,
      [vendor || '', req.params.id]
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
      // 單價由後端算，避免前端算的跟存的不一致
      const unit = (list !== null && disc !== null) ? Math.round(list * disc * 100) / 100 : null;
      await client.query(
        'UPDATE order_items SET list_price = $1, discount = $2, unit_price = $3 WHERE id = $4 AND order_id = $5',
        [list, disc, unit, it.id, req.params.id]
      );
    }
    await client.query('COMMIT');

    const rows = (await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [req.params.id]
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

module.exports = router;

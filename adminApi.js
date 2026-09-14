const express = require('express');
const { pool } = require('../db');
const requireAdmin = require('../middleware/adminAuth');

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
      `SELECT *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt
       FROM orders ORDER BY id DESC`
    )).rows;

    const rows = [['單號', '申請人', '職稱', '聯絡手機', '時間', '品項', '規格', '顏色', '數量', '單位', '備註']];
    for (const o of orders) {
      const items = (await pool.query('SELECT * FROM order_items WHERE order_id = $1', [o.id])).rows;
      for (const it of items) {
        rows.push([o.id, o.requester_name, o.title, o.phone, o.created_at_fmt, it.item_name, it.spec, it.color, it.quantity, it.unit, o.note]);
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

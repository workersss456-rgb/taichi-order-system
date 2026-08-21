const express = require('express');
const db = require('../db');
const requireAdmin = require('../middleware/adminAuth');

const router = express.Router();

// 用來讓前端確認密碼是否正確（登入用）
router.post('/login', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

router.use(requireAdmin);

// ---------- 分類 ----------
router.post('/categories', (req, res) => {
  const { name, sort_order } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '請輸入分類名稱' });
  const result = db
    .prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
    .run(name.trim(), sort_order || 0);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/categories/:id', (req, res) => {
  const { name, sort_order } = req.body;
  db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?').run(
    name, sort_order || 0, req.params.id
  );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

router.delete('/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 子分類 ----------
router.post('/subcategories', (req, res) => {
  const { category_id, name, sort_order } = req.body;
  if (!category_id) return res.status(400).json({ error: '請選擇所屬分類' });
  if (!name || !name.trim()) return res.status(400).json({ error: '請輸入子分類名稱' });
  const result = db
    .prepare('INSERT INTO subcategories (category_id, name, sort_order) VALUES (?, ?, ?)')
    .run(category_id, name.trim(), sort_order || 0);
  res.status(201).json(db.prepare('SELECT * FROM subcategories WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/subcategories/:id', (req, res) => {
  const { name, sort_order, category_id } = req.body;
  db.prepare('UPDATE subcategories SET name = ?, sort_order = ?, category_id = ? WHERE id = ?').run(
    name, sort_order || 0, category_id, req.params.id
  );
  res.json(db.prepare('SELECT * FROM subcategories WHERE id = ?').get(req.params.id));
});

router.delete('/subcategories/:id', (req, res) => {
  db.prepare('DELETE FROM subcategories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 品項 ----------
router.get('/items', (req, res) => {
  // 管理後台要看到所有品項，包含下架的
  const items = db.prepare('SELECT * FROM items ORDER BY sort_order, id').all();
  res.json(items.map((it) => ({
    ...it,
    specs: JSON.parse(it.specs || '[]'),
    colors: JSON.parse(it.colors || '[]'),
  })));
});

router.post('/items', (req, res) => {
  const { subcategory_id, name, image_url, description, unit, specs, colors, sort_order } = req.body;
  if (!subcategory_id) return res.status(400).json({ error: '請選擇所屬子分類' });
  if (!name || !name.trim()) return res.status(400).json({ error: '請輸入品項名稱' });

  const result = db.prepare(`INSERT INTO items
    (subcategory_id, name, image_url, description, unit, specs, colors, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    subcategory_id,
    name.trim(),
    image_url || '',
    description || '',
    unit || '個',
    JSON.stringify(specs || []),
    JSON.stringify(colors || []),
    sort_order || 0
  );
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...item, specs: JSON.parse(item.specs), colors: JSON.parse(item.colors) });
});

router.put('/items/:id', (req, res) => {
  const { subcategory_id, name, image_url, description, unit, specs, colors, sort_order, active } = req.body;
  db.prepare(`UPDATE items SET subcategory_id=?, name=?, image_url=?, description=?, unit=?,
    specs=?, colors=?, sort_order=?, active=? WHERE id=?`).run(
    subcategory_id, name, image_url || '', description || '', unit || '個',
    JSON.stringify(specs || []), JSON.stringify(colors || []), sort_order || 0,
    active === undefined ? 1 : (active ? 1 : 0),
    req.params.id
  );
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  res.json({ ...item, specs: JSON.parse(item.specs), colors: JSON.parse(item.colors) });
});

router.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 特殊設備採購審核 ----------
router.put('/special-requests/:id', (req, res) => {
  const { status, reviewer_note } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '狀態不正確' });
  }
  db.prepare(`UPDATE special_requests SET status = ?, reviewer_note = ?, reviewed_at = datetime('now','localtime')
    WHERE id = ?`).run(status, reviewer_note || '', req.params.id);
  res.json(db.prepare('SELECT * FROM special_requests WHERE id = ?').get(req.params.id));
});

// ---------- 匯出叫料歷史紀錄 CSV ----------
router.get('/orders/export.csv', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');

  const rows = [['單號', '申請人', '部門', '時間', '品項', '規格', '顏色', '數量', '單位', '備註']];
  for (const o of orders) {
    const items = itemStmt.all(o.id);
    for (const it of items) {
      rows.push([o.id, o.requester_name, o.department, o.created_at, it.item_name, it.spec, it.color, it.quantity, it.unit, o.note]);
    }
  }

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="order-history.csv"');
  res.send('\uFEFF' + csv);
});

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = router;

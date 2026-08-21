const express = require('express');
const db = require('../db');
const { notifyAdminOfSpecialRequest } = require('../mailer');

const router = express.Router();

// ---------- 商品目錄（分類 -> 子分類 -> 品項），只回傳上架中的品項 ----------
router.get('/catalog', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const subcategories = db.prepare('SELECT * FROM subcategories ORDER BY sort_order, id').all();
  const items = db.prepare('SELECT * FROM items WHERE active = 1 ORDER BY sort_order, id').all();

  const tree = categories.map((cat) => ({
    ...cat,
    subcategories: subcategories
      .filter((sub) => sub.category_id === cat.id)
      .map((sub) => ({
        ...sub,
        items: items
          .filter((it) => it.subcategory_id === sub.id)
          .map((it) => ({
            ...it,
            specs: JSON.parse(it.specs || '[]'),
            colors: JSON.parse(it.colors || '[]'),
          })),
      })),
  }));

  res.json(tree);
});

// ---------- 送出叫料單（不需審核，送出即完成） ----------
router.post('/orders', (req, res) => {
  const { requester_name, department, note, items } = req.body;

  if (!requester_name || !requester_name.trim()) {
    return res.status(400).json({ error: '請填寫姓名' });
  }
  if (!department || !department.trim()) {
    return res.status(400).json({ error: '請填寫部門' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '購物車是空的，請至少選擇一項品項' });
  }
  for (const it of items) {
    if (!it.item_name || !it.quantity || it.quantity <= 0) {
      return res.status(400).json({ error: '品項資料不完整，請確認每項的數量都大於 0' });
    }
  }

  const insertOrder = db.prepare(
    'INSERT INTO orders (requester_name, department, note) VALUES (?, ?, ?)'
  );
  const insertItem = db.prepare(`INSERT INTO order_items
    (order_id, item_id, item_name, image_url, spec, color, quantity, unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const tx = db.transaction(() => {
    const orderId = insertOrder.run(requester_name.trim(), department.trim(), note || '').lastInsertRowid;
    for (const it of items) {
      insertItem.run(
        orderId,
        it.item_id || null,
        it.item_name,
        it.image_url || '',
        it.spec || '',
        it.color || '',
        it.quantity,
        it.unit || ''
      );
    }
    return orderId;
  });

  const orderId = tx();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  res.status(201).json({ ...order, items: orderItems });
});

// ---------- 叫料歷史紀錄查詢 ----------
router.get('/orders', (req, res) => {
  const { name, department, from, to } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];

  if (name) {
    sql += ' AND requester_name LIKE ?';
    params.push(`%${name}%`);
  }
  if (department) {
    sql += ' AND department LIKE ?';
    params.push(`%${department}%`);
  }
  if (from) {
    sql += ' AND date(created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(created_at) <= date(?)';
    params.push(to);
  }
  sql += ' ORDER BY id DESC';

  const orders = db.prepare(sql).all(...params);
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const result = orders.map((o) => ({ ...o, items: itemStmt.all(o.id) }));
  res.json(result);
});

// ---------- 特殊設備採購申請 ----------
router.post('/special-requests', (req, res) => {
  const { requester_name, department, item_name, vendor, purpose, budget, quantity, note } = req.body;

  if (!requester_name || !requester_name.trim()) return res.status(400).json({ error: '請填寫姓名' });
  if (!department || !department.trim()) return res.status(400).json({ error: '請填寫部門' });
  if (!item_name || !item_name.trim()) return res.status(400).json({ error: '請填寫設備品名' });

  const insert = db.prepare(`INSERT INTO special_requests
    (requester_name, department, item_name, vendor, purpose, budget, quantity, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const result = insert.run(
    requester_name.trim(),
    department.trim(),
    item_name.trim(),
    vendor || '',
    purpose || '',
    budget || '',
    quantity && quantity > 0 ? quantity : 1,
    note || ''
  );

  const created = db.prepare('SELECT * FROM special_requests WHERE id = ?').get(result.lastInsertRowid);

  // Email 通知管理員（若失敗不影響申請本身已建立成功）
  notifyAdminOfSpecialRequest(created).catch((err) => {
    console.error('特殊採購申請 email 通知失敗：', err.message);
  });

  res.status(201).json(created);
});

// ---------- 查詢特殊設備採購申請狀態 ----------
router.get('/special-requests', (req, res) => {
  const { name, department, status } = req.query;
  let sql = 'SELECT * FROM special_requests WHERE 1=1';
  const params = [];

  if (name) {
    sql += ' AND requester_name LIKE ?';
    params.push(`%${name}%`);
  }
  if (department) {
    sql += ' AND department LIKE ?';
    params.push(`%${department}%`);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY id DESC';

  res.json(db.prepare(sql).all(...params));
});

module.exports = router;

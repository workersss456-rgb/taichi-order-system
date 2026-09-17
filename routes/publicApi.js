const express = require('express');
const { pool } = require('../db');
const {
  notifyAdminOfSpecialRequest,
  notifyAdminOfRegistration,
  notifyUserOfRegistration,
  notifyOrderStatusEvent,
} = require('../mailer');

const router = express.Router();

// ---------- 商品目錄（分類 -> 子分類 -> 品項），只回傳上架中的品項 ----------
router.get('/catalog', async (req, res) => {
  try {
    const categories = (await pool.query('SELECT * FROM categories ORDER BY sort_order, id')).rows;
    const subcategories = (await pool.query('SELECT * FROM subcategories ORDER BY sort_order, id')).rows;
    const items = (await pool.query('SELECT * FROM items WHERE active = 1 ORDER BY sort_order, id')).rows;

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '讀取商品目錄失敗' });
  }
});

// ---------- 案場清單（案場名稱 + 地址對照，給下單頁面下拉選單用） ----------
router.get('/sites', async (req, res) => {
  try {
    const sites = (await pool.query('SELECT id, name, address FROM sites ORDER BY sort_order, id')).rows;
    res.json(sites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '讀取案場清單失敗' });
  }
});

// ============================================================
// 使用者註冊 / 登入（不需要密碼，用姓名／職稱／聯絡手機辨識）
// ============================================================

router.post('/register', async (req, res) => {
  try {
    const { name, title, phone, email } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '請填寫姓名' });
    if (!title || !title.trim()) return res.status(400).json({ error: '請填寫職稱' });
    if (!phone || !phone.trim()) return res.status(400).json({ error: '請填寫聯絡手機' });

    const existing = (await pool.query('SELECT * FROM users WHERE phone = $1', [phone.trim()])).rows[0];
    let user;
    let isNew = false;

    if (existing) {
      user = (await pool.query(
        `UPDATE users SET name=$1, title=$2, email=$3, updated_at=NOW() WHERE id=$4
         RETURNING id, name, title, phone, email,
           TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
           TO_CHAR(updated_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS updated_at`,
        [name.trim(), title.trim(), (email || '').trim(), existing.id]
      )).rows[0];
    } else {
      isNew = true;
      user = (await pool.query(
        `INSERT INTO users (name, title, phone, email) VALUES ($1,$2,$3,$4)
         RETURNING id, name, title, phone, email,
           TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
           TO_CHAR(updated_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS updated_at`,
        [name.trim(), title.trim(), phone.trim(), (email || '').trim()]
      )).rows[0];
    }

    notifyAdminOfRegistration(user).catch((err) => console.error('註冊通知管理員失敗：', err.message));
    notifyUserOfRegistration(user).catch((err) => console.error('註冊通知使用者本人失敗：', err.message));

    res.status(isNew ? 201 : 200).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '註冊失敗，請稍後再試' });
  }
});

router.get('/users/lookup', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone || !phone.trim()) return res.status(400).json({ error: '請提供聯絡手機' });
    const user = (await pool.query(
      `SELECT id, name, title, phone, email,
         TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
         TO_CHAR(updated_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS updated_at
       FROM users WHERE phone = $1`, [phone.trim()]
    )).rows[0];
    if (!user) return res.status(404).json({ error: '查無這組手機號碼的註冊資料，請先完成註冊' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查詢失敗，請稍後再試' });
  }
});

// ---------- 送出叫料單（不需審核，送出即完成） ----------
router.post('/orders', async (req, res) => {
  const {
    requester_name, title, phone, email, note, items,
    need_date, site_name, site_address, purpose, delivery_type,
  } = req.body;

  if (!requester_name || !requester_name.trim()) {
    return res.status(400).json({ error: '請先完成註冊/登入（缺少姓名）' });
  }
  if (!title || !title.trim()) {
    return res.status(400).json({ error: '請先完成註冊/登入（缺少職稱）' });
  }
  if (!need_date) return res.status(400).json({ error: '請選擇需求日' });
  if (!site_name || !site_name.trim()) return res.status(400).json({ error: '請選擇案場名稱' });
  if (!site_address || !site_address.trim()) return res.status(400).json({ error: '請填寫送貨地址' });
  if (!purpose || !purpose.trim()) return res.status(400).json({ error: '請填寫施工用途' });
  if (!delivery_type || !['訂貨', '自取'].includes(delivery_type)) {
    return res.status(400).json({ error: '請選擇類別（訂貨或自取）' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '購物車是空的，請至少選擇一項品項' });
  }
  for (const it of items) {
    if (!it.item_name || !it.quantity || it.quantity <= 0) {
      return res.status(400).json({ error: '品項資料不完整，請確認每項的數量都大於 0' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderId = (await client.query(
      `INSERT INTO orders
        (requester_name, title, phone, email, note, need_date, site_name, site_address, purpose, delivery_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        requester_name.trim(), title.trim(), (phone || '').trim(), (email || '').trim(), note || '',
        need_date, site_name.trim(), site_address.trim(), purpose.trim(), delivery_type,
      ]
    )).rows[0].id;

    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (order_id, item_id, item_name, image_url, spec, color, quantity, unit, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orderId, it.item_id || null, it.item_name, it.image_url || '', it.spec || '', it.color || '', it.quantity, it.unit || '', it.note || '']
      );
    }

    await client.query('COMMIT');

    const order = (await pool.query(
      `SELECT *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt,
                 TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt
       FROM orders WHERE id = $1`, [orderId]
    )).rows[0];
    order.created_at = order.created_at_fmt;
    delete order.created_at_fmt;
    order.need_date = order.need_date_fmt;
    delete order.need_date_fmt;
    const orderItems = (await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId])).rows;

    res.status(201).json({ ...order, items: orderItems.map(publicItem) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '送出叫料單失敗，請稍後再試' });
  } finally {
    client.release();
  }
});

// ---------- 前台資料過濾 ----------
// 牌價/折數/單價是內部成本資訊，前台 API 一律不回傳（內部核簽單改走 /api/admin/orders/:id）
function publicItem(item) {
  const { list_price, discount, unit_price, ...rest } = item;
  return rest;
}
// 訂購人 Email 不對其他使用者公開
function publicOrder(order) {
  const { email, ...rest } = order;
  return rest;
}

// ---------- 單筆叫料單查詢（前台列印廠商訂購單用，不含價格） ----------
router.get('/orders/:id', async (req, res) => {
  try {
    const order = (await pool.query(
      `SELECT *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt,
                 TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt
       FROM orders WHERE id = $1`, [req.params.id]
    )).rows[0];
    if (!order) return res.status(404).json({ error: '找不到這筆叫料單' });
    order.created_at = order.created_at_fmt;
    delete order.created_at_fmt;
    order.need_date = order.need_date_fmt;
    delete order.need_date_fmt;
    const items = (await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [order.id])).rows;
    res.json({ ...publicOrder(order), items: items.map(publicItem) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查詢叫料單失敗' });
  }
});

// ---------- 叫料歷史紀錄查詢 ----------
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

    const orders = (await pool.query(sql, params)).rows.map((o) => {
      o.created_at = o.created_at_fmt;
      delete o.created_at_fmt;
      o.need_date = o.need_date_fmt;
      delete o.need_date_fmt;
      return o;
    });

    const result = [];
    for (const o of orders) {
      const items = (await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [o.id])).rows;
      result.push({ ...publicOrder(o), items: items.map(publicItem) });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查詢歷史紀錄失敗' });
  }
});

// ---------- 現場收貨（一般使用者在歷史紀錄操作，不需管理員密碼） ----------
// 無異常 → 直接結案；有異常 → 填寫問題描述，拋轉回採購處理
router.put('/orders/:id/receive', async (req, res) => {
  try {
    const { has_issue, issue_note, issue_item_ids } = req.body;

    const current = (await pool.query('SELECT status FROM orders WHERE id = $1', [req.params.id])).rows[0];
    if (!current) return res.status(404).json({ error: '找不到這筆叫料單' });
    if (current.status === 'closed') return res.status(400).json({ error: '這筆訂單已經結案了' });

    let row;
    if (has_issue) {
      if (!issue_note || !issue_note.trim()) {
        return res.status(400).json({ error: '請填寫異常的問題描述' });
      }
      if (Array.isArray(issue_item_ids) && issue_item_ids.length) {
        await pool.query(
          'UPDATE order_items SET has_issue = true WHERE order_id = $1 AND id = ANY($2::int[])',
          [req.params.id, issue_item_ids]
        );
      }
      row = (await pool.query(
        `UPDATE orders SET status = 'issue', issue_note = $1, received_at = NOW() WHERE id = $2
         RETURNING *, TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt`,
        [issue_note.trim(), req.params.id]
      )).rows[0];
      row.need_date = row.need_date_fmt; delete row.need_date_fmt;
      notifyOrderStatusEvent({ order: row, eventType: 'issue_reported', extra: row.issue_note })
        .catch((err) => console.error('異常回報通知失敗：', err.message));
    } else {
      row = (await pool.query(
        `UPDATE orders SET status = 'closed', received_at = NOW(), closed_at = NOW() WHERE id = $1
         RETURNING *, TO_CHAR(need_date, 'YYYY-MM-DD') AS need_date_fmt`,
        [req.params.id]
      )).rows[0];
      row.need_date = row.need_date_fmt; delete row.need_date_fmt;
      notifyOrderStatusEvent({ order: row, eventType: 'closed', extra: '現場收貨無異常，直接結案' })
        .catch((err) => console.error('結案通知失敗：', err.message));
    }

    res.json(publicOrder(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新收貨狀態失敗' });
  }
});

// ---------- 特殊設備採購申請 ----------
router.post('/special-requests', async (req, res) => {
  try {
    const { requester_name, title, phone, email, item_name, vendor, purpose, budget, quantity, note } = req.body;

    if (!requester_name || !requester_name.trim()) return res.status(400).json({ error: '請先完成註冊/登入（缺少姓名）' });
    if (!title || !title.trim()) return res.status(400).json({ error: '請先完成註冊/登入（缺少職稱）' });
    if (!item_name || !item_name.trim()) return res.status(400).json({ error: '請填寫設備品名' });

    const created = (await pool.query(
      `INSERT INTO special_requests
        (requester_name, title, phone, email, item_name, vendor, purpose, budget, quantity, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *, TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt`,
      [
        requester_name.trim(), title.trim(), (phone || '').trim(), (email || '').trim(),
        item_name.trim(), vendor || '', purpose || '', budget || '',
        quantity && quantity > 0 ? quantity : 1, note || '',
      ]
    )).rows[0];
    created.created_at = created.created_at_fmt;
    delete created.created_at_fmt;

    notifyAdminOfSpecialRequest(created).catch((err) => {
      console.error('特殊採購申請 email 通知失敗：', err.message);
    });

    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '送出申請失敗，請稍後再試' });
  }
});

// ---------- 查詢特殊設備採購申請狀態 ----------
router.get('/special-requests', async (req, res) => {
  try {
    const { name, title, status } = req.query;
    let sql = `SELECT *,
                 TO_CHAR(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS created_at_fmt,
                 TO_CHAR(reviewed_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS reviewed_at_fmt
               FROM special_requests WHERE 1=1`;
    const params = [];

    if (name) { params.push(`%${name}%`); sql += ` AND requester_name ILIKE $${params.length}`; }
    if (title) { params.push(`%${title}%`); sql += ` AND title ILIKE $${params.length}`; }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ' ORDER BY id DESC';

    const rows = (await pool.query(sql, params)).rows.map((r) => {
      r.created_at = r.created_at_fmt; delete r.created_at_fmt;
      r.reviewed_at = r.reviewed_at_fmt; delete r.reviewed_at_fmt;
      return r;
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查詢申請紀錄失敗' });
  }
});

module.exports = router;

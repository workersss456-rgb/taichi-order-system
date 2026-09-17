const { Pool } = require('pg');

// Neon（或任何 Postgres）連線字串，從環境變數 DATABASE_URL 讀取。
// 在 Render 後台的 Environment 分頁新增 DATABASE_URL，值貼上 Neon 給的連線字串即可
// （格式類似 postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require）。
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️  尚未設定 DATABASE_URL 環境變數！請至 Render 後台設定 Neon 的 PostgreSQL 連線字串，否則伺服器無法連上資料庫。');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Neon 需要 SSL 連線
});

// ---------- 建立資料表（如果還不存在的話） ----------
async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS subcategories (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT,
      unit TEXT DEFAULT '個',
      specs TEXT DEFAULT '[]',
      colors TEXT DEFAULT '[]',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      requester_name TEXT NOT NULL,
      title TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      note TEXT,
      need_date DATE,
      site_name TEXT,
      site_address TEXT,
      purpose TEXT,
      delivery_type TEXT,
      vendor TEXT,
      status TEXT DEFAULT 'submitted',
      issue_note TEXT,
      purchase_reply TEXT,
      received_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      image_url TEXT,
      spec TEXT,
      color TEXT,
      quantity INTEGER NOT NULL,
      unit TEXT,
      note TEXT,
      list_price NUMERIC(12,2),
      discount NUMERIC(6,4),
      unit_price NUMERIC(12,2)
    );

    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS special_requests (
      id SERIAL PRIMARY KEY,
      requester_name TEXT NOT NULL,
      title TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      item_name TEXT NOT NULL,
      vendor TEXT,
      purpose TEXT,
      budget TEXT,
      quantity INTEGER DEFAULT 1,
      note TEXT,
      status TEXT DEFAULT 'pending',
      reviewer_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 遷移：如果 orders / order_items 是舊版（沒有這次新增的欄位），這裡補上。
  // Postgres 的 ADD COLUMN IF NOT EXISTS 是安全的，欄位已存在就不會做任何事。
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS need_date DATE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS site_name TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS site_address TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS purpose TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor TEXT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS note TEXT;

    -- 訂單狀態流程
    -- submitted 送出訂單 / purchasing 採購處理中 / vendor 廠商處理中
    -- issue 現場回報異常（待採購處理） / closed 已結案
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'submitted';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS issue_note TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS purchase_reply TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

    -- 廠商報價（採購在後台填寫，單價 = 牌價 × 折數）
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS list_price NUMERIC(12,2);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount NUMERIC(6,4);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2);
  `);
}

// ---------- 初次啟動時放入示範資料，方便直接看到畫面長怎樣 ----------
async function seedDemoData() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM categories');
  if (rows[0].c > 0) return;

  const officeId = (await pool.query(
    'INSERT INTO categories (name, sort_order) VALUES ($1,$2) RETURNING id', ['辦公用品', 1]
  )).rows[0].id;
  const officeSubA = (await pool.query(
    'INSERT INTO subcategories (category_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id', [officeId, '文具', 1]
  )).rows[0].id;
  const officeSubB = (await pool.query(
    'INSERT INTO subcategories (category_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id', [officeId, '紙張', 2]
  )).rows[0].id;

  const itSubCatId = (await pool.query(
    'INSERT INTO categories (name, sort_order) VALUES ($1,$2) RETURNING id', ['IT 設備', 2]
  )).rows[0].id;
  const itSubA = (await pool.query(
    'INSERT INTO subcategories (category_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id', [itSubCatId, '週邊設備', 1]
  )).rows[0].id;

  const insertItem = `INSERT INTO items
    (subcategory_id, name, image_url, description, unit, specs, colors, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;

  await pool.query(insertItem, [officeSubA, '原子筆', 'https://placehold.co/300x300?text=原子筆', '油性中性筆', '支',
    JSON.stringify([]), JSON.stringify(['黑', '藍', '紅']), 1]);
  await pool.query(insertItem, [officeSubA, '釘書機', 'https://placehold.co/300x300?text=釘書機', '標準型釘書機', '台',
    JSON.stringify([]), JSON.stringify([]), 2]);
  await pool.query(insertItem, [officeSubB, 'A4 影印紙', 'https://placehold.co/300x300?text=A4+影印紙', '70磅 一箱5包', '箱',
    JSON.stringify([]), JSON.stringify([]), 1]);
  await pool.query(insertItem, [itSubA, '無線滑鼠', 'https://placehold.co/300x300?text=無線滑鼠', '2.4G 無線滑鼠', '個',
    JSON.stringify([]), JSON.stringify(['黑', '白']), 1]);
  await pool.query(insertItem, [itSubA, 'USB Type-C 集線器', 'https://placehold.co/300x300?text=集線器', '多合一擴充座', '個',
    JSON.stringify(['4合1', '7合1']), JSON.stringify([]), 2]);
}

// ---------- 案場示範資料（沒有任何案場時才放入） ----------
async function seedDemoSites() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM sites');
  if (rows[0].c > 0) return;
  await pool.query(
    'INSERT INTO sites (name, address, sort_order) VALUES ($1,$2,$3)',
    ['範例案場（請至後台修改或新增）', '台中市南屯區範例路 1 號', 1]
  );
}

async function init() {
  await createTables();
  await seedDemoData();
  await seedDemoSites();
}

module.exports = { pool, init };

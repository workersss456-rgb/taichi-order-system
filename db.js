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
  // Neon 需要 SSL 連線；本機測試用的 localhost 資料庫則不用
  ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString || '') ? false : { rejectUnauthorized: false },
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
      discount NUMERIC(10,2),
      unit_price NUMERIC(12,2),
      has_issue BOOLEAN DEFAULT false
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
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS has_issue BOOLEAN DEFAULT false;
  `);

  // ---------- 牌價 / 廠商 / 每月折數 ----------
  // 牌價：固定在「品項 × 規格」上（沒有規格的品項，spec 存空字串）
  // 折數：「折扣群組 × 廠商 × 月份」，每月輸入一次；當月沒填就沿用最近一個有填的月份
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS discount_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS item_prices (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      spec TEXT NOT NULL DEFAULT '',
      list_price NUMERIC(12,2),
      group_id INTEGER REFERENCES discount_groups(id) ON DELETE SET NULL,
      UNIQUE (item_id, spec)
    );

    CREATE TABLE IF NOT EXISTS monthly_discounts (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES discount_groups(id) ON DELETE CASCADE,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      discount NUMERIC(10,2) NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (group_id, vendor_id, month)
    );

    -- 供應關係：哪些廠商供應這個折扣群組的材料（is_primary = 估價時預設帶入的那一家）
    CREATE TABLE IF NOT EXISTS group_vendors (
      group_id INTEGER NOT NULL REFERENCES discount_groups(id) ON DELETE CASCADE,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
      is_primary BOOLEAN DEFAULT false,
      PRIMARY KEY (group_id, vendor_id)
    );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL;
    -- 同一張叫料單可能跨廠商（例如 PVC 與鋼管不同供應商），廠商記在品項上
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL;

    -- 作廢（軟刪除）：資料保留，但不出現在一般清單、CSV 與案場統計
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided BOOLEAN DEFAULT false;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_reason TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

    -- 特殊採購核准後會轉成一張叫料單，這裡記住對應的單號
    ALTER TABLE special_requests ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL;
  `);

  await runOnceMigrations();
}

// ---------- 只執行一次的資料轉換 ----------
async function runOnceMigrations() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, ran_at TIMESTAMPTZ DEFAULT NOW())');

  // 折數改用百分比：75 折存 75（原本存 0.75），而且允許超過 100
  // 1) 欄位放寬：原本 NUMERIC(6,4) 最大只能到 99.9999
  // 2) 舊資料裡用小數填的（<= 2，例如 0.75）乘 100 轉成百分比
  // 3) 依新公式重算單價：單價 = 牌價 × 折數 ÷ 100
  await migrateOnce('2026-09-percent-discount', percentDiscountMigration);
  await migrateOnce('2026-09-three-stage-status', threeStageStatusMigration);
}

// 舊的五段狀態（採購處理中 / 廠商處理中）合併成「送單」
async function threeStageStatusMigration(client) {
  await client.query(`UPDATE orders SET status = 'sent' WHERE status IN ('purchasing', 'vendor')`);
  console.log('✅ 訂單狀態已合併為 收單 / 送單 / 結案');
}

async function migrateOnce(name, fn) {
  const done = (await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])).rows.length;
  if (done) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function percentDiscountMigration(client) {
  await client.query('ALTER TABLE order_items ALTER COLUMN discount TYPE NUMERIC(10,2) USING discount');
  await client.query('ALTER TABLE monthly_discounts ALTER COLUMN discount TYPE NUMERIC(10,2) USING discount');
  await client.query('UPDATE order_items SET discount = discount * 100 WHERE discount IS NOT NULL AND discount <= 2');
  await client.query('UPDATE monthly_discounts SET discount = discount * 100 WHERE discount <= 2');
  await client.query(`UPDATE order_items SET unit_price = ROUND(list_price * discount / 100, 2)
                      WHERE list_price IS NOT NULL AND discount IS NOT NULL`);
  console.log('✅ 折數已轉換為百分比格式（75 折 = 75）');
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

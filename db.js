const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 資料庫存放路徑：雲端平台（如 Render 的 Disk）會指定一個固定掛載路徑，
// 用 DB_DIR 環境變數告訴程式存去哪裡；本機使用時不用設定，預設存在專案內的 data 資料夾。
const dataDir = process.env.DB_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'orders.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  description TEXT,
  unit TEXT DEFAULT '個',
  specs TEXT DEFAULT '[]',
  colors TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_name TEXT NOT NULL,
  department TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  item_name TEXT NOT NULL,
  image_url TEXT,
  spec TEXT,
  color TEXT,
  quantity INTEGER NOT NULL,
  unit TEXT
);

CREATE TABLE IF NOT EXISTS special_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_name TEXT NOT NULL,
  department TEXT NOT NULL,
  item_name TEXT NOT NULL,
  vendor TEXT,
  purpose TEXT,
  budget TEXT,
  quantity INTEGER DEFAULT 1,
  note TEXT,
  status TEXT DEFAULT 'pending',
  reviewer_note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  reviewed_at TEXT
);
`);

// 初次啟動時放入示範資料，方便直接看到畫面長怎樣（之後可在管理後台刪除/修改）
const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  const insertSub = db.prepare('INSERT INTO subcategories (category_id, name, sort_order) VALUES (?, ?, ?)');
  const insertItem = db.prepare(`INSERT INTO items (subcategory_id, name, image_url, description, unit, specs, colors, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const officeId = insertCat.run('辦公用品', 1).lastInsertRowid;
  const officeSubA = insertSub.run(officeId, '文具', 1).lastInsertRowid;
  const officeSubB = insertSub.run(officeId, '紙張', 2).lastInsertRowid;

  const itSubCatId = insertCat.run('IT 設備', 2).lastInsertRowid;
  const itSubA = insertSub.run(itSubCatId, '週邊設備', 1).lastInsertRowid;

  insertItem.run(officeSubA, '原子筆', 'https://placehold.co/300x300?text=原子筆', '油性中性筆', '支',
    JSON.stringify([]), JSON.stringify(['黑', '藍', '紅']), 1);
  insertItem.run(officeSubA, '釘書機', 'https://placehold.co/300x300?text=釘書機', '標準型釘書機', '台',
    JSON.stringify([]), JSON.stringify([]), 2);
  insertItem.run(officeSubB, 'A4 影印紙', 'https://placehold.co/300x300?text=A4+影印紙', '70磅 一箱5包', '箱',
    JSON.stringify([]), JSON.stringify([]), 1);
  insertItem.run(itSubA, '無線滑鼠', 'https://placehold.co/300x300?text=無線滑鼠', '2.4G 無線滑鼠', '個',
    JSON.stringify([]), JSON.stringify(['黑', '白']), 1);
  insertItem.run(itSubA, 'USB Type-C 集線器', 'https://placehold.co/300x300?text=集線器', '多合一擴充座', '個',
    JSON.stringify(['4合1', '7合1']), JSON.stringify([]), 2);
}

module.exports = db;

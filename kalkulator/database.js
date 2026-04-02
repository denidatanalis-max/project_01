// ============================================================
// FILE: kalkulator/database.js
// FUNGSI: Database khusus modul kalkulator (produk, harga, promo)
// ALUR: kalkulator/controllers.js → require('./database') → query data
//
// TABEL YANG DIBUAT:
//   1. kalk_products         → Master produk (kode, nama, unit, rasio)
//   2. kalk_product_groups   → Grup produk (kategori/accordion)
//   3. kalk_group_members    → Member: produk mana masuk grup mana
//   4. kalk_prices           → Harga per produk per zona
//   5. kalk_promo_principal  → Diskon reguler per principal (tier)
//   6. kalk_promo_group      → Diskon strata per grup produk (tier)
//   7. kalk_promo_bundle     → Program kawin (bundle beberapa bucket)
//   8. kalk_promo_flush_out  → Promo flush out (item + tier)
//   9. kalk_promo_free       → Promo gratis produk
//  10. kalk_promo_invoice    → Diskon invoice (tier)
//
// CATATAN:
//   - Database ini terpisah dari database user (src/database.js)
//   - Konsep sama persis dengan project_2 (Supabase)
//   - Tapi disini pakai SQLite lokal
// ============================================================

const Database = require('better-sqlite3');
const path     = require('path');

// ----------------------------------------------------------
// Buka file database khusus kalkulator
// Disimpan di folder kalkulator/ agar terpisah
// ----------------------------------------------------------
const dbPath = path.join(__dirname, 'kalkulator.db');
const db     = Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// TABEL: kalk_products
// Master data produk
// Kolom sama dengan master_products di project_2
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_products (
        code                    TEXT PRIMARY KEY,
        name                    TEXT NOT NULL,
        principal_code          TEXT,
        category                TEXT,
        unit_1                  TEXT DEFAULT 'Krt',
        unit_2                  TEXT DEFAULT 'Box',
        unit_3                  TEXT DEFAULT 'Pcs',
        ratio_unit_2_per_unit_1 INTEGER DEFAULT 12,
        ratio_unit_3_per_unit_2 INTEGER DEFAULT 1,
        eceran                  TEXT DEFAULT 'N',
        created_at              TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: kalk_product_groups
// Grup produk (untuk accordion di tampilan)
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_product_groups (
        code        TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        priority    INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: kalk_group_members
// Produk mana masuk ke grup mana + urutan prioritas
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_group_members (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code        TEXT NOT NULL,
        product_group_code  TEXT NOT NULL,
        priority            INTEGER DEFAULT 0,
        FOREIGN KEY (product_code)       REFERENCES kalk_products(code),
        FOREIGN KEY (product_group_code) REFERENCES kalk_product_groups(code)
    );
`);

// ============================================================
// TABEL: kalk_prices
// Harga produk per zona
// base_price = harga per unit_1 (Karton) sudah termasuk PPN
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_prices (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code    TEXT NOT NULL,
        zone_code       TEXT NOT NULL DEFAULT 'DEFAULT',
        base_price      REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (product_code) REFERENCES kalk_products(code)
    );
`);

// ============================================================
// TABEL: kalk_promo_principal
// Diskon reguler per principal berdasarkan total belanja
// Tier: min_purchase → discount_percentage
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_promo_principal (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id                TEXT NOT NULL,
        principal_code          TEXT NOT NULL,
        min_purchase_amount     REAL DEFAULT 0,
        discount_percentage     REAL DEFAULT 0,
        store_type              TEXT DEFAULT 'grosir',
        created_at              TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: kalk_promo_group
// Diskon strata per grup produk berdasarkan qty
// Tier: min_qty → discount_per_unit
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_promo_group (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id            TEXT NOT NULL,
        product_group_code  TEXT NOT NULL,
        min_qty             INTEGER DEFAULT 0,
        discount_per_unit   REAL DEFAULT 0,
        store_type          TEXT DEFAULT 'grosir',
        created_at          TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: kalk_promo_bundle
// Program kawin / bundle produk
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_promo_bundle (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id        TEXT NOT NULL,
        bucket_id       TEXT NOT NULL,
        product_code    TEXT NOT NULL,
        min_qty         INTEGER DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        store_type      TEXT DEFAULT 'grosir',
        created_at      TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: kalk_promo_flush_out
// Promo flush out — diskon khusus produk tertentu
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_promo_flush_out (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id        TEXT NOT NULL,
        product_code    TEXT NOT NULL,
        min_qty         INTEGER DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        store_type      TEXT DEFAULT 'grosir',
        created_at      TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: kalk_promo_free_product
// Promo gratis produk (beli X gratis Y)
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_promo_free_product (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id            TEXT NOT NULL,
        product_code        TEXT NOT NULL,
        min_qty             INTEGER DEFAULT 0,
        free_product_code   TEXT,
        free_qty            INTEGER DEFAULT 0,
        free_value          REAL DEFAULT 0,
        store_type          TEXT DEFAULT 'grosir',
        created_at          TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: kalk_promo_invoice
// Diskon level invoice (berdasarkan total faktur)
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS kalk_promo_invoice (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id                TEXT NOT NULL,
        min_invoice_amount      REAL DEFAULT 0,
        discount_percentage     REAL DEFAULT 0,
        store_type              TEXT DEFAULT 'grosir',
        created_at              TEXT DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// SEED DATA: Isi contoh produk dan harga jika tabel kosong
// ============================================================
const productCount = db.prepare('SELECT COUNT(*) as cnt FROM kalk_products').get();

if (productCount.cnt === 0) {
    console.log('>> [Kalkulator] Mengisi data contoh produk...');

    // -- Grup produk --
    const grupInsert = db.prepare('INSERT INTO kalk_product_groups (code, name, priority) VALUES (?, ?, ?)');
    grupInsert.run('WAFER',   'Wafer',          1);
    grupInsert.run('BISKUIT', 'Biskuit',        2);
    grupInsert.run('SNACK',   'Snack',          3);
    grupInsert.run('MINUMAN', 'Minuman',        4);

    // -- Produk --
    const prodInsert = db.prepare(`
        INSERT INTO kalk_products (code, name, principal_code, category, unit_1, unit_2, ratio_unit_2_per_unit_1)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Wafer
    prodInsert.run('WF001', 'Nabati Wafer Coklat 130g',    'KSNI', 'WAFER', 'Krt', 'Box', 12);
    prodInsert.run('WF002', 'Nabati Wafer Keju 130g',      'KSNI', 'WAFER', 'Krt', 'Box', 12);
    prodInsert.run('WF003', 'Nabati Wafer Matcha 130g',    'KSNI', 'WAFER', 'Krt', 'Box', 12);
    prodInsert.run('WF004', 'Nabati Wafer Strawberry 130g','KSNI', 'WAFER', 'Krt', 'Box', 12);

    // Biskuit
    prodInsert.run('BS001', 'Richoco Cookies 150g',         'KSNI', 'BISKUIT', 'Krt', 'Box', 24);
    prodInsert.run('BS002', 'Richoco Wafer Stick 120g',     'KSNI', 'BISKUIT', 'Krt', 'Box', 24);
    prodInsert.run('BS003', 'Nabati Cream Cracker 200g',    'KSNI', 'BISKUIT', 'Krt', 'Box', 12);

    // Snack
    prodInsert.run('SN001', 'Piattos Sapi Panggang 80g',   'NSU',  'SNACK', 'Krt', 'Box', 20);
    prodInsert.run('SN002', 'Piattos BBQ 80g',             'NSU',  'SNACK', 'Krt', 'Box', 20);
    prodInsert.run('SN003', 'Richeese Nabati Rolls 100g',  'NSU',  'SNACK', 'Krt', 'Box', 16);

    // Minuman
    prodInsert.run('MN001', 'Nabati Drink Coklat 200ml',   'KSNI', 'MINUMAN', 'Krt', 'Box', 24);
    prodInsert.run('MN002', 'Nabati Drink Vanilla 200ml',  'KSNI', 'MINUMAN', 'Krt', 'Box', 24);

    // -- Member grup --
    const memberInsert = db.prepare('INSERT INTO kalk_group_members (product_code, product_group_code, priority) VALUES (?, ?, ?)');
    memberInsert.run('WF001', 'WAFER',   1);
    memberInsert.run('WF002', 'WAFER',   2);
    memberInsert.run('WF003', 'WAFER',   3);
    memberInsert.run('WF004', 'WAFER',   4);
    memberInsert.run('BS001', 'BISKUIT', 1);
    memberInsert.run('BS002', 'BISKUIT', 2);
    memberInsert.run('BS003', 'BISKUIT', 3);
    memberInsert.run('SN001', 'SNACK',   1);
    memberInsert.run('SN002', 'SNACK',   2);
    memberInsert.run('SN003', 'SNACK',   3);
    memberInsert.run('MN001', 'MINUMAN', 1);
    memberInsert.run('MN002', 'MINUMAN', 2);

    // -- Harga (zona DEFAULT) --
    const hargaInsert = db.prepare('INSERT INTO kalk_prices (product_code, zone_code, base_price) VALUES (?, ?, ?)');
    hargaInsert.run('WF001', 'DEFAULT', 156000);
    hargaInsert.run('WF002', 'DEFAULT', 156000);
    hargaInsert.run('WF003', 'DEFAULT', 162000);
    hargaInsert.run('WF004', 'DEFAULT', 156000);
    hargaInsert.run('BS001', 'DEFAULT', 216000);
    hargaInsert.run('BS002', 'DEFAULT', 192000);
    hargaInsert.run('BS003', 'DEFAULT', 168000);
    hargaInsert.run('SN001', 'DEFAULT', 240000);
    hargaInsert.run('SN002', 'DEFAULT', 240000);
    hargaInsert.run('SN003', 'DEFAULT', 208000);
    hargaInsert.run('MN001', 'DEFAULT', 120000);
    hargaInsert.run('MN002', 'DEFAULT', 120000);

    // -- Promo: Diskon reguler principal --
    const principalInsert = db.prepare(`
        INSERT INTO kalk_promo_principal (promo_id, principal_code, min_purchase_amount, discount_percentage, store_type)
        VALUES (?, ?, ?, ?, ?)
    `);
    principalInsert.run('PROMO-REG-01', 'KSNI', 500000,  1,  'grosir');
    principalInsert.run('PROMO-REG-01', 'KSNI', 1000000, 2,  'grosir');
    principalInsert.run('PROMO-REG-01', 'KSNI', 2000000, 3,  'grosir');
    principalInsert.run('PROMO-REG-02', 'NSU',  500000,  1.5,'grosir');
    principalInsert.run('PROMO-REG-02', 'NSU',  1500000, 2.5,'grosir');

    // -- Promo: Diskon strata per grup --
    const groupInsert = db.prepare(`
        INSERT INTO kalk_promo_group (promo_id, product_group_code, min_qty, discount_per_unit, store_type)
        VALUES (?, ?, ?, ?, ?)
    `);
    groupInsert.run('PROMO-STR-01', 'WAFER',  5,  500,  'grosir');
    groupInsert.run('PROMO-STR-01', 'WAFER',  10, 1000, 'grosir');
    groupInsert.run('PROMO-STR-02', 'SNACK',  5,  400,  'grosir');
    groupInsert.run('PROMO-STR-02', 'SNACK',  10, 800,  'grosir');

    // -- Promo: Diskon invoice --
    const invoiceInsert = db.prepare(`
        INSERT INTO kalk_promo_invoice (promo_id, min_invoice_amount, discount_percentage, store_type)
        VALUES (?, ?, ?, ?)
    `);
    invoiceInsert.run('PROMO-INV-01', 1000000,  0.5, 'grosir');
    invoiceInsert.run('PROMO-INV-01', 3000000,  1.0, 'grosir');
    invoiceInsert.run('PROMO-INV-01', 5000000,  1.5, 'grosir');

    console.log('>> [Kalkulator] Data contoh berhasil diisi.');
}

module.exports = db;

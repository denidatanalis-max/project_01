// ============================================================
// FILE: src/database.js
// FUNGSI: Inisialisasi database SQLite dan membuat tabel-tabel
// ALUR: app.js → require('./src/database') → return db instance
// ============================================================

const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');

// ----------------------------------------------------------
// Buka / buat file database di root project
// ----------------------------------------------------------
const dbPath = path.join(__dirname, '..', 'data.db');
const db     = Database(dbPath);

// Aktifkan WAL mode supaya performa baca-tulis lebih baik
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// TABEL: users
// Menyimpan data user beserta password (SHA-256)
// Kolom jabatan menentukan level akses:
//   BOS > MANAGER > RBM > BM > ASS
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name       TEXT    NOT NULL UNIQUE,
        password        TEXT    NOT NULL,
        nama_pengguna   TEXT    NOT NULL,
        jabatan         TEXT    NOT NULL CHECK(jabatan IN ('DEV','BOS','MANAGER','SA','RBM','BM','ASS','SALES')),
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        updated_at      TEXT    DEFAULT (datetime('now','localtime'))
    );
`);

// ============================================================
// TABEL: sessions
// Menyimpan sesi aktif user — hanya 1 sesi per user
// Digunakan untuk mencegah login di 2 device bersamaan
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL UNIQUE,
        session_id      TEXT    NOT NULL UNIQUE,
        ip_address      TEXT,
        user_agent      TEXT,
        login_at        TEXT    DEFAULT (datetime('now','localtime')),
        last_active     TEXT    DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// ============================================================
// TABEL: activity_logs
// Mencatat semua aktivitas user selama di dalam program
// Berguna untuk mengetahui frekuensi penggunaan
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        action          TEXT    NOT NULL,
        detail          TEXT,
        ip_address      TEXT,
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// ============================================================
// TABEL: login_history
// Menyimpan riwayat login/logout lengkap
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS login_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        action          TEXT    NOT NULL CHECK(action IN ('LOGIN','LOGOUT','FORCE_LOGOUT')),
        ip_address      TEXT,
        user_agent      TEXT,
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// ============================================================
// KOLOM: is_admin
// Menandai apakah user adalah admin (1) atau user biasa (0)
// Admin hanya bisa kelola user (mirip Django admin)
// User biasa (BOS/MANAGER/RBM/BM/ASS) akses modul via beranda
// ============================================================
try {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`);
} catch (e) {
    // Kolom sudah ada — abaikan error
}

// Migrasi: tambah kolom socket_id di sessions (untuk real-time tracking)
try {
    db.exec(`ALTER TABLE sessions ADD COLUMN socket_id TEXT`);
} catch (e) {
    // Kolom sudah ada — abaikan error
}

// ============================================================
// KOLOM: parent_id
// Menentukan atasan langsung user dalam hierarki organisasi
// - BM hanya boleh punya atasan RBM
// - ASS hanya boleh punya atasan BM
// - SALES hanya boleh punya atasan ASS
// - RBM hanya boleh punya atasan MANAGER
// - MANAGER hanya boleh punya atasan BOS
// - BOS tidak punya atasan (parent_id = NULL)
// ============================================================
try {
    db.exec(`ALTER TABLE users ADD COLUMN parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
} catch (e) {
    // Kolom sudah ada — abaikan error
}

// ============================================================
// TABEL: parent_change_requests
// Menyimpan pengajuan mutasi (perubahan atasan)
// Flow: user submit → status PENDING → atasan baru approve/reject
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS parent_change_requests (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        old_parent_id   INTEGER,
        new_parent_id   INTEGER NOT NULL,
        status          TEXT    DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        approved_at     TEXT,
        FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (old_parent_id)  REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (new_parent_id)  REFERENCES users(id) ON DELETE CASCADE
    );
`);

// Migrasi: update CHECK constraint untuk menambah SA dan ASIST_MANAGER
// SQLite tidak bisa ALTER CHECK → recreate table
// PENTING: harus include SEMUA kolom agar data tidak hilang
try {
    // Bersihkan sisa migrasi gagal sebelumnya (jika ada)
    db.exec('DROP TABLE IF EXISTS users_new');

    var tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (tableInfo && tableInfo.sql && tableInfo.sql.indexOf("'ASIST_MANAGER'") === -1) {
        // Matikan foreign keys sementara agar DROP TABLE tidak masalah
        db.pragma('foreign_keys = OFF');

        db.transaction(function() {
            db.exec(`
                CREATE TABLE users_new (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_name       TEXT    NOT NULL UNIQUE,
                    password        TEXT    NOT NULL,
                    nama_pengguna   TEXT    NOT NULL,
                    jabatan         TEXT    NOT NULL CHECK(jabatan IN ('DEV','BOS','MANAGER','ASIST_MANAGER','SA','RBM','BM','ASS','SALES')),
                    created_at      TEXT    DEFAULT (datetime('now','localtime')),
                    updated_at      TEXT    DEFAULT (datetime('now','localtime')),
                    is_admin        INTEGER DEFAULT 0,
                    parent_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    status          TEXT    DEFAULT 'ACTIVE',
                    region          TEXT    DEFAULT '',
                    nama_depo       TEXT    DEFAULT '',
                    last_online     TEXT
                );
            `);

            // Salin SEMUA data — gunakan kolom eksplisit agar aman
            var cols = db.prepare("PRAGMA table_info(users)").all().map(function(c) { return c.name; });
            // Hanya copy kolom yang ada di kedua tabel
            var targetCols = ['id','user_name','password','nama_pengguna','jabatan','created_at','updated_at',
                              'is_admin','parent_id','status','region','nama_depo','last_online'];
            var commonCols = cols.filter(function(c) { return targetCols.indexOf(c) !== -1; });
            var colList = commonCols.join(', ');

            db.exec('INSERT INTO users_new (' + colList + ') SELECT ' + colList + ' FROM users;');
            db.exec('DROP TABLE users;');
            db.exec('ALTER TABLE users_new RENAME TO users;');
        })();

        db.pragma('foreign_keys = ON');
        console.log('>> Migrasi: CHECK constraint users ditambah ASIST_MANAGER (semua data dipertahankan)');
    }
} catch (e) {
    console.error('Migrasi ASIST_MANAGER gagal:', e.message);
    // Pastikan foreign keys tetap ON
    try { db.pragma('foreign_keys = ON'); } catch(e2) {}
}

// ============================================================
// KOLOM: status
// Menandai status user dalam hierarki:
//   ACTIVE    → punya atasan, masuk struktur organisasi
//   NO_PARENT → tidak punya atasan, perlu ajukan mutasi
// ============================================================
try {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'ACTIVE'`);
} catch (e) {
    // Kolom sudah ada — abaikan error
}

// ============================================================
// KOLOM: region & nama_depo
// Region dan nama depo user — diisi admin saat buat user,
// bisa diubah user dengan approval atasan
// ============================================================
try {
    db.exec(`ALTER TABLE users ADD COLUMN region TEXT DEFAULT ''`);
} catch (e) {}
try {
    db.exec(`ALTER TABLE users ADD COLUMN nama_depo TEXT DEFAULT ''`);
} catch (e) {}

// ============================================================
// KOLOM: last_online
// Timestamp heartbeat terakhir dari browser user.
// Browser kirim POST /api/heartbeat setiap 60 detik.
// Jika last_online > 1 menit yang lalu → dianggap offline.
// Strategi REPLACE: kolom di-UPDATE terus, data tidak membengkak.
// ============================================================
try {
    db.exec(`ALTER TABLE users ADD COLUMN last_online TEXT`);
} catch (e) {}

// ============================================================
// TABEL: depo_change_requests
// Pengajuan perubahan region & nama_depo oleh user
// Flow: user submit → status PENDING → atasan approve/reject
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS depo_change_requests (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        old_region      TEXT,
        new_region      TEXT    NOT NULL,
        old_nama_depo   TEXT,
        new_nama_depo   TEXT    NOT NULL,
        status          TEXT    DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        approved_at     TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// ============================================================
// TABEL: user_history
// Mencatat riwayat perubahan struktur organisasi:
//   REMOVE   → atasan menghapus bawahan
//   APPROVE  → atasan menyetujui mutasi
//   REJECT   → atasan menolak mutasi
//   MUTASI_REQUEST → user mengajukan mutasi
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS user_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        action          TEXT    NOT NULL,
        description     TEXT,
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// ============================================================
// SEED: Buat akun admin default jika belum ada user sama sekali
// Password default: admin123 (SHA-256)
// Admin (is_admin=1) hanya bisa kelola user, tidak akses modul
// ============================================================
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
if (userCount.cnt === 0) {
    const defaultPassword = crypto.createHash('sha256').update('admin123').digest('hex');
    db.prepare(`
        INSERT INTO users (user_name, password, nama_pengguna, jabatan, is_admin)
        VALUES (?, ?, ?, ?, ?)
    `).run('admin', defaultPassword, 'Administrator', 'DEV', 1);

    console.log('>> Default admin dibuat: admin / admin123 (is_admin=1, jabatan=DEV)');
}

// Pastikan user 'admin' yang sudah ada punya is_admin=1 dan jabatan=DEV
db.prepare("UPDATE users SET is_admin = 1, jabatan = 'DEV' WHERE user_name = 'admin'").run();

module.exports = db;

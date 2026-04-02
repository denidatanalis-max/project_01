// ============================================================
// FILE: sa/controllers.js
// FUNGSI: Controller modul SA (Sales Analyst)
// ALUR: urls.js → router → controller ini → render view
//
// HALAMAN:
//   GET  /sa/dashboard   → Dashboard SA (3 kartu: RO, LBP, Stock)
//   GET  /sa/upload-data → Halaman upload data (RO, LBP, Stock)
//   POST /sa/upload-data/{type} → Proses upload file
//
// FILE STORAGE:
//   DATA_SA/{REGION}/RO/      → File upload RO
//   DATA_SA/{REGION}/LBP/     → File upload LBP
//   DATA_SA/{REGION}/Stock/   → File upload Stock
// ============================================================

const db   = require('../src/database');
const fs   = require('fs');
const path = require('path');

// Folder root penyimpanan file SA
const DATA_SA_ROOT = path.join(__dirname, '..', 'DATA_SA');

// ============================================================
// Inisialisasi tabel SA (upload data RO, LBP, Stock)
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS sa_upload_ro (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        uploaded_by     INTEGER NOT NULL,
        nama_file       TEXT    NOT NULL,
        file_path       TEXT    NOT NULL,
        region          TEXT    NOT NULL DEFAULT '',
        uploaded_at     TEXT    DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS sa_upload_lbp (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        uploaded_by     INTEGER NOT NULL,
        nama_file       TEXT    NOT NULL,
        file_path       TEXT    NOT NULL,
        region          TEXT    NOT NULL DEFAULT '',
        uploaded_at     TEXT    DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS sa_upload_stock (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        uploaded_by     INTEGER NOT NULL,
        nama_file       TEXT    NOT NULL,
        file_path       TEXT    NOT NULL,
        region          TEXT    NOT NULL DEFAULT '',
        uploaded_at     TEXT    DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// Migrasi: tambah kolom file_path & region ke tabel lama jika belum ada
try { db.exec("ALTER TABLE sa_upload_lbp ADD COLUMN file_path TEXT NOT NULL DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE sa_upload_lbp ADD COLUMN region TEXT NOT NULL DEFAULT ''"); } catch(e) {}

// Migrasi: rename tabel lama sa_upload_stock_ro → sa_upload_ro (jika ada)
try {
    var oldTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sa_upload_stock_ro'").get();
    if (oldTable) {
        db.exec("ALTER TABLE sa_upload_stock_ro RENAME TO sa_upload_ro");
        // Tambah kolom baru ke tabel yang di-rename
        try { db.exec("ALTER TABLE sa_upload_ro ADD COLUMN file_path TEXT NOT NULL DEFAULT ''"); } catch(e) {}
        try { db.exec("ALTER TABLE sa_upload_ro ADD COLUMN region TEXT NOT NULL DEFAULT ''"); } catch(e) {}
    }
} catch(e) {}

// ----------------------------------------------------------
// HELPER: Pastikan folder tujuan upload ada
// Membuat DATA_SA/{region}/{type}/ secara rekursif
// ----------------------------------------------------------
function ensureUploadDir(region, type) {
    // Sanitize region name untuk nama folder (hapus karakter berbahaya)
    var safeRegion = (region || 'TANPA_REGION').replace(/[<>:"|?*\\\/]/g, '_').trim();
    if (!safeRegion) safeRegion = 'TANPA_REGION';

    var dir = path.join(DATA_SA_ROOT, safeRegion, type);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

// ----------------------------------------------------------
// HELPER: Simpan file upload ke folder tujuan
// Return path relatif dari root project
// ----------------------------------------------------------
function simpanFile(tempPath, originalName, region, type) {
    var dir = ensureUploadDir(region, type);

    // Tambah timestamp ke nama file agar unik
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var ext = path.extname(originalName);
    var baseName = path.basename(originalName, ext);
    var finalName = baseName + '_' + timestamp + ext;
    var finalPath = path.join(dir, finalName);

    // Copy dari temp ke tujuan, lalu hapus temp
    fs.copyFileSync(tempPath, finalPath);
    fs.unlinkSync(tempPath);

    return finalPath;
}

// ============================================================
// GET /sa/dashboard
// Dashboard utama SA — ringkasan data upload terakhir (3 kartu)
// ============================================================
function halamanDashboard(req, res) {
    var user = res.locals.user;

    // Hitung total upload per tipe
    var totalRO = db.prepare(
        'SELECT COUNT(*) as cnt FROM sa_upload_ro WHERE uploaded_by = ?'
    ).get(user.id).cnt;

    var totalLBP = db.prepare(
        'SELECT COUNT(*) as cnt FROM sa_upload_lbp WHERE uploaded_by = ?'
    ).get(user.id).cnt;

    var totalStock = db.prepare(
        'SELECT COUNT(*) as cnt FROM sa_upload_stock WHERE uploaded_by = ?'
    ).get(user.id).cnt;

    // Ambil upload terakhir per tipe
    var lastRO = db.prepare(
        'SELECT nama_file, uploaded_at FROM sa_upload_ro WHERE uploaded_by = ? ORDER BY id DESC LIMIT 1'
    ).get(user.id);

    var lastLBP = db.prepare(
        'SELECT nama_file, uploaded_at FROM sa_upload_lbp WHERE uploaded_by = ? ORDER BY id DESC LIMIT 1'
    ).get(user.id);

    var lastStock = db.prepare(
        'SELECT nama_file, uploaded_at FROM sa_upload_stock WHERE uploaded_by = ? ORDER BY id DESC LIMIT 1'
    ).get(user.id);

    res.render('sa_dashboard', {
        title      : 'Dashboard SA',
        user       : user,
        totalRO    : totalRO,
        totalLBP   : totalLBP,
        totalStock : totalStock,
        lastRO     : lastRO,
        lastLBP    : lastLBP,
        lastStock  : lastStock
    });
}

// ============================================================
// GET /sa/upload-data
// Halaman upload data RO, LBP, Stock (dalam 1 halaman)
// ============================================================
function halamanUploadData(req, res) {
    var user = res.locals.user;

    // Ambil riwayat upload (10 terakhir masing-masing)
    var riwayatRO = db.prepare(
        'SELECT id, nama_file, uploaded_at FROM sa_upload_ro WHERE uploaded_by = ? ORDER BY id DESC LIMIT 10'
    ).all(user.id);

    var riwayatLBP = db.prepare(
        'SELECT id, nama_file, uploaded_at FROM sa_upload_lbp WHERE uploaded_by = ? ORDER BY id DESC LIMIT 10'
    ).all(user.id);

    var riwayatStock = db.prepare(
        'SELECT id, nama_file, uploaded_at FROM sa_upload_stock WHERE uploaded_by = ? ORDER BY id DESC LIMIT 10'
    ).all(user.id);

    res.render('sa_upload_data', {
        title       : 'Upload Data',
        user        : user,
        riwayatRO   : riwayatRO,
        riwayatLBP  : riwayatLBP,
        riwayatStock: riwayatStock,
        pesan       : req.query.pesan || null
    });
}

// ============================================================
// POST /sa/upload-data/ro
// Upload file RO → simpan ke DATA_SA/{REGION}/RO/
// ============================================================
function uploadRO(req, res) {
    var user = res.locals.user;

    if (!req.file) {
        return res.redirect('/sa/upload-data?pesan=Tidak+ada+file+yang+diupload');
    }

    try {
        var savedPath = simpanFile(req.file.path, req.file.originalname, user.region, 'RO');

        db.prepare(`
            INSERT INTO sa_upload_ro (uploaded_by, nama_file, file_path, region)
            VALUES (?, ?, ?, ?)
        `).run(user.id, req.file.originalname, savedPath, user.region || '');

        // Catat aktivitas
        var ip = req.ip || req.connection.remoteAddress;
        db.prepare(`
            INSERT INTO activity_logs (user_id, action, detail, ip_address)
            VALUES (?, ?, ?, ?)
        `).run(user.id, 'SA_UPLOAD_RO', 'Upload RO: ' + req.file.originalname, ip);

        res.redirect('/sa/upload-data?pesan=RO+berhasil+diupload');

    } catch (err) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        console.error('Error upload RO:', err.message);
        res.redirect('/sa/upload-data?pesan=' + encodeURIComponent('Error upload: ' + err.message));
    }
}

// ============================================================
// POST /sa/upload-data/lbp
// Upload file LBP → simpan ke DATA_SA/{REGION}/LBP/
// ============================================================
function uploadLBP(req, res) {
    var user = res.locals.user;

    if (!req.file) {
        return res.redirect('/sa/upload-data?pesan=Tidak+ada+file+yang+diupload');
    }

    try {
        var savedPath = simpanFile(req.file.path, req.file.originalname, user.region, 'LBP');

        db.prepare(`
            INSERT INTO sa_upload_lbp (uploaded_by, nama_file, file_path, region)
            VALUES (?, ?, ?, ?)
        `).run(user.id, req.file.originalname, savedPath, user.region || '');

        // Catat aktivitas
        var ip = req.ip || req.connection.remoteAddress;
        db.prepare(`
            INSERT INTO activity_logs (user_id, action, detail, ip_address)
            VALUES (?, ?, ?, ?)
        `).run(user.id, 'SA_UPLOAD_LBP', 'Upload LBP: ' + req.file.originalname, ip);

        res.redirect('/sa/upload-data?pesan=LBP+berhasil+diupload');

    } catch (err) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        console.error('Error upload LBP:', err.message);
        res.redirect('/sa/upload-data?pesan=' + encodeURIComponent('Error upload: ' + err.message));
    }
}

// ============================================================
// POST /sa/upload-data/stock
// Upload file Stock → simpan ke DATA_SA/{REGION}/Stock/
// ============================================================
function uploadStock(req, res) {
    var user = res.locals.user;

    if (!req.file) {
        return res.redirect('/sa/upload-data?pesan=Tidak+ada+file+yang+diupload');
    }

    try {
        var savedPath = simpanFile(req.file.path, req.file.originalname, user.region, 'Stock');

        db.prepare(`
            INSERT INTO sa_upload_stock (uploaded_by, nama_file, file_path, region)
            VALUES (?, ?, ?, ?)
        `).run(user.id, req.file.originalname, savedPath, user.region || '');

        // Catat aktivitas
        var ip = req.ip || req.connection.remoteAddress;
        db.prepare(`
            INSERT INTO activity_logs (user_id, action, detail, ip_address)
            VALUES (?, ?, ?, ?)
        `).run(user.id, 'SA_UPLOAD_STOCK', 'Upload Stock: ' + req.file.originalname, ip);

        res.redirect('/sa/upload-data?pesan=Stock+berhasil+diupload');

    } catch (err) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        console.error('Error upload Stock:', err.message);
        res.redirect('/sa/upload-data?pesan=' + encodeURIComponent('Error upload: ' + err.message));
    }
}

// ============================================================
// POST /sa/upload-data/hapus-ro
// Hapus data upload RO + file dari disk
// ============================================================
function hapusRO(req, res) {
    var user = res.locals.user;
    var { upload_id } = req.body;

    if (!upload_id) {
        return res.redirect('/sa/upload-data?pesan=ID+tidak+valid');
    }

    var data = db.prepare('SELECT * FROM sa_upload_ro WHERE id = ? AND uploaded_by = ?').get(parseInt(upload_id), user.id);
    if (!data) {
        return res.redirect('/sa/upload-data?pesan=Data+tidak+ditemukan');
    }

    // Hapus file dari disk jika ada
    if (data.file_path) {
        try { fs.unlinkSync(data.file_path); } catch(e) {}
    }

    db.prepare('DELETE FROM sa_upload_ro WHERE id = ?').run(parseInt(upload_id));
    res.redirect('/sa/upload-data?pesan=Data+RO+berhasil+dihapus');
}

// ============================================================
// POST /sa/upload-data/hapus-lbp
// Hapus data upload LBP + file dari disk
// ============================================================
function hapusLBP(req, res) {
    var user = res.locals.user;
    var { upload_id } = req.body;

    if (!upload_id) {
        return res.redirect('/sa/upload-data?pesan=ID+tidak+valid');
    }

    var data = db.prepare('SELECT * FROM sa_upload_lbp WHERE id = ? AND uploaded_by = ?').get(parseInt(upload_id), user.id);
    if (!data) {
        return res.redirect('/sa/upload-data?pesan=Data+tidak+ditemukan');
    }

    if (data.file_path) {
        try { fs.unlinkSync(data.file_path); } catch(e) {}
    }

    db.prepare('DELETE FROM sa_upload_lbp WHERE id = ?').run(parseInt(upload_id));
    res.redirect('/sa/upload-data?pesan=Data+LBP+berhasil+dihapus');
}

// ============================================================
// POST /sa/upload-data/hapus-stock
// Hapus data upload Stock + file dari disk
// ============================================================
function hapusStock(req, res) {
    var user = res.locals.user;
    var { upload_id } = req.body;

    if (!upload_id) {
        return res.redirect('/sa/upload-data?pesan=ID+tidak+valid');
    }

    var data = db.prepare('SELECT * FROM sa_upload_stock WHERE id = ? AND uploaded_by = ?').get(parseInt(upload_id), user.id);
    if (!data) {
        return res.redirect('/sa/upload-data?pesan=Data+tidak+ditemukan');
    }

    if (data.file_path) {
        try { fs.unlinkSync(data.file_path); } catch(e) {}
    }

    db.prepare('DELETE FROM sa_upload_stock WHERE id = ?').run(parseInt(upload_id));
    res.redirect('/sa/upload-data?pesan=Data+Stock+berhasil+dihapus');
}

module.exports = {
    halamanDashboard,
    halamanUploadData,
    uploadRO,
    uploadLBP,
    uploadStock,
    hapusRO,
    hapusLBP,
    hapusStock
};

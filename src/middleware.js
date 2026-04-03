// ============================================================
// FILE: src/middleware.js
// FUNGSI: Middleware untuk autentikasi, otorisasi level jabatan,
//         dan pencatatan aktivitas user
// ALUR: index.js → use(middleware) → setiap request dicek
// ============================================================

const db = require('./database');

// ----------------------------------------------------------
// HIERARKI JABATAN (level semakin tinggi = akses lebih luas)
//
// Struktur organisasi:
//   DEV            → System admin (is_admin=1), kelola user & sistem
//   BOS            → Jabatan tertinggi, tidak perlu atasan
//   MANAGER        → Head of Sales, tidak perlu atasan
//   ASIST_MANAGER  → Asisten Manager, wajib punya atasan MANAGER
//   SA             → Sales Analyst, dashboard terpisah, tidak perlu atasan
//   RBM            → Tidak perlu persetujuan atasan
//   BM             → Wajib punya atasan RBM, perlu region & depo
//   ASS            → Wajib punya atasan BM, perlu region & depo
//   SALES          → Wajib punya atasan ASS, perlu region & depo
// ----------------------------------------------------------
const ROLE_LEVEL = {
    'DEV'            : 7,
    'BOS'            : 6,
    'MANAGER'        : 5,
    'ASIST_MANAGER'  : 5,
    'SA'             : 4,
    'RBM'            : 4,
    'BM'             : 3,
    'ASS'            : 2,
    'SALES'          : 1
};

// ----------------------------------------------------------
// ROLE_CAN_SEE: jabatan apa saja yang bisa dilihat datanya
// ASIST_MANAGER (setelah approved) = sama persis dengan MANAGER
// ----------------------------------------------------------
const ROLE_CAN_SEE = {
    'DEV'            : ['BOS', 'MANAGER', 'ASIST_MANAGER', 'SA', 'RBM', 'BM', 'ASS', 'SALES'],
    'BOS'            : ['BOS', 'MANAGER', 'ASIST_MANAGER', 'SA', 'RBM', 'BM', 'ASS', 'SALES'],
    'MANAGER'        : ['ASIST_MANAGER', 'SA', 'RBM', 'BM', 'ASS', 'SALES'],
    'ASIST_MANAGER'  : ['RBM', 'BM', 'ASS', 'SALES'],
    'SA'             : [],
    'RBM'            : ['BM', 'ASS', 'SALES'],
    'BM'             : ['ASS', 'SALES'],
    'ASS'            : ['SALES'],
    'SALES'          : []
};

// ----------------------------------------------------------
// VALID_PARENT_ROLE: Role atasan yang valid untuk setiap jabatan
//   DEV, BOS, MANAGER, RBM → tidak perlu atasan (null)
//   ASIST_MANAGER → atasannya harus MANAGER
//   BM      → atasannya harus RBM
//   ASS     → atasannya harus BM
//   SALES   → atasannya harus ASS
// ----------------------------------------------------------
const VALID_PARENT_ROLE = {
    'DEV'            : null,
    'BOS'            : null,
    'MANAGER'        : null,
    'ASIST_MANAGER'  : 'MANAGER',
    'SA'             : null,
    'RBM'            : null,
    'BM'             : 'RBM',
    'ASS'            : 'BM',
    'SALES'          : 'ASS'
};

// ============================================================
// MIDDLEWARE: cekLogin
// Memastikan user sudah login dan sesi masih valid
// Jika belum login → redirect ke /login
// Jika sesi tidak cocok (login di device lain) → redirect ke /login
// ============================================================
function cekLogin(req, res, next) {
    // Jika belum ada session user_id → belum login
    if (!req.session || !req.session.user_id) {
        return res.redirect('/login');
    }

    // Cek apakah sesi di database masih cocok dengan session_id ini
    const sesi = db.prepare(
        'SELECT * FROM sessions WHERE user_id = ? AND session_id = ?'
    ).get(req.session.user_id, req.sessionID);

    if (!sesi) {
        // Sesi sudah tidak valid (mungkin di-force logout dari device lain)
        req.session.destroy();
        return res.redirect('/login?pesan=sesi_habis');
    }

    // Update last_active
    db.prepare(
        "UPDATE sessions SET last_active = datetime('now','localtime') WHERE user_id = ?"
    ).run(req.session.user_id);

    // Simpan info user di res.locals supaya bisa diakses di view
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user_id);
    if (!user) {
        req.session.destroy();
        return res.redirect('/login');
    }

    res.locals.user              = user;
    res.locals.ROLE_LEVEL        = ROLE_LEVEL;
    res.locals.ROLE_CAN_SEE      = ROLE_CAN_SEE;
    res.locals.VALID_PARENT_ROLE = VALID_PARENT_ROLE;

    // Cegah browser cache halaman — role/session harus selalu dibaca fresh dari server
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');

    next();
}

// ============================================================
// MIDDLEWARE: cekJabatan(minLevel)
// Memastikan jabatan user memenuhi level minimum
// Contoh: cekJabatan('MANAGER') → hanya BOS dan MANAGER boleh
// ============================================================
function cekJabatan(minJabatan) {
    return function(req, res, next) {
        const user = res.locals.user;
        if (!user) {
            return res.redirect('/login');
        }

        const userLevel = ROLE_LEVEL[user.jabatan] || 0;
        const minLevel  = ROLE_LEVEL[minJabatan]   || 0;

        if (userLevel < minLevel) {
            return res.status(403).render('error', {
                title  : 'Akses Ditolak',
                pesan  : 'Anda tidak memiliki akses ke halaman ini.',
                user   : user
            });
        }

        next();
    };
}

// ============================================================
// MIDDLEWARE: catatAktivitas
// Mencatat setiap request user ke tabel activity_logs
// ============================================================
function catatAktivitas(req, res, next) {
    if (req.session && req.session.user_id) {
        const action = req.method + ' ' + req.originalUrl;
        const ip     = req.ip || req.connection.remoteAddress;

        try {
            db.prepare(`
                INSERT INTO activity_logs (user_id, action, detail, ip_address)
                VALUES (?, ?, ?, ?)
            `).run(
                req.session.user_id,
                action,
                req.body ? JSON.stringify(req.body) : null,
                ip
            );
        } catch (err) {
            console.error('Gagal catat aktivitas:', err.message);
        }
    }
    next();
}

// ============================================================
// MIDDLEWARE: cekAdmin
// Memastikan user adalah admin (is_admin = 1)
// Mirip Django: admin hanya bisa kelola user, tidak akses modul
// ============================================================
function cekAdmin(req, res, next) {
    const user = res.locals.user;
    if (!user || !user.is_admin) {
        return res.status(403).render('error', {
            title : 'Akses Ditolak',
            pesan : 'Halaman ini hanya untuk admin.',
            user  : user
        });
    }
    next();
}

// ============================================================
// MIDDLEWARE: cekBukanAdmin
// Memastikan user adalah user biasa (is_admin = 0) dan bukan SA
// User biasa (BOS/MANAGER/ASIST_MANAGER/RBM/BM/ASS/SALES) akses beranda + modul
// Admin tidak boleh masuk ke area user biasa
// SA punya dashboard terpisah
// ============================================================
function cekBukanAdmin(req, res, next) {
    const user = res.locals.user;
    if (!user) {
        return res.redirect('/login');
    }
    if (user.is_admin) {
        return res.redirect('/admin');
    }
    if (user.jabatan === 'SA') {
        return res.redirect('/sa/dashboard');
    }
    next();
}

// ============================================================
// MIDDLEWARE: cekPunyaAtasan
// Untuk route modul (kalkulator, pencapaian, games, dll):
// Jika jabatan user WAJIB punya atasan (VALID_PARENT_ROLE !== null)
// tapi parent_id kosong → redirect ke /beranda (restricted view)
// Berlaku untuk: ASIST_MANAGER, BM, ASS, SALES
// ============================================================
function cekPunyaAtasan(req, res, next) {
    const user = res.locals.user;
    if (user && VALID_PARENT_ROLE[user.jabatan] && !user.parent_id) {
        return res.redirect('/beranda');
    }
    next();
}

// ============================================================
// MIDDLEWARE: cekSA
// Memastikan user adalah SA (jabatan = 'SA')
// SA punya dashboard terpisah dari user biasa
// ============================================================
function cekSA(req, res, next) {
    const user = res.locals.user;
    if (!user) {
        return res.redirect('/login');
    }
    if (user.jabatan !== 'SA') {
        return res.redirect('/beranda');
    }
    next();
}

module.exports = {
    cekLogin,
    cekJabatan,
    cekAdmin,
    cekBukanAdmin,
    cekPunyaAtasan,
    cekSA,
    catatAktivitas,
    ROLE_LEVEL,
    ROLE_CAN_SEE,
    VALID_PARENT_ROLE
};

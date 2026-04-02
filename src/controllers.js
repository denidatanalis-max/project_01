// ============================================================
// FILE: src/controllers.js
// FUNGSI: Controller untuk halaman log aktivitas, riwayat login,
//         dan API data user online (real-time)
// ALUR: urls.js → router → controller ini → render view / JSON
// ============================================================

const db = require('./database');
const socketManager = require('./socketManager');

// ============================================================
// GET /admin/aktivitas
// Daftar user beserta last login — simple overview
// ============================================================
function halamanAktivitas(req, res) {
    var logs = db.prepare(`
        SELECT u.user_name, u.nama_pengguna, u.jabatan,
               (SELECT MAX(lh.created_at) FROM login_history lh WHERE lh.user_id = u.id AND lh.action = 'LOGIN') as last_login
        FROM users u
        WHERE u.is_admin = 0
        ORDER BY last_login DESC
    `).all();

    res.render('aktivitas', {
        title : 'Log Aktivitas',
        user  : res.locals.user,
        logs  : logs
    });
}

// ============================================================
// GET /admin/riwayat-login
// Riwayat login SEMUA user — hanya admin yg bisa akses
// ============================================================
function halamanRiwayatLogin(req, res) {
    var riwayat = db.prepare(`
        SELECT lh.*, u.user_name, u.nama_pengguna, u.jabatan
        FROM login_history lh
        JOIN users u ON lh.user_id = u.id
        ORDER BY lh.created_at DESC
        LIMIT 500
    `).all();

    res.render('riwayat_login', {
        title   : 'Riwayat Login',
        user    : res.locals.user,
        riwayat : riwayat
    });
}

// ----------------------------------------------------------
// HELPER: Ambil semua ID bawahan (langsung & tidak langsung)
// Menggunakan recursive CTE pada tabel users.parent_id
// Return: [id1, id2, ...] (tidak termasuk user itu sendiri)
// ----------------------------------------------------------
function getSubordinateIds(userId) {
    var rows = db.prepare(`
        WITH RECURSIVE bawahan AS (
            SELECT id FROM users WHERE parent_id = ?
            UNION ALL
            SELECT u.id FROM users u JOIN bawahan b ON u.parent_id = b.id
        )
        SELECT id FROM bawahan
    `).all(userId);

    return rows.map(function(r) { return r.id; });
}

// ============================================================
// GET /api/online-users
// API: Data user online — difilter berdasarkan tim (hierarki)
//
// ADMIN → lihat semua user online
// USER BIASA → hanya lihat diri sendiri + bawahan (via parent_id)
//
// Response: { counts: { BOS: 1, ... }, details: [...] }
// ============================================================
function apiOnlineUsers(req, res) {
    var user    = res.locals.user;
    var counts  = socketManager.hitungOnlinePerRole();
    var details = socketManager.daftarOnline();

    if (user.is_admin) {
        // Admin bisa lihat semua
        return res.json({ counts: counts, details: details });
    }

    // User biasa: filter berdasarkan tim (diri sendiri + semua bawahan)
    var bawahanIds = getSubordinateIds(user.id);
    var timIds = [user.id].concat(bawahanIds);

    var filteredDetails = details.filter(function(d) {
        return timIds.indexOf(d.user_id) !== -1;
    });

    // Hitung ulang counts hanya dari anggota tim yang online
    var filteredCounts = {};
    for (var i = 0; i < filteredDetails.length; i++) {
        var jabatan = filteredDetails[i].jabatan;
        filteredCounts[jabatan] = (filteredCounts[jabatan] || 0) + 1;
    }

    res.json({ counts: filteredCounts, details: filteredDetails });
}

// ============================================================
// POST /api/heartbeat
// Heartbeat ringan dari browser — update last_online user.
// Dipanggil setiap 60 detik oleh setInterval di client.
// Response: 204 No Content (tanpa body, seminimal mungkin)
// ============================================================
function apiHeartbeat(req, res) {
    db.prepare("UPDATE users SET last_online = datetime('now','localtime') WHERE id = ?")
        .run(res.locals.user.id);
    res.status(204).end();
}

module.exports = {
    halamanAktivitas,
    halamanRiwayatLogin,
    apiOnlineUsers,
    apiHeartbeat
};

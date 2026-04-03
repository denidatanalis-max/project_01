// ============================================================
// FILE: src/socketManager.js
// FUNGSI: Singleton Socket.IO — online tracking + force logout
// ALUR: index.js init(io) → controller require → getIO() / helpers
//
// FITUR:
//   1. Force logout user saat login di device baru
//   2. Tracking user online secara real-time
//   3. Broadcast jumlah online per role ke admin dashboard
//   4. Broadcast daftar online ke semua user (filtered by role)
// ============================================================

var _io = null;
var _db = null;

// Simpan instance io (dipanggil sekali dari index.js)
function init(io) {
    _io = io;
    _db = require('./database');
}

// Ambil instance io
function getIO() {
    return _io;
}

// ----------------------------------------------------------
// Hitung jumlah user online per role dari tabel sessions
// Return: { BOS: 1, MANAGER: 2, RBM: 0, BM: 3, ASS: 1, SALES: 5 }
// ----------------------------------------------------------
function hitungOnlinePerRole() {
    if (!_db) return {};

    // Role user biasa saja (DEV = admin, tidak ditampilkan)
    var roles = ['BOS', 'MANAGER', 'ASIST_MANAGER', 'SA', 'RBM', 'BM', 'ASS', 'SALES'];
    var result = {};

    for (var i = 0; i < roles.length; i++) {
        result[roles[i]] = 0;
    }

    // Berdasarkan heartbeat: last_online dalam 1 menit terakhir
    var rows = _db.prepare(`
        SELECT jabatan, COUNT(*) as jumlah
        FROM users
        WHERE is_admin = 0
          AND last_online >= datetime('now', '-1 minutes', 'localtime')
        GROUP BY jabatan
    `).all();

    for (var j = 0; j < rows.length; j++) {
        if (result.hasOwnProperty(rows[j].jabatan)) {
            result[rows[j].jabatan] = rows[j].jumlah;
        }
    }

    return result;
}

// ----------------------------------------------------------
// Ambil daftar detail user online (untuk dropdown)
// Return: [{ user_id, user_name, nama_pengguna, jabatan, user_agent, login_at }]
// ----------------------------------------------------------
function daftarOnline() {
    if (!_db) return [];

    // Berdasarkan heartbeat: last_online dalam 1 menit terakhir
    // LEFT JOIN sessions untuk tetap ambil user_agent jika tersedia
    return _db.prepare(`
        SELECT u.id as user_id, u.user_name, u.nama_pengguna, u.jabatan,
               u.last_online, s.user_agent, s.login_at
        FROM users u
        LEFT JOIN sessions s ON u.id = s.user_id
        WHERE u.is_admin = 0
          AND u.last_online >= datetime('now', '-1 minutes', 'localtime')
        ORDER BY u.jabatan, u.nama_pengguna
    `).all();
}

// ----------------------------------------------------------
// Broadcast data online ke SEMUA client yang terhubung
// Admin room mendapat data lengkap
// Setiap user room mendapat data sesuai ROLE_CAN_SEE
// ----------------------------------------------------------
function broadcastOnlineUpdate() {
    if (!_io) return;

    var counts = hitungOnlinePerRole();
    var details = daftarOnline();

    // Kirim ke room 'admin_dashboard' (admin bisa lihat semua)
    _io.to('admin_dashboard').emit('online_count_update', {
        counts  : counts,
        details : details
    });

    // Kirim ke room 'user_dashboard' (user biasa, akan difilter di client)
    // Tapi kita kirim semua, filter utama tetap di backend via API
    _io.to('user_dashboard').emit('online_count_update', {
        counts  : counts,
        details : details
    });
}

// ----------------------------------------------------------
// Force logout: kick device lama via Socket.IO
// ----------------------------------------------------------
function forceLogoutUser(userId) {
    if (_io && userId) {
        _io.to('user_' + userId).emit('force_logout', {
            pesan: 'Akun Anda login di perangkat lain. Anda akan dialihkan ke halaman login.'
        });
    }
}

module.exports = {
    init,
    getIO,
    hitungOnlinePerRole,
    daftarOnline,
    broadcastOnlineUpdate,
    forceLogoutUser
};

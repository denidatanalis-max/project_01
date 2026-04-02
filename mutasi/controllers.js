// ============================================================
// FILE: mutasi/controllers.js
// FUNGSI: Controller modul Mutasi (perubahan atasan / parent)
// ALUR: urls.js → router → controller ini → render view / redirect
//
// HALAMAN:
//   GET  /mutasi             → Info atasan + form ajukan
//   POST /mutasi/ajukan      → Submit pengajuan mutasi
//   GET  /mutasi/approval    → Daftar request masuk
//   POST /mutasi/approve     → Approve request
//   POST /mutasi/reject      → Reject request
//   POST /mutasi/remove      → Remove bawahan (tanpa approval)
//   GET  /mutasi/history     → Riwayat proses + daftar bawahan langsung
//
// VALIDASI:
//   - User hanya boleh pilih atasan dengan role yang benar
//   - Tidak boleh pilih diri sendiri
//   - Hanya 1 request PENDING aktif per user
//   - Remove hanya oleh parent langsung
// ============================================================

const db = require('../src/database');
const { ROLE_LEVEL, VALID_PARENT_ROLE } = require('../src/middleware');

// ============================================================
// GET /mutasi
// Halaman utama mutasi:
//   - Info atasan saat ini
//   - Form ajukan perubahan atasan
//   - Riwayat pengajuan user
// ============================================================
function halamanMutasi(req, res) {
    var user = res.locals.user;

    // Ambil data atasan saat ini
    var atasan = null;
    if (user.parent_id) {
        atasan = db.prepare(
            'SELECT id, user_name, nama_pengguna, jabatan FROM users WHERE id = ?'
        ).get(user.parent_id);
    }

    // Role atasan yang valid untuk user ini
    var parentRole = VALID_PARENT_ROLE[user.jabatan];

    // Daftar calon atasan baru (sesuai role yang valid, kecuali atasan saat ini)
    var calonAtasan = [];
    if (parentRole) {
        calonAtasan = db.prepare(
            'SELECT id, user_name, nama_pengguna, jabatan FROM users WHERE jabatan = ? AND is_admin = 0 AND id != ? ORDER BY nama_pengguna'
        ).all(parentRole, user.id);
    }

    // Riwayat pengajuan mutasi user ini
    var riwayat = db.prepare(`
        SELECT pcr.*,
               old_p.nama_pengguna AS old_parent_nama, old_p.jabatan AS old_parent_jabatan,
               new_p.nama_pengguna AS new_parent_nama, new_p.jabatan AS new_parent_jabatan
        FROM parent_change_requests pcr
        LEFT JOIN users old_p ON pcr.old_parent_id = old_p.id
        LEFT JOIN users new_p ON pcr.new_parent_id = new_p.id
        WHERE pcr.user_id = ?
        ORDER BY pcr.created_at DESC
        LIMIT 20
    `).all(user.id);

    // Cek apakah ada request PENDING aktif
    var pendingRequest = db.prepare(
        "SELECT id FROM parent_change_requests WHERE user_id = ? AND status = 'PENDING'"
    ).get(user.id);

    // Cek apakah ada depo change request PENDING
    var pendingDepo = db.prepare(
        "SELECT id FROM depo_change_requests WHERE user_id = ? AND status = 'PENDING'"
    ).get(user.id);

    res.render('mutasi', {
        title          : 'Mutasi Atasan',
        user           : user,
        atasan         : atasan,
        parentRole     : parentRole,
        calonAtasan    : calonAtasan,
        riwayat        : riwayat,
        adaPending     : !!pendingRequest,
        adaPendingDepo : !!pendingDepo,
        pesan          : req.query.pesan || null
    });
}

// ============================================================
// POST /mutasi/ajukan
// Submit pengajuan perubahan atasan
// Validasi:
//   - new_parent_id harus ada dan bukan diri sendiri
//   - Role atasan baru harus sesuai VALID_PARENT_ROLE
//   - Tidak boleh ada request PENDING lain
// ============================================================
function ajukanMutasi(req, res) {
    var user = res.locals.user;
    var newParentId = parseInt(req.body.new_parent_id);

    if (!newParentId) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Pilih atasan baru yang valid.'));
    }

    // Tidak boleh pilih diri sendiri
    if (newParentId === user.id) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Tidak bisa memilih diri sendiri sebagai atasan.'));
    }

    // Cek apakah calon atasan ada di database
    var calonAtasan = db.prepare(
        'SELECT id, jabatan FROM users WHERE id = ? AND is_admin = 0'
    ).get(newParentId);

    if (!calonAtasan) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Calon atasan tidak ditemukan.'));
    }

    // Validasi role: atasan baru harus sesuai VALID_PARENT_ROLE
    var parentRoleYangBenar = VALID_PARENT_ROLE[user.jabatan];
    if (!parentRoleYangBenar || calonAtasan.jabatan !== parentRoleYangBenar) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent(
            'Atasan baru harus berjabatan ' + (parentRoleYangBenar || '-') + '.'
        ));
    }

    // Tidak boleh sama dengan atasan saat ini
    if (newParentId === user.parent_id) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Ini sudah atasan Anda saat ini.'));
    }

    // Cek apakah sudah ada request PENDING
    var pendingRequest = db.prepare(
        "SELECT id FROM parent_change_requests WHERE user_id = ? AND status = 'PENDING'"
    ).get(user.id);

    if (pendingRequest) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Anda masih memiliki pengajuan yang menunggu persetujuan.'));
    }

    // Simpan request
    db.prepare(`
        INSERT INTO parent_change_requests (user_id, old_parent_id, new_parent_id)
        VALUES (?, ?, ?)
    `).run(user.id, user.parent_id || null, newParentId);

    // Catat di user_history
    var calonNama = db.prepare('SELECT nama_pengguna FROM users WHERE id = ?').get(newParentId);
    db.prepare(`
        INSERT INTO user_history (user_id, action, description)
        VALUES (?, 'MUTASI_REQUEST', ?)
    `).run(user.id, user.nama_pengguna + ' mengajukan mutasi ke ' + (calonNama ? calonNama.nama_pengguna : 'user_id:' + newParentId));

    // Catat aktivitas
    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(user.id, 'MUTASI_REQUEST', 'Mengajukan mutasi ke atasan baru (id: ' + newParentId + ')', ip);

    res.redirect('/mutasi?pesan=' + encodeURIComponent('Pengajuan mutasi berhasil dikirim. Menunggu persetujuan atasan baru.'));
}

// ============================================================
// GET /mutasi/approval
// Daftar request mutasi yang perlu di-approve oleh user ini
// Hanya tampilkan request dimana user ini = new_parent_id
// ============================================================
function halamanApproval(req, res) {
    var user = res.locals.user;

    // Request PENDING yang ditujukan ke user ini sebagai atasan baru
    var requestMasuk = db.prepare(`
        SELECT pcr.*,
               u.user_name, u.nama_pengguna, u.jabatan AS user_jabatan,
               old_p.nama_pengguna AS old_parent_nama, old_p.jabatan AS old_parent_jabatan
        FROM parent_change_requests pcr
        JOIN users u ON pcr.user_id = u.id
        LEFT JOIN users old_p ON pcr.old_parent_id = old_p.id
        WHERE pcr.new_parent_id = ? AND pcr.status = 'PENDING'
        ORDER BY pcr.created_at DESC
    `).all(user.id);

    // Riwayat request yang sudah diproses oleh user ini
    var riwayatDiproses = db.prepare(`
        SELECT pcr.*,
               u.user_name, u.nama_pengguna, u.jabatan AS user_jabatan,
               old_p.nama_pengguna AS old_parent_nama
        FROM parent_change_requests pcr
        JOIN users u ON pcr.user_id = u.id
        LEFT JOIN users old_p ON pcr.old_parent_id = old_p.id
        WHERE pcr.new_parent_id = ? AND pcr.status != 'PENDING'
        ORDER BY pcr.approved_at DESC
        LIMIT 20
    `).all(user.id);

    // Request depo PENDING dari bawahan langsung user ini
    var depoRequestMasuk = db.prepare(`
        SELECT dcr.*, u.user_name, u.nama_pengguna, u.jabatan AS user_jabatan
        FROM depo_change_requests dcr
        JOIN users u ON dcr.user_id = u.id
        WHERE u.parent_id = ? AND dcr.status = 'PENDING'
        ORDER BY dcr.created_at DESC
    `).all(user.id);

    // Riwayat depo yang sudah diproses
    var depoRiwayat = db.prepare(`
        SELECT dcr.*, u.user_name, u.nama_pengguna, u.jabatan AS user_jabatan
        FROM depo_change_requests dcr
        JOIN users u ON dcr.user_id = u.id
        WHERE u.parent_id = ? AND dcr.status != 'PENDING'
        ORDER BY dcr.approved_at DESC
        LIMIT 20
    `).all(user.id);

    res.render('mutasi_approval', {
        title            : 'Approval Mutasi',
        user             : user,
        requestMasuk     : requestMasuk,
        riwayatDiproses  : riwayatDiproses,
        depoRequestMasuk : depoRequestMasuk,
        depoRiwayat      : depoRiwayat,
        pesan            : req.query.pesan || null
    });
}

// ============================================================
// POST /mutasi/approve
// Approve request mutasi → ubah parent_id user
// ============================================================
function approveMutasi(req, res) {
    var user = res.locals.user;
    var requestId = parseInt(req.body.request_id);

    if (!requestId) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('ID request tidak valid.'));
    }

    // Ambil request
    var request = db.prepare(
        "SELECT * FROM parent_change_requests WHERE id = ? AND status = 'PENDING'"
    ).get(requestId);

    if (!request) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Request tidak ditemukan atau sudah diproses.'));
    }

    // Pastikan user ini adalah new_parent_id (hanya atasan baru yang bisa approve)
    if (request.new_parent_id !== user.id) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Anda tidak berhak menyetujui request ini.'));
    }

    // Update parent_id user yang mengajukan + set status ACTIVE
    db.prepare("UPDATE users SET parent_id = ?, status = 'ACTIVE', updated_at = datetime('now','localtime') WHERE id = ?")
        .run(request.new_parent_id, request.user_id);

    // Update status request
    db.prepare("UPDATE parent_change_requests SET status = 'APPROVED', approved_at = datetime('now','localtime') WHERE id = ?")
        .run(requestId);

    // Catat di user_history
    var pemohon = db.prepare('SELECT nama_pengguna FROM users WHERE id = ?').get(request.user_id);
    db.prepare(`
        INSERT INTO user_history (user_id, action, description)
        VALUES (?, 'APPROVE', ?)
    `).run(request.user_id, user.nama_pengguna + ' menyetujui mutasi ' + (pemohon ? pemohon.nama_pengguna : 'user_id:' + request.user_id));

    // Catat aktivitas
    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(user.id, 'MUTASI_APPROVE', 'Menyetujui mutasi user_id: ' + request.user_id, ip);

    res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Mutasi berhasil disetujui.'));
}

// ============================================================
// POST /mutasi/reject
// Reject request mutasi → parent tetap sama
// ============================================================
function rejectMutasi(req, res) {
    var user = res.locals.user;
    var requestId = parseInt(req.body.request_id);

    if (!requestId) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('ID request tidak valid.'));
    }

    // Ambil request
    var request = db.prepare(
        "SELECT * FROM parent_change_requests WHERE id = ? AND status = 'PENDING'"
    ).get(requestId);

    if (!request) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Request tidak ditemukan atau sudah diproses.'));
    }

    // Pastikan user ini adalah new_parent_id
    if (request.new_parent_id !== user.id) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Anda tidak berhak menolak request ini.'));
    }

    // Update status request
    db.prepare("UPDATE parent_change_requests SET status = 'REJECTED', approved_at = datetime('now','localtime') WHERE id = ?")
        .run(requestId);

    // Catat di user_history
    var pemohon = db.prepare('SELECT nama_pengguna FROM users WHERE id = ?').get(request.user_id);
    db.prepare(`
        INSERT INTO user_history (user_id, action, description)
        VALUES (?, 'REJECT', ?)
    `).run(request.user_id, user.nama_pengguna + ' menolak mutasi ' + (pemohon ? pemohon.nama_pengguna : 'user_id:' + request.user_id));

    // Catat aktivitas
    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(user.id, 'MUTASI_REJECT', 'Menolak mutasi user_id: ' + request.user_id, ip);

    res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Mutasi ditolak.'));
}

// ============================================================
// POST /mutasi/remove
// Remove bawahan — set parent_id = NULL, status = NO_PARENT
// TANPA approval, hanya bisa dilakukan oleh parent langsung
// ============================================================
function removeSubordinate(req, res) {
    var user = res.locals.user;
    var subordinateId = parseInt(req.body.subordinate_id);

    // Validasi input
    if (!subordinateId) {
        return res.redirect('/mutasi/history?pesan=' + encodeURIComponent('ID bawahan tidak valid.'));
    }

    // Ambil data bawahan
    var bawahan = db.prepare(
        'SELECT * FROM users WHERE id = ? AND is_admin = 0'
    ).get(subordinateId);

    if (!bawahan) {
        return res.redirect('/mutasi/history?pesan=' + encodeURIComponent('User tidak ditemukan.'));
    }

    // Pastikan user ini adalah parent langsung
    if (bawahan.parent_id !== user.id) {
        return res.redirect('/mutasi/history?pesan=' + encodeURIComponent('Anda bukan atasan langsung user ini.'));
    }

    // Set parent_id = NULL, status = NO_PARENT
    db.prepare("UPDATE users SET parent_id = NULL, status = 'NO_PARENT', updated_at = datetime('now','localtime') WHERE id = ?")
        .run(subordinateId);

    // Catat di user_history
    db.prepare(`
        INSERT INTO user_history (user_id, action, description)
        VALUES (?, 'REMOVE', ?)
    `).run(subordinateId, user.nama_pengguna + ' menghapus ' + bawahan.nama_pengguna + ' dari struktur');

    // Catat aktivitas
    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(user.id, 'REMOVE_SUBORDINATE', 'Menghapus bawahan: ' + bawahan.user_name, ip);

    res.redirect('/mutasi/history?pesan=' + encodeURIComponent(bawahan.nama_pengguna + ' berhasil dihapus dari struktur Anda.'));
}

// ============================================================
// GET /mutasi/history
// Riwayat semua proses: mutasi request, approve, reject, remove
// + daftar bawahan langsung dengan tombol Remove
// ============================================================
function halamanHistory(req, res) {
    var user = res.locals.user;

    // Bawahan langsung (parent_id = user ini)
    var bawahan = db.prepare(`
        SELECT id, user_name, nama_pengguna, jabatan, status, created_at
        FROM users
        WHERE parent_id = ? AND is_admin = 0
        ORDER BY jabatan, nama_pengguna
    `).all(user.id);

    // Riwayat yang melibatkan user ini
    var history = db.prepare(`
        SELECT h.*, u.user_name, u.nama_pengguna, u.jabatan
        FROM user_history h
        JOIN users u ON h.user_id = u.id
        WHERE h.user_id = ?
           OR h.user_id IN (SELECT id FROM users WHERE parent_id = ?)
        ORDER BY h.created_at DESC
        LIMIT 100
    `).all(user.id, user.id);

    res.render('mutasi_history', {
        title   : 'Riwayat Proses',
        user    : user,
        bawahan : bawahan,
        history : history,
        pesan   : req.query.pesan || null
    });
}

// ============================================================
// POST /mutasi/ajukan-depo
// Ajukan perubahan region & nama_depo — perlu approval atasan
// ============================================================
function ajukanDepo(req, res) {
    var user = res.locals.user;
    var newRegion   = (req.body.new_region || '').trim();
    var newNamaDepo = (req.body.new_nama_depo || '').trim();

    if (!newRegion || !newNamaDepo) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Region dan Nama Depo harus diisi.'));
    }

    // Harus punya atasan
    if (!user.parent_id) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Anda belum memiliki atasan. Ajukan mutasi atasan terlebih dahulu.'));
    }

    // Cek apakah sudah ada depo request PENDING
    var pending = db.prepare(
        "SELECT id FROM depo_change_requests WHERE user_id = ? AND status = 'PENDING'"
    ).get(user.id);
    if (pending) {
        return res.redirect('/mutasi?pesan=' + encodeURIComponent('Masih ada pengajuan perubahan depo yang menunggu persetujuan.'));
    }

    // Simpan request
    db.prepare(`
        INSERT INTO depo_change_requests (user_id, old_region, new_region, old_nama_depo, new_nama_depo)
        VALUES (?, ?, ?, ?, ?)
    `).run(user.id, user.region || '', newRegion, user.nama_depo || '', newNamaDepo);

    // Catat di user_history
    db.prepare(`
        INSERT INTO user_history (user_id, action, description)
        VALUES (?, 'DEPO_REQUEST', ?)
    `).run(user.id, user.nama_pengguna + ' mengajukan perubahan region/depo: ' + newRegion + ' / ' + newNamaDepo);

    // Catat aktivitas
    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(user.id, 'DEPO_REQUEST', 'Mengajukan perubahan region: ' + newRegion + ', depo: ' + newNamaDepo, ip);

    res.redirect('/mutasi?pesan=' + encodeURIComponent('Pengajuan perubahan region & depo berhasil dikirim. Menunggu persetujuan atasan.'));
}

// ============================================================
// POST /mutasi/approve-depo
// Approve perubahan region & nama_depo bawahan
// ============================================================
function approveDepo(req, res) {
    var user = res.locals.user;
    var requestId = parseInt(req.body.request_id);

    if (!requestId) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('ID request tidak valid.'));
    }

    var request = db.prepare(
        "SELECT * FROM depo_change_requests WHERE id = ? AND status = 'PENDING'"
    ).get(requestId);

    if (!request) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Request tidak ditemukan atau sudah diproses.'));
    }

    // Pastikan pemohon adalah bawahan langsung user ini
    var pemohon = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user_id);
    if (!pemohon || pemohon.parent_id !== user.id) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Anda bukan atasan langsung pemohon ini.'));
    }

    // Update region & nama_depo user
    db.prepare("UPDATE users SET region = ?, nama_depo = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(request.new_region, request.new_nama_depo, request.user_id);

    // Update status request
    db.prepare("UPDATE depo_change_requests SET status = 'APPROVED', approved_at = datetime('now','localtime') WHERE id = ?")
        .run(requestId);

    // Catat di user_history
    db.prepare(`
        INSERT INTO user_history (user_id, action, description)
        VALUES (?, 'DEPO_APPROVE', ?)
    `).run(request.user_id, user.nama_pengguna + ' menyetujui perubahan depo ' + (pemohon ? pemohon.nama_pengguna : ''));

    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(user.id, 'DEPO_APPROVE', 'Menyetujui perubahan depo user_id: ' + request.user_id, ip);

    res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Perubahan region & depo berhasil disetujui.'));
}

// ============================================================
// POST /mutasi/reject-depo
// Reject perubahan region & nama_depo bawahan
// ============================================================
function rejectDepo(req, res) {
    var user = res.locals.user;
    var requestId = parseInt(req.body.request_id);

    if (!requestId) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('ID request tidak valid.'));
    }

    var request = db.prepare(
        "SELECT * FROM depo_change_requests WHERE id = ? AND status = 'PENDING'"
    ).get(requestId);

    if (!request) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Request tidak ditemukan atau sudah diproses.'));
    }

    var pemohon = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user_id);
    if (!pemohon || pemohon.parent_id !== user.id) {
        return res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Anda bukan atasan langsung pemohon ini.'));
    }

    db.prepare("UPDATE depo_change_requests SET status = 'REJECTED', approved_at = datetime('now','localtime') WHERE id = ?")
        .run(requestId);

    db.prepare(`
        INSERT INTO user_history (user_id, action, description)
        VALUES (?, 'DEPO_REJECT', ?)
    `).run(request.user_id, user.nama_pengguna + ' menolak perubahan depo ' + (pemohon ? pemohon.nama_pengguna : ''));

    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(user.id, 'DEPO_REJECT', 'Menolak perubahan depo user_id: ' + request.user_id, ip);

    res.redirect('/mutasi/approval?pesan=' + encodeURIComponent('Perubahan depo ditolak.'));
}

module.exports = {
    halamanMutasi,
    ajukanMutasi,
    ajukanDepo,
    halamanApproval,
    approveMutasi,
    rejectMutasi,
    approveDepo,
    rejectDepo,
    removeSubordinate,
    halamanHistory
};

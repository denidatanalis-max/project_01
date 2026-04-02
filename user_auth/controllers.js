// ============================================================
// FILE: user_auth/controllers.js
// FUNGSI: Menangani logika login, logout, dan manajemen user
// ALUR: urls.js → router → controller ini → render view / redirect
// ============================================================

const crypto         = require('crypto');
const db             = require('../src/database');
const XLSX           = require('xlsx');
const fs             = require('fs');
const { ROLE_LEVEL, ROLE_CAN_SEE } = require('../src/middleware');
const socketManager  = require('../src/socketManager');

// ============================================================
// GET /login
// Tampilkan halaman login
// ============================================================
function halamanLogin(req, res) {
    // Jika sudah login, arahkan sesuai tipe user
    if (req.session && req.session.user_id) {
        var user = db.prepare('SELECT is_admin, jabatan FROM users WHERE id = ?').get(req.session.user_id);
        if (user && user.is_admin) {
            return res.redirect('/admin');
        }
        if (user && user.jabatan === 'SA') {
            return res.redirect('/sa/dashboard');
        }
        return res.redirect('/beranda');
    }

    const pesan = req.query.pesan || null;
    res.render('login', { title: 'Login', pesan: pesan });
}

// ============================================================
// POST /login
// Proses autentikasi user
// - Cek user_name dan password (SHA-256)
// - Jika sudah ada sesi aktif → force logout device lama
// - Buat sesi baru + catat login_history
// ============================================================
function prosesLogin(req, res) {
    const { user_name, password } = req.body;

    // Validasi input
    if (!user_name || !password) {
        return res.render('login', {
            title : 'Login',
            pesan : 'Username dan password harus diisi.'
        });
    }

    // Hash password input
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    // Cari user di database
    const user = db.prepare(
        'SELECT * FROM users WHERE user_name = ? AND password = ?'
    ).get(user_name.trim(), hashedPassword);

    if (!user) {
        return res.render('login', {
            title : 'Login',
            pesan : 'Username atau password salah.'
        });
    }

    // Cek apakah ada sesi aktif untuk user ini (login di device lain)
    const sesiLama = db.prepare('SELECT * FROM sessions WHERE user_id = ?').get(user.id);

    if (sesiLama) {
        // Force logout device lama — kirim event real-time via Socket.IO
        socketManager.forceLogoutUser(user.id);

        // Hapus sesi lama dari database
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

        // Catat di login_history bahwa di-force logout
        db.prepare(`
            INSERT INTO login_history (user_id, action, ip_address, user_agent)
            VALUES (?, 'FORCE_LOGOUT', ?, ?)
        `).run(user.id, sesiLama.ip_address, sesiLama.user_agent);
    }

    // Regenerate session untuk keamanan
    req.session.regenerate(function(err) {
        if (err) {
            return res.render('login', {
                title : 'Login',
                pesan : 'Terjadi kesalahan sistem. Coba lagi.'
            });
        }

        // Set session data
        req.session.user_id = user.id;
        req.session.jabatan = user.jabatan;

        const ip        = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || '';

        // Simpan sesi baru ke database
        db.prepare(`
            INSERT INTO sessions (user_id, session_id, ip_address, user_agent)
            VALUES (?, ?, ?, ?)
        `).run(user.id, req.sessionID, ip, userAgent);

        // Catat login di history
        db.prepare(`
            INSERT INTO login_history (user_id, action, ip_address, user_agent)
            VALUES (?, 'LOGIN', ?, ?)
        `).run(user.id, ip, userAgent);

        // Catat di activity_logs
        db.prepare(`
            INSERT INTO activity_logs (user_id, action, detail, ip_address)
            VALUES (?, ?, ?, ?)
        `).run(user.id, 'LOGIN', 'User berhasil login', ip);

        // Broadcast update online ke semua dashboard
        socketManager.broadcastOnlineUpdate();

        // Admin → /admin, SA → /sa/dashboard, User biasa → /beranda
        if (user.is_admin) {
            res.redirect('/admin');
        } else if (user.jabatan === 'SA') {
            res.redirect('/sa/dashboard');
        } else {
            res.redirect('/beranda');
        }
    });
}

// ============================================================
// GET /logout
// Proses logout user
// - Hapus sesi dari database
// - Catat di login_history dan activity_logs
// - Destroy session
// ============================================================
function prosesLogout(req, res) {
    if (req.session && req.session.user_id) {
        const userId = req.session.user_id;
        const ip     = req.ip || req.connection.remoteAddress;
        const ua     = req.headers['user-agent'] || '';

        // Hapus sesi dari database
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

        // Catat logout
        db.prepare(`
            INSERT INTO login_history (user_id, action, ip_address, user_agent)
            VALUES (?, 'LOGOUT', ?, ?)
        `).run(userId, ip, ua);

        // Catat aktivitas
        db.prepare(`
            INSERT INTO activity_logs (user_id, action, detail, ip_address)
            VALUES (?, ?, ?, ?)
        `).run(userId, 'LOGOUT', 'User logout', ip);

        // Broadcast update online ke semua dashboard
        socketManager.broadcastOnlineUpdate();
    }

    // Hapus cookie session dari browser agar tidak terbawa ke login berikutnya
    res.clearCookie('connect.sid');

    req.session.destroy(function() {
        res.redirect('/login?pesan=berhasil_logout');
    });
}

// ============================================================
// GET /admin
// Dashboard admin — hanya untuk user dengan is_admin=1
// Menampilkan statistik user + link ke kelola user
// ============================================================
function halamanAdminDashboard(req, res) {
    const user = res.locals.user;

    // Hitung total user biasa (bukan admin)
    const totalUser = db.prepare(
        'SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0'
    ).get().cnt;

    res.render('admin_dashboard', {
        title     : 'Dashboard Admin',
        user      : user,
        totalUser : totalUser
    });
}

// ============================================================
// GET /admin/kelola-user
// Halaman manajemen user (hanya admin) — dengan pagination
// ============================================================
function halamanKelolaUser(req, res) {
    const user = res.locals.user;

    // Pagination
    var page    = parseInt(req.query.page) || 1;
    var perPage = 25;
    var offset  = (page - 1) * perPage;

    // Multi-field search: each field is optional
    var sUser   = (req.query.s_user   || '').trim();
    var sNama   = (req.query.s_nama   || '').trim();
    var sRegion = (req.query.s_region || '').trim();
    var sDepo   = (req.query.s_depo   || '').trim();

    // Build dynamic WHERE clause
    var conditions = [];
    var params     = [];
    if (sUser)   { conditions.push('user_name LIKE ?');      params.push('%' + sUser + '%'); }
    if (sNama)   { conditions.push('nama_pengguna LIKE ?');  params.push('%' + sNama + '%'); }
    if (sRegion) { conditions.push('region LIKE ?');         params.push('%' + sRegion + '%'); }
    if (sDepo)   { conditions.push('nama_depo LIKE ?');      params.push('%' + sDepo + '%'); }

    var whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    var totalUser = db.prepare('SELECT COUNT(*) as cnt FROM users' + whereClause).get(...params).cnt;
    var daftarUser = db.prepare(
        'SELECT id, user_name, nama_pengguna, jabatan, region, nama_depo, is_admin, created_at FROM users' + whereClause + ' ORDER BY id LIMIT ? OFFSET ?'
    ).all(...params, perPage, offset);

    var totalPages = Math.ceil(totalUser / perPage) || 1;

    res.render('kelola_user', {
        title      : 'Kelola User',
        user       : user,
        daftarUser : daftarUser,
        pesan      : req.query.pesan || null,
        page       : page,
        totalPages : totalPages,
        totalUser  : totalUser,
        perPage    : perPage,
        sUser      : sUser,
        sNama      : sNama,
        sRegion    : sRegion,
        sDepo      : sDepo
    });
}

// ============================================================
// POST /kelola-user/tambah
// Tambah user baru
// ============================================================
function tambahUser(req, res) {
    const { user_name, password, nama_pengguna, jabatan, region, nama_depo } = req.body;

    // Validasi
    if (!user_name || !password || !nama_pengguna || !jabatan) {
        return res.redirect('/admin/kelola-user?pesan=Semua+field+harus+diisi');
    }

    const allowedRoles = ['BOS', 'MANAGER', 'ASIST_MANAGER', 'SA', 'RBM', 'BM', 'ASS', 'SALES'];
    if (!allowedRoles.includes(jabatan)) {
        return res.redirect('/admin/kelola-user?pesan=Jabatan+tidak+valid+(DEV+tidak+bisa+ditambah)');
    }

    // Cek apakah username sudah ada
    const existing = db.prepare('SELECT id FROM users WHERE user_name = ?').get(user_name.trim());
    if (existing) {
        return res.redirect('/admin/kelola-user?pesan=Username+sudah+digunakan');
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    db.prepare(`
        INSERT INTO users (user_name, password, nama_pengguna, jabatan, region, nama_depo)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(user_name.trim(), hashedPassword, nama_pengguna.trim(), jabatan, (region || '').trim(), (nama_depo || '').trim());

    // Catat aktivitas
    const ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(res.locals.user.id, 'TAMBAH_USER', 'Menambah user: ' + user_name.trim(), ip);

    res.redirect('/admin/kelola-user?pesan=User+berhasil+ditambahkan');
}

// ============================================================
// POST /kelola-user/hapus
// Hapus user
// ============================================================
function hapusUser(req, res) {
    const { user_id } = req.body;
    const currentUser  = res.locals.user;

    if (!user_id) {
        return res.redirect('/admin/kelola-user?pesan=ID+user+tidak+valid');
    }

    // Tidak bisa hapus diri sendiri
    if (parseInt(user_id) === currentUser.id) {
        return res.redirect('/admin/kelola-user?pesan=Tidak+bisa+menghapus+akun+sendiri');
    }

    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(user_id));
    if (!targetUser) {
        return res.redirect('/admin/kelola-user?pesan=User+tidak+ditemukan');
    }

    // Hapus sesi aktif jika ada
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(parseInt(user_id));
    // Hapus user
    db.prepare('DELETE FROM users WHERE id = ?').run(parseInt(user_id));

    // Catat aktivitas
    const ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(currentUser.id, 'HAPUS_USER', 'Menghapus user: ' + targetUser.user_name, ip);

    res.redirect('/admin/kelola-user?pesan=User+berhasil+dihapus');
}

// ============================================================
// POST /kelola-user/edit
// Edit data user (nama, jabatan, reset password)
// ============================================================
function editUser(req, res) {
    const { user_id, nama_pengguna, jabatan, password_baru, region, nama_depo } = req.body;

    if (!user_id || !nama_pengguna || !jabatan) {
        return res.redirect('/admin/kelola-user?pesan=Data+tidak+lengkap');
    }

    const allowedRoles = ['BOS', 'MANAGER', 'ASIST_MANAGER', 'SA', 'RBM', 'BM', 'ASS', 'SALES'];
    if (!allowedRoles.includes(jabatan)) {
        return res.redirect('/admin/kelola-user?pesan=Jabatan+tidak+valid');
    }

    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(user_id));
    if (!targetUser) {
        return res.redirect('/admin/kelola-user?pesan=User+tidak+ditemukan');
    }

    // Tidak boleh edit admin via form biasa
    if (targetUser.is_admin) {
        return res.redirect('/admin/kelola-user?pesan=Gunakan+menu+Edit+Akun+Dev+untuk+edit+admin');
    }

    if (password_baru && password_baru.trim() !== '') {
        const hashed = crypto.createHash('sha256').update(password_baru).digest('hex');
        db.prepare(`
            UPDATE users SET nama_pengguna = ?, jabatan = ?, password = ?, region = ?, nama_depo = ?, updated_at = datetime('now','localtime')
            WHERE id = ?
        `).run(nama_pengguna.trim(), jabatan, hashed, (region || '').trim(), (nama_depo || '').trim(), parseInt(user_id));
    } else {
        db.prepare(`
            UPDATE users SET nama_pengguna = ?, jabatan = ?, region = ?, nama_depo = ?, updated_at = datetime('now','localtime')
            WHERE id = ?
        `).run(nama_pengguna.trim(), jabatan, (region || '').trim(), (nama_depo || '').trim(), parseInt(user_id));
    }

    // Catat aktivitas
    const ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(res.locals.user.id, 'EDIT_USER', 'Mengedit user: ' + targetUser.user_name, ip);

    res.redirect('/admin/kelola-user?pesan=User+berhasil+diperbarui');
}

// ============================================================
// GET /admin/kelola-user/template
// Download file template Excel untuk upload user massal
// Format: user_name | nama_pengguna | jabatan | password
// ============================================================
function downloadTemplate(req, res) {
    // Buat workbook baru
    var wb = XLSX.utils.book_new();

    // Header + contoh data
    var data = [
        ['user_name', 'nama_pengguna', 'jabatan', 'password'],
        ['budi01',    'Budi Santoso',  'BM',      'pass123'],
        ['sari02',    'Sari Dewi',     'ASS',     'pass456'],
        ['andi03',    'Andi Pratama',   'RBM',     '']
    ];

    var ws = XLSX.utils.aoa_to_sheet(data);

    // Set lebar kolom agar mudah dibaca
    ws['!cols'] = [
        { wch: 15 },  // user_name
        { wch: 25 },  // nama_pengguna
        { wch: 12 },  // jabatan
        { wch: 15 }   // password
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'User');

    // Generate buffer
    var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=template_upload_user.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
}

// ============================================================
// POST /admin/kelola-user/upload-excel
// Upload file Excel → parse → validasi → insert ke database
//
// Kolom yang diperlukan di file Excel:
//   user_name      → Username (wajib, unik)
//   nama_pengguna  → Nama lengkap (wajib)
//   jabatan        → Salah satu: BOS, MANAGER, RBM, BM, ASS (wajib)
//   password       → Password (opsional, default: user_name + '123')
//
// Validasi:
//   - Cek kolom wajib (user_name, nama_pengguna, jabatan)
//   - Cek jabatan valid
//   - Cek duplikasi username (di file & di database)
//   - Tampilkan semua error sekaligus sebelum insert
// ============================================================
function uploadExcel(req, res) {
    var adminUser = res.locals.user;

    // Cek apakah file di-upload
    if (!req.file) {
        return res.redirect('/admin/kelola-user?pesan=Tidak+ada+file+yang+diupload');
    }

    var filePath = req.file.path;

    try {
        // Parse file Excel
        var workbook = XLSX.readFile(filePath);
        var sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            fs.unlinkSync(filePath);
            return res.redirect('/admin/kelola-user?pesan=File+Excel+kosong');
        }

        var sheet = workbook.Sheets[sheetName];
        var rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        // Hapus file temp setelah dibaca
        fs.unlinkSync(filePath);

        if (rows.length === 0) {
            return res.redirect('/admin/kelola-user?pesan=File+Excel+tidak+memiliki+data');
        }

        // -------------------------------------------------------
        // VALIDASI: Cek setiap baris
        // -------------------------------------------------------
        var allowedRoles = ['BOS', 'MANAGER', 'ASIST_MANAGER', 'SA', 'RBM', 'BM', 'ASS', 'SALES'];
        var errors    = [];
        var validRows = [];
        var seenNames = {}; // Cek duplikasi username di dalam file

        rows.forEach(function(row, index) {
            var baris     = index + 2; // +2 karena baris 1 = header
            var userName  = (row.user_name || '').toString().trim();
            var namaPengguna = (row.nama_pengguna || '').toString().trim();
            var jabatan   = (row.jabatan || '').toString().trim().toUpperCase();
            var password  = (row.password || '').toString().trim();

            // Cek kolom wajib
            if (!userName) {
                errors.push('Baris ' + baris + ': user_name kosong');
                return;
            }
            if (!namaPengguna) {
                errors.push('Baris ' + baris + ': nama_pengguna kosong');
                return;
            }
            if (!jabatan) {
                errors.push('Baris ' + baris + ': jabatan kosong');
                return;
            }

            // Cek jabatan valid
            if (!allowedRoles.includes(jabatan)) {
                errors.push('Baris ' + baris + ': jabatan "' + jabatan + '" tidak valid (BOS/MANAGER/ASIST_MANAGER/SA/RBM/BM/ASS/SALES). DEV tidak bisa diimport.');
                return;
            }

            // Cek duplikasi di dalam file
            if (seenNames[userName.toLowerCase()]) {
                errors.push('Baris ' + baris + ': user_name "' + userName + '" duplikat dalam file');
                return;
            }
            seenNames[userName.toLowerCase()] = true;

            // Cek duplikasi di database
            var existing = db.prepare('SELECT id FROM users WHERE user_name = ?').get(userName);
            if (existing) {
                errors.push('Baris ' + baris + ': user_name "' + userName + '" sudah ada di database');
                return;
            }

            // Default password = user_name + '123'
            if (!password) {
                password = userName + '123';
            }

            validRows.push({
                user_name     : userName,
                nama_pengguna : namaPengguna,
                jabatan       : jabatan,
                password      : password
            });
        });

        // Jika ada error → kembalikan semua error, jangan insert apapun
        if (errors.length > 0) {
            var errorMsg = 'Upload gagal. Ditemukan ' + errors.length + ' error:\n' + errors.join('\n');
            return res.redirect('/admin/kelola-user?pesan=' + encodeURIComponent(errorMsg));
        }

        // -------------------------------------------------------
        // INSERT: Masukkan semua baris valid ke database
        // -------------------------------------------------------
        var insertStmt = db.prepare(`
            INSERT INTO users (user_name, password, nama_pengguna, jabatan, is_admin)
            VALUES (?, ?, ?, ?, 0)
        `);

        var insertAll = db.transaction(function(dataRows) {
            dataRows.forEach(function(r) {
                var hashed = crypto.createHash('sha256').update(r.password).digest('hex');
                insertStmt.run(r.user_name, hashed, r.nama_pengguna, r.jabatan);
            });
        });

        insertAll(validRows);

        // Catat aktivitas
        var ip = req.ip || req.connection.remoteAddress;
        db.prepare(`
            INSERT INTO activity_logs (user_id, action, detail, ip_address)
            VALUES (?, ?, ?, ?)
        `).run(adminUser.id, 'UPLOAD_EXCEL', 'Upload ' + validRows.length + ' user dari Excel', ip);

        res.redirect('/admin/kelola-user?pesan=Berhasil+menambahkan+' + validRows.length + '+user+dari+Excel');

    } catch (err) {
        // Hapus file temp jika terjadi error
        try { fs.unlinkSync(filePath); } catch(e) {}

        console.error('Error upload Excel:', err.message);
        res.redirect('/admin/kelola-user?pesan=' + encodeURIComponent('Error membaca file: ' + err.message));
    }
}

// ============================================================
// POST /admin/kelola-user/hapus-semua
// Hapus SEMUA user biasa (is_admin=0)
// Memerlukan verifikasi password admin sebelum eksekusi
// ============================================================
function hapusSemuaUser(req, res) {
    var currentUser = res.locals.user;
    var { admin_password } = req.body;

    if (!admin_password || admin_password.trim() === '') {
        return res.redirect('/admin/kelola-user?pesan=Password+admin+harus+diisi');
    }

    // Verifikasi password admin
    var hashedInput = crypto.createHash('sha256').update(admin_password).digest('hex');
    var adminData = db.prepare('SELECT password FROM users WHERE id = ?').get(currentUser.id);

    if (!adminData || adminData.password !== hashedInput) {
        return res.redirect('/admin/kelola-user?pesan=Password+admin+salah.+Penghapusan+dibatalkan.');
    }

    // Hitung jumlah user yang akan dihapus (non-admin saja)
    var jumlah = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0').get().cnt;

    if (jumlah === 0) {
        return res.redirect('/admin/kelola-user?pesan=Tidak+ada+user+biasa+untuk+dihapus');
    }

    // Hapus semua sesi user biasa
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_admin = 0)').run();

    // Hapus semua user biasa
    db.prepare('DELETE FROM users WHERE is_admin = 0').run();

    // Catat aktivitas
    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(currentUser.id, 'HAPUS_SEMUA_USER', 'Menghapus semua ' + jumlah + ' user biasa', ip);

    // Broadcast update online
    socketManager.broadcastOnlineUpdate();

    res.redirect('/admin/kelola-user?pesan=Berhasil+menghapus+' + jumlah + '+user+biasa');
}

// ============================================================
// POST /admin/kelola-user/edit-admin
// Edit akun DEV (admin) — memerlukan password admin saat ini
// ============================================================
function editAdmin(req, res) {
    var currentUser = res.locals.user;
    var { admin_password, admin_nama, admin_password_baru } = req.body;

    if (!admin_password || admin_password.trim() === '') {
        return res.redirect('/admin/kelola-user?pesan=Password+admin+harus+diisi+untuk+verifikasi');
    }

    // Verifikasi password admin saat ini
    var hashedInput = crypto.createHash('sha256').update(admin_password).digest('hex');
    var adminData = db.prepare('SELECT password FROM users WHERE id = ?').get(currentUser.id);

    if (!adminData || adminData.password !== hashedInput) {
        return res.redirect('/admin/kelola-user?pesan=Password+admin+salah.+Edit+dibatalkan.');
    }

    // Update nama jika diisi
    if (admin_nama && admin_nama.trim() !== '') {
        db.prepare("UPDATE users SET nama_pengguna = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(admin_nama.trim(), currentUser.id);
    }

    // Update password jika diisi
    if (admin_password_baru && admin_password_baru.trim() !== '') {
        var hashedNew = crypto.createHash('sha256').update(admin_password_baru).digest('hex');
        db.prepare("UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(hashedNew, currentUser.id);
    }

    // Catat aktivitas
    var ip = req.ip || req.connection.remoteAddress;
    db.prepare(`
        INSERT INTO activity_logs (user_id, action, detail, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(currentUser.id, 'EDIT_ADMIN', 'Admin mengedit akun sendiri', ip);

    res.redirect('/admin/kelola-user?pesan=Akun+dev+berhasil+diperbarui');
}

module.exports = {
    halamanLogin,
    prosesLogin,
    prosesLogout,
    halamanAdminDashboard,
    halamanKelolaUser,
    tambahUser,
    hapusUser,
    editUser,
    editAdmin,
    downloadTemplate,
    uploadExcel,
    hapusSemuaUser
};

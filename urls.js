// ============================================================
// FILE: urls.js
// FUNGSI: Mengatur semua routing/URL aplikasi
// ALUR: app.js → require('./urls') → register semua route
//
// KONSEP: 2 DUNIA TERPISAH (mirip Django)
//
//   ADMIN (is_admin=1) → /admin/*
//     Akses penuh ke data sistem: kelola user, log aktivitas,
//     riwayat login, upload user via Excel.
//     TIDAK bisa akses modul (kalkulator, dll).
//
//   USER BIASA (is_admin=0) → /beranda, /kalkulator, dll
//     BOS / MANAGER / RBM / BM / ASS
//     Akses beranda + modul-modul. TIDAK bisa lihat
//     log aktivitas, riwayat login, atau data sensitif.
//
// DAFTAR ROUTE:
//   GET  /login                          → Halaman login
//   POST /login                          → Proses login
//   GET  /logout                         → Proses logout
//
//   --- ADMIN ONLY ---
//   GET  /admin                          → Dashboard admin
//   GET  /admin/kelola-user              → Kelola user (CRUD)
//   POST /admin/kelola-user/tambah       → Tambah user manual
//   POST /admin/kelola-user/hapus        → Hapus user
//   POST /admin/kelola-user/hapus-semua   → Hapus semua user biasa (verifikasi password)
//   POST /admin/kelola-user/edit         → Edit user
//   GET  /admin/kelola-user/template     → Download template Excel
//   POST /admin/kelola-user/upload-excel → Upload user dari Excel
//   GET  /admin/aktivitas                → Log aktivitas semua user
//   GET  /admin/riwayat-login            → Riwayat login semua user
//
//   --- USER BIASA ---
//   GET  /beranda                        → Beranda (kartu modul)
//   GET  /kalkulator                     → Kalkulator harga
//   GET  /kalkulator/api/products        → API data produk
//   POST /kalkulator/api/hitung          → API hitung harga
// ============================================================

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const os      = require('os');

// ----------------------------------------------------------
// Konfigurasi multer untuk upload file Excel
// Simpan di folder temp OS, bukan di project
// ----------------------------------------------------------
const upload = multer({
    dest: path.join(os.tmpdir(), 'project_serius_uploads'),
    limits: { fileSize: 5 * 1024 * 1024 }, // Maks 5MB
    fileFilter: function(req, file, cb) {
        var ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
            cb(null, true);
        } else {
            cb(new Error('Hanya file .xlsx, .xls, atau .csv yang diperbolehkan'));
        }
    }
});

// ----------------------------------------------------------
// Import controllers
// ----------------------------------------------------------
const authCtrl      = require('./user_auth/controllers');
const mainCtrl      = require('./src/controllers');
const kalkCtrl      = require('./kalkulator/controllers');
const dashboardCtrl = require('./dashboard/controllers');
const mutasiCtrl    = require('./mutasi/controllers');
const pencapaianCtrl    = require('./pencapaian/controllers');
const gamesCtrl    = require('./games/controllers');
const saCtrl       = require('./sa/controllers');

// ----------------------------------------------------------
// Import middleware
// ----------------------------------------------------------
const { cekLogin, cekAdmin, cekBukanAdmin, cekApprovedAsistMgr, cekSA, catatAktivitas } = require('./src/middleware');

// ============================================================
// ROUTE PUBLIK (tidak perlu login)
// ============================================================
router.get('/login',  authCtrl.halamanLogin);
router.post('/login', authCtrl.prosesLogin);

// ============================================================
// ROUTE PRIVAT UMUM
// ============================================================

// Logout — semua user (admin & biasa)
router.get('/logout', cekLogin, authCtrl.prosesLogout);

// API: Data user online (real-time, RBAC filtering)
router.get('/api/online-users', cekLogin, mainCtrl.apiOnlineUsers);

// API: Heartbeat — browser kirim setiap 60 detik untuk update last_online
// Tanpa catatAktivitas supaya tidak banjir log
router.post('/api/heartbeat', cekLogin, mainCtrl.apiHeartbeat);

// Redirect root → sesuai tipe user
router.get('/', cekLogin, function(req, res) {
    if (res.locals.user && res.locals.user.is_admin) {
        res.redirect('/admin');
    } else if (res.locals.user && res.locals.user.jabatan === 'SA') {
        res.redirect('/sa/dashboard');
    } else {
        res.redirect('/beranda');
    }
});

// ============================================================
// ROUTE ADMIN (hanya is_admin = 1)
// Akses penuh: kelola user, log, riwayat, upload Excel
// TIDAK bisa akses modul (kalkulator, dll)
// ============================================================
router.get('/admin',                          cekLogin, cekAdmin, catatAktivitas, authCtrl.halamanAdminDashboard);
router.get('/admin/kelola-user',              cekLogin, cekAdmin, catatAktivitas, authCtrl.halamanKelolaUser);
router.post('/admin/kelola-user/tambah',      cekLogin, cekAdmin, catatAktivitas, authCtrl.tambahUser);
router.post('/admin/kelola-user/hapus',       cekLogin, cekAdmin, catatAktivitas, authCtrl.hapusUser);
router.post('/admin/kelola-user/hapus-semua',  cekLogin, cekAdmin, catatAktivitas, authCtrl.hapusSemuaUser);
router.post('/admin/kelola-user/edit',        cekLogin, cekAdmin, catatAktivitas, authCtrl.editUser);
router.post('/admin/kelola-user/edit-admin',   cekLogin, cekAdmin, catatAktivitas, authCtrl.editAdmin);
router.get('/admin/kelola-user/template',     cekLogin, cekAdmin, authCtrl.downloadTemplate);
router.post('/admin/kelola-user/upload-excel', cekLogin, cekAdmin, catatAktivitas, upload.single('file_excel'), authCtrl.uploadExcel);
router.get('/admin/aktivitas',                cekLogin, cekAdmin, catatAktivitas, mainCtrl.halamanAktivitas);
router.get('/admin/riwayat-login',            cekLogin, cekAdmin, catatAktivitas, mainCtrl.halamanRiwayatLogin);

// ============================================================
// ROUTE USER BIASA (hanya is_admin = 0)
// BOS / MANAGER / RBM / BM / ASS → beranda + modul
// TIDAK bisa lihat log aktivitas, riwayat login, dll
// ============================================================

// Beranda — landing page (modul mandiri: dashboard/)
router.get('/beranda', cekLogin, cekBukanAdmin, catatAktivitas, dashboardCtrl.halamanBeranda);

// ============================================================
// ROUTE KALKULATOR HARGA (hanya user biasa)
// ============================================================
router.get('/kalkulator',              cekLogin, cekBukanAdmin, cekApprovedAsistMgr, catatAktivitas, kalkCtrl.halamanKalkulator);
router.get('/kalkulator/api/products', cekLogin, cekBukanAdmin, cekApprovedAsistMgr, kalkCtrl.apiGetProducts);
router.post('/kalkulator/api/hitung',  cekLogin, cekBukanAdmin, cekApprovedAsistMgr, kalkCtrl.apiHitung);

// ============================================================
// ROUTE MUTASI ATASAN (hanya user biasa)
// ============================================================
router.get('/mutasi',            cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.halamanMutasi);
router.post('/mutasi/ajukan',    cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.ajukanMutasi);
router.get('/mutasi/approval',   cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.halamanApproval);
router.post('/mutasi/approve',   cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.approveMutasi);
router.post('/mutasi/reject',    cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.rejectMutasi);
router.post('/mutasi/remove',    cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.removeSubordinate);
router.get('/mutasi/history',    cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.halamanHistory);
router.post('/mutasi/ajukan-depo',  cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.ajukanDepo);
router.post('/mutasi/approve-depo', cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.approveDepo);
router.post('/mutasi/reject-depo',  cekLogin, cekBukanAdmin, catatAktivitas, mutasiCtrl.rejectDepo);

// ============================================================
// ROUTE PENCAPAIAN
// ============================================================
router.get('/pencapaian',           cekLogin, cekBukanAdmin, cekApprovedAsistMgr, catatAktivitas, pencapaianCtrl.halamanPencapaian);
router.get('/pencapaian/lph',       cekLogin, cekBukanAdmin, cekApprovedAsistMgr, catatAktivitas, pencapaianCtrl.halamanLPH);
router.get('/pencapaian/scorecard', cekLogin, cekBukanAdmin, cekApprovedAsistMgr, catatAktivitas, pencapaianCtrl.halamanScoreCard);
router.get('/pencapaian/mpp',       cekLogin, cekBukanAdmin, cekApprovedAsistMgr, catatAktivitas, pencapaianCtrl.halamanMPP);
router.get('/pencapaian/stock',     cekLogin, cekBukanAdmin, cekApprovedAsistMgr, catatAktivitas, pencapaianCtrl.halamanStock);

// ============================================================
// ROUTE GAMES
// ============================================================
router.get('/games',           cekLogin, cekBukanAdmin, cekApprovedAsistMgr, catatAktivitas, gamesCtrl.halamanGames);

// ============================================================
// ROUTE SA (hanya jabatan SA)
// Dashboard terpisah + upload data Stock RO & LBP
// ============================================================
const uploadSA = multer({
    dest: path.join(os.tmpdir(), 'project_serius_uploads_sa'),
    limits: { fileSize: 10 * 1024 * 1024 }, // Maks 10MB
    fileFilter: function(req, file, cb) {
        var ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
            cb(null, true);
        } else {
            cb(new Error('Hanya file .xlsx, .xls, atau .csv yang diperbolehkan'));
        }
    }
});

router.get('/sa/dashboard',               cekLogin, cekSA, catatAktivitas, saCtrl.halamanDashboard);
router.get('/sa/upload-data',              cekLogin, cekSA, catatAktivitas, saCtrl.halamanUploadData);
router.post('/sa/upload-data/ro',          cekLogin, cekSA, catatAktivitas, uploadSA.single('file_upload'), saCtrl.uploadRO);
router.post('/sa/upload-data/lbp',         cekLogin, cekSA, catatAktivitas, uploadSA.single('file_upload'), saCtrl.uploadLBP);
router.post('/sa/upload-data/stock',       cekLogin, cekSA, catatAktivitas, uploadSA.single('file_upload'), saCtrl.uploadStock);
router.post('/sa/upload-data/hapus-ro',    cekLogin, cekSA, catatAktivitas, saCtrl.hapusRO);
router.post('/sa/upload-data/hapus-lbp',   cekLogin, cekSA, catatAktivitas, saCtrl.hapusLBP);
router.post('/sa/upload-data/hapus-stock', cekLogin, cekSA, catatAktivitas, saCtrl.hapusStock);

module.exports = router;

// ============================================================
// FILE: dashboard/controllers.js
// FUNGSI: Controller modul Dashboard (Beranda) untuk semua user
// ALUR: urls.js → router → controller ini → render view
//
// HALAMAN:
//   GET /beranda → Halaman utama user setelah login
//
// CATATAN:
//   - Modul ini MANDIRI (self-contained)
//   - Jika folder dashboard/ dihapus, sistem tetap jalan
//   - Tinggal hapus require + route di urls.js dan app.js
//
// DAFTAR MODUL YANG TAMPIL DI BERANDA:
//   Setiap modul didefinisikan di array DAFTAR_MODUL di bawah.
//   Untuk menambah modul baru → tambah entry di array itu saja.
//   Property minLevel mengontrol jabatan minimum yang bisa lihat.
// ============================================================

const { ROLE_LEVEL } = require('../src/middleware');
const db = require('../src/database');
const fs   = require('fs');
const path = require('path');

// ----------------------------------------------------------
// Folder image slider — semua gambar di sini otomatis tampil
// ----------------------------------------------------------
const SLIDER_DIR = path.join(__dirname, 'img', 'image_slider');
const VALID_IMG_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// ----------------------------------------------------------
// DAFTAR MODUL: definisi modul yang tampil di beranda
//
// Kolom:
//   kode      → ID unik modul
//   nama      → Judul modul (ditampilkan di kartu)
//   deskripsi → Penjelasan singkat fungsi modul
//   ikon      → Unicode symbol (karakter HTML entity)
//   url       → URL tujuan saat kartu di-klik
//   warna     → Class CSS untuk warna ikon (kalk-blue, kalk-green, dll)
//   minLevel  → Level jabatan minimum yg bisa akses (1=ASS ... 5=BOS)
//               0 = semua user bisa akses
// ----------------------------------------------------------
const DAFTAR_MODUL = [
    {
        kode      : 'kalkulator',
        nama      : 'Kalkulator Harga',
        deskripsi : 'Simulasi order, hitung diskon, dan total tagihan.',
        ikon      : '&#9881;',
        url       : '/kalkulator',
        warna     : 'modul-blue',
        minLevel  : 0
    }
    // ----------------------------------------------------------
    // Tambah modul baru di sini. Contoh:
    // {
    //     kode      : 'laporan',
    //     nama      : 'Laporan Penjualan',
    //     deskripsi : 'Lihat laporan dan analisis penjualan.',
    //     ikon      : '&#128202;',
    //     url       : '/laporan',
    //     warna     : 'modul-green',
    //     minLevel  : 3  // RBM ke atas
    // }
    // ----------------------------------------------------------
];

// ============================================================
// GET /beranda
// Halaman utama user setelah login
// Tampilkan kartu modul yang tersedia sesuai level user
// ============================================================
function halamanBeranda(req, res) {
    var user      = res.locals.user;
    var userLevel = ROLE_LEVEL[user.jabatan] || 0;

    // ASIST_MANAGER tanpa atasan → restricted view (hanya welcome + banner)
    var asistBelumApproved = (user.jabatan === 'ASIST_MANAGER' && !user.parent_id);

    // Filter modul: hanya tampilkan yg sesuai level user
    var modulTersedia = asistBelumApproved ? [] : DAFTAR_MODUL.filter(function(modul) {
        return userLevel >= modul.minLevel;
    });

    // Ambil data atasan (parent) jika ada
    var atasan = null;
    if (user.parent_id) {
        atasan = db.prepare(
            'SELECT id, user_name, nama_pengguna, jabatan FROM users WHERE id = ?'
        ).get(user.parent_id);
    }

    // Hitung jumlah request approval yang menunggu user ini
    var jumlahApproval = db.prepare(
        "SELECT COUNT(*) as cnt FROM parent_change_requests WHERE new_parent_id = ? AND status = 'PENDING'"
    ).get(user.id).cnt;

    // Baca gambar slider dari folder (otomatis, sorted by filename)
    var sliderImages = [];
    try {
        var files = fs.readdirSync(SLIDER_DIR);
        sliderImages = files
            .filter(function(f) {
                return VALID_IMG_EXT.indexOf(path.extname(f).toLowerCase()) !== -1;
            })
            .sort()
            .map(function(f) {
                return '/dashboard/img/image_slider/' + f;
            });
    } catch(e) {
        // Folder belum ada / error baca — slider kosong saja
    }

    res.render('beranda', {
        title              : 'Beranda',
        user               : user,
        modulTersedia      : modulTersedia,
        atasan             : atasan,
        jumlahApproval     : jumlahApproval,
        sliderImages       : sliderImages,
        asistBelumApproved : asistBelumApproved
    });
}

module.exports = {
    halamanBeranda
};

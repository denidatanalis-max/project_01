// ============================================================
// FILE: index.js
// FUNGSI: Entry point utama aplikasi Express.js
// ============================================================
//
// ALUR APLIKASI:
// 1. index.js memuat konfigurasi Express + Socket.IO
// 2. index.js memuat database dari src/database.js (SQLite auto-create)
// 3. index.js memuat routing dari urls.js
// 4. urls.js mengarahkan request ke controller yang sesuai
// 5. Socket.IO menangani real-time force logout:
//    - Client konek → kirim user_id → server join ke room "user_<id>"
//    - Login baru → server emit "force_logout" ke room user_id lama
//    - Client terima → redirect ke /login
//
// STRUKTUR FOLDER:
// ├── index.js                     ← File ini (entry point + socket.io)
// ├── urls.js                    ← Semua routing URL
// ├── src/
// │   ├── database.js            ← Koneksi & inisialisasi SQLite
// │   ├── middleware.js           ← Middleware auth, role, logging
// │   ├── controllers.js         ← Controller aktivitas & riwayat (admin)
// │   ├── socketManager.js       ← Singleton untuk akses io dari controller
// │   └── views/                 ← Template EJS
// ├── user_auth/
// │   ├── controllers.js         ← Controller login, logout, kelola user
// │   └── views/
// ├── dashboard/                 ← Modul beranda (mandiri)
// ├── kalkulator/                ← Modul kalkulator (mandiri)
// └── public/
//     ├── css/style.css
//     └── js/script.js
// ============================================================

const express       = require('express');
const http          = require('http');
const { Server }    = require('socket.io');
const session       = require('express-session');
const cookieParser  = require('cookie-parser');
const path          = require('path');

// ----------------------------------------------------------
// Inisialisasi Express
// ----------------------------------------------------------
const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ----------------------------------------------------------
// SOCKET MANAGER: Simpan instance io agar bisa dipakai controller
// Controller perlu emit "force_logout" saat login baru
// ----------------------------------------------------------
const socketManager = require('./src/socketManager');
socketManager.init(io);

// ----------------------------------------------------------
// KONFIGURASI: View Engine (EJS)
// Menggunakan 2 folder views: src/views dan user_auth/views
// ----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', [
    path.join(__dirname, 'src', 'views'),
    path.join(__dirname, 'user_auth', 'views'),
    path.join(__dirname, 'kalkulator', 'views'),
    path.join(__dirname, 'dashboard', 'views'),
    path.join(__dirname, 'mutasi', 'views'),
    path.join(__dirname, 'pencapaian', 'views'),
    path.join(__dirname, 'games', 'views'),
    path.join(__dirname, 'sa', 'views')
]);

// ----------------------------------------------------------
// KONFIGURASI: Static files (CSS, JS, gambar)
// Folder public/ bisa diakses langsung dari browser
// ----------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------
// KONFIGURASI: Static files untuk modul kalkulator
// /kalkulator/css/... dan /kalkulator/js/... bisa diakses langsung
// ----------------------------------------------------------
app.use('/kalkulator/css', express.static(path.join(__dirname, 'kalkulator', 'css')));
app.use('/kalkulator/js',  express.static(path.join(__dirname, 'kalkulator', 'js')));

// ----------------------------------------------------------
// KONFIGURASI: Static files untuk modul dashboard (beranda)
// ----------------------------------------------------------
app.use('/dashboard/css', express.static(path.join(__dirname, 'dashboard', 'css')));
app.use('/dashboard/img', express.static(path.join(__dirname, 'dashboard', 'img')));

// ----------------------------------------------------------
// KONFIGURASI: Static files untuk modul games
// /games/css/... dan /games/js/... bisa diakses langsung
// ----------------------------------------------------------
app.use('/games/css', express.static(path.join(__dirname, 'games', 'css')));
app.use('/games/js',  express.static(path.join(__dirname, 'games', 'js')));

// ----------------------------------------------------------
// KONFIGURASI: Static files untuk modul SA
// /sa/css/... bisa diakses langsung
// ----------------------------------------------------------
app.use('/sa/css', express.static(path.join(__dirname, 'sa', 'css')));

// ----------------------------------------------------------
// KONFIGURASI: Body parser (untuk membaca form POST)
// ----------------------------------------------------------
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ----------------------------------------------------------
// KONFIGURASI: Cookie parser
// ----------------------------------------------------------
app.use(cookieParser());

// ----------------------------------------------------------
// KONFIGURASI: Session
// - secret: kunci rahasia untuk enkripsi session
// - resave: false — jangan simpan ulang jika tidak berubah
// - saveUninitialized: false — jangan buat session kosong
// - cookie.maxAge: 8 jam (waktu session habis otomatis)
// - cookie.httpOnly: true — cookie tidak bisa diakses JavaScript
// ----------------------------------------------------------
// SESSION_SECRET: Gunakan nilai tetap agar session tidak invalid saat server restart
// Idealnya simpan di environment variable (.env), bukan hardcode
const SESSION_SECRET = process.env.SESSION_SECRET || 'pma_sales_secret_key_2026_jangan_diubah';

app.use(session({
    secret            : SESSION_SECRET,
    resave            : false,
    saveUninitialized : false,
    cookie            : {
        maxAge   : 8 * 60 * 60 * 1000,   // 8 jam
        httpOnly : true,
        secure   : false                   // set true jika pakai HTTPS
    }
}));

// ----------------------------------------------------------
// KONFIGURASI: Trust proxy (untuk mendapat IP yang benar)
// ----------------------------------------------------------
app.set('trust proxy', true);

// ----------------------------------------------------------
// Inisialisasi database (otomatis buat tabel + seed data)
// ----------------------------------------------------------
require('./src/database');
require('./kalkulator/database');
// ----------------------------------------------------------
// ROUTING: Semua route didefinisikan di urls.js
// ----------------------------------------------------------
const routes = require('./urls');
app.use('/', routes);

// ----------------------------------------------------------
// ERROR HANDLER: 404 Not Found
// ----------------------------------------------------------
app.use(function(req, res) {
    res.status(404).render('error', {
        title : 'Halaman Tidak Ditemukan',
        pesan : 'Halaman yang Anda cari tidak tersedia.',
        user  : res.locals.user || null
    });
});

// ----------------------------------------------------------
// ERROR HANDLER: 500 Server Error
// ----------------------------------------------------------
app.use(function(err, req, res, next) {
    console.error('Server Error:', err);
    res.status(500).render('error', {
        title : 'Kesalahan Server',
        pesan : 'Terjadi kesalahan pada server. Silakan coba lagi.',
        user  : res.locals.user || null
    });
});

// ----------------------------------------------------------
// SOCKET.IO: Handle koneksi WebSocket
//
// ALUR:
//   1. Client konek → emit 'register' dengan { userId, isAdmin }
//   2. Server join socket ke room "user_<id>"
//   3. Jika admin → join juga ke room "admin_dashboard"
//   4. Jika user biasa → join juga ke room "user_dashboard"
//   5. Server kirim data online terkini ke client baru
//   6. Saat disconnect → broadcast update ke semua
// ----------------------------------------------------------
io.on('connection', function(socket) {

    // Client mendaftar dengan user_id dan tipe user
    socket.on('register', function(data) {
        if (!data || !data.userId) return;

        socket.userId = data.userId;
        socket.join('user_' + data.userId);

        if (data.isAdmin) {
            socket.join('admin_dashboard');
        } else {
            socket.join('user_dashboard');
        }

        // Kirim data online terkini ke client yang baru konek
        socketManager.broadcastOnlineUpdate();
    });

    // Bersihkan saat disconnect — broadcast update
    socket.on('disconnect', function() {
        // Beri sedikit delay agar session cleanup selesai dulu
        setTimeout(function() {
            socketManager.broadcastOnlineUpdate();
        }, 500);
    });
});

// ----------------------------------------------------------
// JALANKAN SERVER (http server, bukan app.listen)
// Socket.IO butuh http server untuk attach WebSocket
// ----------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
    console.log('========================================');
    console.log('  Server berjalan di http://localhost:' + PORT);
    console.log('  Socket.IO aktif (real-time logout)');
    console.log('  Login default: admin / admin123');
    console.log('========================================');
});

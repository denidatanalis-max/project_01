// =============================================================
// FILE: public/js/script.js
// FUNGSI: Client-side JavaScript sederhana (tanpa AJAX/library)
// ALUR: Dimuat oleh layout_footer.ejs via <script>
// =============================================================

// =============================================================
// TOP NAVBAR TOGGLE (untuk mobile / layar kecil)
// =============================================================
(function() {
    var tombolToggle = document.getElementById('topnavToggle');
    var topnav       = document.getElementById('topnav');

    if (tombolToggle && topnav) {
        tombolToggle.addEventListener('click', function() {
            topnav.classList.toggle('open');
        });

        // Tutup navbar jika klik di luar (pada mobile)
        document.addEventListener('click', function(e) {
            if (topnav.classList.contains('open')) {
                if (!topnav.contains(e.target) && !tombolToggle.contains(e.target)) {
                    topnav.classList.remove('open');
                }
            }
        });
    }
})();

// =============================================================
// DROPDOWN TOGGLE (untuk mobile — klik untuk buka submenu)
// Di desktop, dropdown buka via hover (CSS). Di mobile, via klik.
// =============================================================
(function() {
    var toggleLinks = document.querySelectorAll('.dropdown-toggle');
    toggleLinks.forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            // Hanya perlu toggle class di mobile
            var parentLi = link.closest('.has-dropdown');
            if (parentLi) {
                parentLi.classList.toggle('open');
            }
        });
    });
})();

// =============================================================
// MODAL EDIT USER
// Fungsi untuk membuka dan menutup modal edit di halaman kelola user
// =============================================================

/**
 * Buka form edit user
 * Dipanggil dari tombol "Edit" di tabel daftar user
 *
 * @param {number} id       - ID user yang akan diedit
 * @param {string} nama     - Nama pengguna saat ini
 * @param {string} jabatan  - Jabatan saat ini
 */
function bukaFormEdit(id, nama, jabatan) {
    var modal = document.getElementById('modalEdit');
    if (!modal) return;

    // Isi form dengan data user yang dipilih
    document.getElementById('edit_user_id').value  = id;
    document.getElementById('edit_nama').value      = nama;
    document.getElementById('edit_jabatan').value   = jabatan;
    document.getElementById('edit_password').value  = '';

    // Tampilkan modal
    modal.style.display = 'flex';
}

/**
 * Tutup modal edit user
 * Dipanggil dari tombol "Batal" atau tombol X di modal
 */
function tutupModal() {
    var modal = document.getElementById('modalEdit');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Tutup modal jika klik pada overlay (di luar box modal)
(function() {
    var modal = document.getElementById('modalEdit');
    if (modal) {
        modal.addEventListener('click', function(e) {
            // Jika yang diklik adalah overlay (bukan box di dalamnya)
            if (e.target === modal) {
                tutupModal();
            }
        });
    }
})();

// =============================================================
// AUTO-HIDE ALERT
// Alert/notifikasi hilang otomatis setelah 5 detik
// =============================================================
(function() {
    var alerts = document.querySelectorAll('.alert');
    if (alerts.length > 0) {
        setTimeout(function() {
            for (var i = 0; i < alerts.length; i++) {
                alerts[i].style.transition = 'opacity 0.5s ease';
                alerts[i].style.opacity    = '0';
                // Hapus dari DOM setelah transisi selesai
                (function(el) {
                    setTimeout(function() {
                        if (el.parentNode) {
                            el.parentNode.removeChild(el);
                        }
                    }, 500);
                })(alerts[i]);
            }
        }, 5000);
    }
})();

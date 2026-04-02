============================================================
README: Image Slider Beranda
============================================================

File ini TIDAK ditampilkan di browser.
Hanya panduan untuk developer / user yang ingin menambah
gambar di halaman Beranda.

------------------------------------------------------------
CARA PAKAI:
------------------------------------------------------------
1. Simpan gambar di folder ini:
   dashboard/img/image_slider/

2. Format yang didukung: .jpg, .jpeg, .png, .gif, .webp

3. Gambar otomatis tampil di carousel halaman /beranda
   Tidak perlu edit kode apapun.

4. Urutan tampil = urutan alfabet nama file.
   Gunakan prefix angka untuk mengatur urutan:
   01_promo_januari.jpg
   02_promo_februari.jpg
   03_banner_diskon.jpg

5. Untuk menghapus gambar dari slider, hapus file dari folder ini.

------------------------------------------------------------
UKURAN GAMBAR YANG DIREKOMENDASIKAN:
------------------------------------------------------------

Rasio aspek : 4:1  (lebar : tinggi)
Ini menghasilkan slider full-width yang tidak terlalu tinggi,
ideal untuk banner/promo di atas konten halaman.

Ukuran piksel yang disarankan:

  ┌──────────────┬───────────────┬──────────────────────┐
  │ Kualitas     │ Resolusi      │ Keterangan           │
  ├──────────────┼───────────────┼──────────────────────┤
  │ Standar      │ 1200 x 300 px │ Cukup untuk umum     │
  │ Bagus        │ 1600 x 400 px │ Rekomendasi          │
  │ Retina/HD    │ 1920 x 480 px │ Terbaik, layar besar │
  └──────────────┴───────────────┴──────────────────────┘

Tips:
- Usahakan semua gambar UKURAN SAMA agar transisi mulus
- Kompres file agar loading cepat (target < 200KB per gambar)
- Gunakan tool: tinypng.com, squoosh.app
- Konten penting di tengah gambar (crop aman kiri-kanan)

------------------------------------------------------------
CATATAN TEKNIS:
------------------------------------------------------------
- Slider auto-play setiap 5 detik
- Transisi fade/slide halus
- Responsive: menyesuaikan lebar layar
- File selain gambar (termasuk .txt ini) diabaikan otomatis
============================================================

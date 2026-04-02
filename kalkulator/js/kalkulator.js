// ============================================================
// FILE: kalkulator/js/kalkulator.js
// FUNGSI: Client-side logic untuk modul Kalkulator Harga
// ALUR: Dimuat oleh kalkulator.ejs → fetch data dari API → render UI
//
// FITUR:
//   1. Fetch data produk dari /kalkulator/api/products
//   2. Render accordion grup + kartu produk
//   3. Keranjang (tambah, hapus, update qty)
//   4. Kirim perhitungan ke /kalkulator/api/hitung
//   5. Tampilkan hasil breakdown diskon
//
// CATATAN:
//   - Vanilla JS, tanpa library
//   - Semua variabel diawali "kalk" untuk hindari konflik
//   - Data produk di-cache di variabel setelah fetch pertama
// ============================================================

// ----------------------------------------------------------
// STATE: Data produk (dari API) dan keranjang (lokal)
// ----------------------------------------------------------
var kalkData = {
    products : [],
    groups   : [],
    members  : [],
    prices   : [],
    promos   : {}
};

// Keranjang: { 'WF001': { qtyKrt: 2, qtyBox: 5 }, ... }
var kalkCart = {};

// Lookup cepat: price per product_code
var kalkPriceMap = {};

// Lookup: product_code → product object
var kalkProductMap = {};

// Lookup: group_code → [product_code, ...]
var kalkGroupProductMap = {};

// ============================================================
// INIT: Jalankan saat halaman dimuat
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    kalkFetchProducts();
    kalkBindEvents();
});

// ============================================================
// FETCH: Ambil data produk dari server
// ============================================================
function kalkFetchProducts() {
    fetch('/kalkulator/api/products')
        .then(function(response) {
            if (!response.ok) throw new Error('Gagal memuat data produk');
            return response.json();
        })
        .then(function(data) {
            kalkData = data;
            kalkBuildLookups();
            kalkRenderGroups();
        })
        .catch(function(err) {
            document.getElementById('kalk-product-groups').innerHTML =
                '<div class="kalk-loading"><p style="color:#e74c3c;">Gagal memuat data: ' +
                kalkEscape(err.message) + '</p></div>';
        });
}

// ----------------------------------------------------------
// Bangun lookup maps dari data yang di-fetch
// ----------------------------------------------------------
function kalkBuildLookups() {
    // Price map: product_code → base_price
    kalkPriceMap = {};
    kalkData.prices.forEach(function(p) {
        kalkPriceMap[p.product_code] = p.base_price;
    });

    // Product map: code → product
    kalkProductMap = {};
    kalkData.products.forEach(function(p) {
        kalkProductMap[p.code] = p;
    });

    // Group → products: dari members
    kalkGroupProductMap = {};
    kalkData.groups.forEach(function(g) {
        kalkGroupProductMap[g.code] = [];
    });

    kalkData.members.forEach(function(m) {
        if (kalkGroupProductMap[m.product_group_code]) {
            kalkGroupProductMap[m.product_group_code].push(m.product_code);
        }
    });
}

// ============================================================
// RENDER: Tampilkan accordion grup + kartu produk
// ============================================================
function kalkRenderGroups() {
    var container = document.getElementById('kalk-product-groups');
    var html = '';

    kalkData.groups.forEach(function(group, index) {
        var productCodes = kalkGroupProductMap[group.code] || [];
        var productsInGroup = productCodes.map(function(code) {
            return kalkProductMap[code];
        }).filter(function(p) { return !!p; });

        // Buka accordion pertama secara default
        var openClass = index === 0 ? ' open' : '';

        html += '<div class="kalk-group' + openClass + '" data-group="' + kalkEscape(group.code) + '">';

        // Header accordion
        html += '<button type="button" class="kalk-group-header" onclick="kalkToggleGroup(this)">';
        html += '<span class="kalk-group-name">';
        html += kalkEscape(group.name);
        html += ' <span class="kalk-group-count">' + productsInGroup.length + ' produk</span>';
        html += '</span>';
        html += '<span class="kalk-group-arrow">&#9654;</span>';
        html += '</button>';

        // Body accordion
        html += '<div class="kalk-group-body">';
        html += '<div class="kalk-product-grid">';

        productsInGroup.forEach(function(product) {
            html += kalkRenderProductCard(product);
        });

        html += '</div>'; // .kalk-product-grid
        html += '</div>'; // .kalk-group-body
        html += '</div>'; // .kalk-group
    });

    container.innerHTML = html;
}

// ----------------------------------------------------------
// Render satu kartu produk
// ----------------------------------------------------------
function kalkRenderProductCard(product) {
    var price  = kalkPriceMap[product.code] || 0;
    var ratio  = product.ratio_unit_2_per_unit_1 || 1;
    var inCart  = !!kalkCart[product.code];
    var cartClass = inCart ? ' in-cart' : '';
    var btnClass  = inCart ? ' in-cart' : '';
    var btnText   = inCart ? 'Hapus' : 'Tambah';

    // Ambil qty dari keranjang jika ada
    var qtyKrt = inCart ? kalkCart[product.code].qtyKrt : 0;
    var qtyBox = inCart ? kalkCart[product.code].qtyBox : 0;

    var html = '';
    html += '<div class="kalk-product-card' + cartClass + '" data-code="' + kalkEscape(product.code) + '">';

    // Info produk
    html += '<div>';
    html += '<div class="kalk-product-name">' + kalkEscape(product.name) + '</div>';
    html += '<div class="kalk-product-code">' + kalkEscape(product.code) + ' &middot; ' + kalkEscape(product.principal_code || '-') + '</div>';
    html += '</div>';

    // Harga
    html += '<div class="kalk-product-price">';
    html += kalkFormatRp(price);
    html += ' <span class="kalk-product-unit">/ ' + kalkEscape(product.unit_1 || 'Krt') + '</span>';
    html += '</div>';

    // Qty controls
    html += '<div class="kalk-qty-controls">';

    // Qty Karton
    html += '<div class="kalk-qty-group">';
    html += '<span class="kalk-qty-label">' + kalkEscape(product.unit_1 || 'Krt') + '</span>';
    html += '<button type="button" class="kalk-qty-btn" onclick="kalkChangeQty(\'' + kalkEscape(product.code) + '\', \'krt\', -1)">-</button>';
    html += '<input type="number" class="kalk-qty-input" id="kalk-qty-krt-' + kalkEscape(product.code) + '" value="' + qtyKrt + '" min="0" onchange="kalkOnQtyChange(\'' + kalkEscape(product.code) + '\')">';
    html += '<button type="button" class="kalk-qty-btn" onclick="kalkChangeQty(\'' + kalkEscape(product.code) + '\', \'krt\', 1)">+</button>';
    html += '</div>';

    // Qty Box
    html += '<div class="kalk-qty-group">';
    html += '<span class="kalk-qty-label">' + kalkEscape(product.unit_2 || 'Box') + '</span>';
    html += '<button type="button" class="kalk-qty-btn" onclick="kalkChangeQty(\'' + kalkEscape(product.code) + '\', \'box\', -1)">-</button>';
    html += '<input type="number" class="kalk-qty-input" id="kalk-qty-box-' + kalkEscape(product.code) + '" value="' + qtyBox + '" min="0" onchange="kalkOnQtyChange(\'' + kalkEscape(product.code) + '\')">';
    html += '<button type="button" class="kalk-qty-btn" onclick="kalkChangeQty(\'' + kalkEscape(product.code) + '\', \'box\', 1)">+</button>';
    html += '</div>';

    // Tombol tambah/hapus
    html += '<button type="button" class="kalk-add-btn' + btnClass + '" onclick="kalkToggleCart(\'' + kalkEscape(product.code) + '\')">' + btnText + '</button>';

    html += '</div>'; // .kalk-qty-controls
    html += '</div>'; // .kalk-product-card

    return html;
}

// ============================================================
// ACCORDION: Toggle buka/tutup grup
// ============================================================
function kalkToggleGroup(headerEl) {
    var groupEl = headerEl.closest('.kalk-group');
    groupEl.classList.toggle('open');
}

// ============================================================
// QTY: Ubah jumlah via tombol +/-
// ============================================================
function kalkChangeQty(productCode, unitType, delta) {
    var inputId = unitType === 'krt'
        ? 'kalk-qty-krt-' + productCode
        : 'kalk-qty-box-' + productCode;

    var input = document.getElementById(inputId);
    if (!input) return;

    var currentVal = parseInt(input.value) || 0;
    var newVal = currentVal + delta;
    if (newVal < 0) newVal = 0;
    input.value = newVal;

    // Jika produk di keranjang, update langsung
    if (kalkCart[productCode]) {
        kalkCart[productCode].qtyKrt = parseInt(document.getElementById('kalk-qty-krt-' + productCode).value) || 0;
        kalkCart[productCode].qtyBox = parseInt(document.getElementById('kalk-qty-box-' + productCode).value) || 0;

        // Hapus dari keranjang kalau semua qty = 0
        if (kalkCart[productCode].qtyKrt === 0 && kalkCart[productCode].qtyBox === 0) {
            delete kalkCart[productCode];
            kalkRenderGroups();
        }

        kalkRenderCart();
    }
}

// ----------------------------------------------------------
// QTY: Saat user ketik langsung di input
// ----------------------------------------------------------
function kalkOnQtyChange(productCode) {
    if (!kalkCart[productCode]) return;

    kalkCart[productCode].qtyKrt = parseInt(document.getElementById('kalk-qty-krt-' + productCode).value) || 0;
    kalkCart[productCode].qtyBox = parseInt(document.getElementById('kalk-qty-box-' + productCode).value) || 0;

    // Hapus kalau semua 0
    if (kalkCart[productCode].qtyKrt === 0 && kalkCart[productCode].qtyBox === 0) {
        delete kalkCart[productCode];
        kalkRenderGroups();
    }

    kalkRenderCart();
}

// ============================================================
// KERANJANG: Tambah / Hapus produk
// ============================================================
function kalkToggleCart(productCode) {
    if (kalkCart[productCode]) {
        // Sudah ada → hapus
        delete kalkCart[productCode];
    } else {
        // Belum ada → tambah dgn qty dari input
        var qtyKrt = parseInt(document.getElementById('kalk-qty-krt-' + productCode).value) || 0;
        var qtyBox = parseInt(document.getElementById('kalk-qty-box-' + productCode).value) || 0;

        // Minimal 1 karton jika belum ada qty
        if (qtyKrt === 0 && qtyBox === 0) {
            qtyKrt = 1;
        }

        kalkCart[productCode] = { qtyKrt: qtyKrt, qtyBox: qtyBox };
    }

    // Re-render kartu produk (update visual in-cart) dan keranjang
    kalkRenderGroups();
    kalkRenderCart();
}

// ============================================================
// KERANJANG: Render daftar item di keranjang
// ============================================================
function kalkRenderCart() {
    var container = document.getElementById('kalk-cart-items');
    var keys = Object.keys(kalkCart);
    var count = keys.length;

    // Update badge
    document.getElementById('kalk-cart-count').textContent = count;
    var floatingBadge = document.getElementById('kalk-floating-badge');
    if (floatingBadge) floatingBadge.textContent = count;

    if (count === 0) {
        container.innerHTML = '<div class="kalk-empty-cart">Belum ada produk di keranjang</div>';
        return;
    }

    var html = '';
    keys.forEach(function(code) {
        var product = kalkProductMap[code];
        if (!product) return;

        var cart = kalkCart[code];
        var ratio = product.ratio_unit_2_per_unit_1 || 1;
        var qtyBoxTotal = (cart.qtyKrt * ratio) + cart.qtyBox;

        // Label qty
        var qtyLabel = '';
        if (cart.qtyKrt > 0) qtyLabel += cart.qtyKrt + ' Krt';
        if (cart.qtyKrt > 0 && cart.qtyBox > 0) qtyLabel += ' + ';
        if (cart.qtyBox > 0) qtyLabel += cart.qtyBox + ' Box';
        if (qtyLabel === '') qtyLabel = '0';

        html += '<div class="kalk-cart-item" data-code="' + kalkEscape(code) + '">';
        html += '<div class="kalk-cart-item-info">';
        html += '<div class="kalk-cart-item-name">' + kalkEscape(product.name) + '</div>';
        html += '<div class="kalk-cart-item-detail">' + kalkEscape(code) + ' &middot; ' + qtyBoxTotal + ' box total</div>';
        html += '</div>';
        html += '<div class="kalk-cart-item-qty">' + qtyLabel + '</div>';
        html += '<button type="button" class="kalk-cart-item-remove" onclick="kalkRemoveFromCart(\'' + kalkEscape(code) + '\')">&times;</button>';
        html += '</div>';
    });

    container.innerHTML = html;
}

// ----------------------------------------------------------
// Hapus item dari keranjang
// ----------------------------------------------------------
function kalkRemoveFromCart(productCode) {
    delete kalkCart[productCode];
    kalkRenderGroups();
    kalkRenderCart();
}

// ============================================================
// HITUNG: Kirim ke server dan tampilkan hasil
// ============================================================
function kalkHitung() {
    var keys = Object.keys(kalkCart);
    if (keys.length === 0) {
        alert('Keranjang kosong. Tambah produk terlebih dahulu.');
        return;
    }

    // Susun data items
    var items = keys.map(function(code) {
        return {
            productCode : code,
            qtyKrt      : kalkCart[code].qtyKrt,
            qtyBox      : kalkCart[code].qtyBox
        };
    });

    var payload = {
        items         : items,
        storeType     : document.getElementById('kalk-store-type').value,
        paymentMethod : document.getElementById('kalk-payment').value,
        voucher       : parseFloat(document.getElementById('kalk-voucher').value) || 0,
        zone          : 'DEFAULT'
    };

    // Disable tombol selama loading
    var btnHitung = document.getElementById('kalk-btn-hitung');
    btnHitung.disabled = true;
    btnHitung.textContent = 'Menghitung...';

    fetch('/kalkulator/api/hitung', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify(payload)
    })
    .then(function(response) {
        if (!response.ok) throw new Error('Server error');
        return response.json();
    })
    .then(function(result) {
        kalkShowResult(result);
    })
    .catch(function(err) {
        alert('Gagal menghitung: ' + err.message);
    })
    .finally(function() {
        btnHitung.disabled = false;
        btnHitung.textContent = 'Hitung';
    });
}

// ----------------------------------------------------------
// Tampilkan hasil perhitungan ke UI
// ----------------------------------------------------------
function kalkShowResult(result) {
    document.getElementById('kalk-total-gross').textContent     = kalkFormatRp(result.totalGross);
    document.getElementById('kalk-diskon-reguler').textContent  = '- ' + kalkFormatRp(result.diskonReguler);
    document.getElementById('kalk-diskon-strata').textContent   = '- ' + kalkFormatRp(result.diskonStrata);
    document.getElementById('kalk-diskon-bundle').textContent   = '- ' + kalkFormatRp(result.diskonBundle);
    document.getElementById('kalk-diskon-flush').textContent    = '- ' + kalkFormatRp(result.diskonFlushOut);
    document.getElementById('kalk-diskon-free').textContent     = '- ' + kalkFormatRp(result.diskonFreeProduct);
    document.getElementById('kalk-diskon-invoice').textContent  = '- ' + kalkFormatRp(result.diskonInvoice);
    document.getElementById('kalk-total-nett').innerHTML        = '<strong>' + kalkFormatRp(result.totalNett) + '</strong>';
    document.getElementById('kalk-final-tagihan').innerHTML     = '<strong>' + kalkFormatRp(result.finalTagihan) + '</strong>';
}

// ============================================================
// RESET: Kosongkan keranjang dan hasil
// ============================================================
function kalkReset() {
    kalkCart = {};
    kalkRenderGroups();
    kalkRenderCart();

    // Reset hasil perhitungan
    document.getElementById('kalk-total-gross').textContent     = 'Rp 0';
    document.getElementById('kalk-diskon-reguler').textContent  = '- Rp 0';
    document.getElementById('kalk-diskon-strata').textContent   = '- Rp 0';
    document.getElementById('kalk-diskon-bundle').textContent   = '- Rp 0';
    document.getElementById('kalk-diskon-flush').textContent    = '- Rp 0';
    document.getElementById('kalk-diskon-free').textContent     = '- Rp 0';
    document.getElementById('kalk-diskon-invoice').textContent  = '- Rp 0';
    document.getElementById('kalk-total-nett').innerHTML        = '<strong>Rp 0</strong>';
    document.getElementById('kalk-final-tagihan').innerHTML     = '<strong>Rp 0</strong>';

    // Reset kontrol
    document.getElementById('kalk-voucher').value = 0;
}

// ============================================================
// BIND EVENTS: Tombol global
// ============================================================
function kalkBindEvents() {
    // Tombol Hitung
    var btnHitung = document.getElementById('kalk-btn-hitung');
    if (btnHitung) {
        btnHitung.addEventListener('click', kalkHitung);
    }

    // Tombol Reset
    var btnReset = document.getElementById('kalk-btn-reset');
    if (btnReset) {
        btnReset.addEventListener('click', kalkReset);
    }

    // Floating cart button (mobile) → toggle cart visibility
    var floatingBtn = document.getElementById('kalk-floating-cart');
    if (floatingBtn) {
        floatingBtn.addEventListener('click', function() {
            var cartCol = document.querySelector('.kalk-cart-col');
            if (cartCol) {
                cartCol.classList.toggle('show');
            }
        });
    }

    // Tutup cart overlay (mobile) saat klik area gelap
    document.addEventListener('click', function(e) {
        var cartCol = document.querySelector('.kalk-cart-col.show');
        if (cartCol && e.target === cartCol) {
            cartCol.classList.remove('show');
        }
    });
}

// ============================================================
// HELPER: Format angka ke Rupiah
// ============================================================
function kalkFormatRp(angka) {
    if (!angka && angka !== 0) return 'Rp 0';
    var num = Math.round(angka);
    var formatted = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'Rp ' + formatted;
}

// ============================================================
// HELPER: Escape HTML untuk mencegah XSS
// ============================================================
function kalkEscape(text) {
    if (text === null || text === undefined) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text)));
    return div.innerHTML;
}

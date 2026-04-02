// ============================================================
// FILE: kalkulator/controllers.js
// FUNGSI: Controller modul kalkulator harga
// ALUR: urls.js → router → controller ini → render view / kirim JSON
//
// HALAMAN:
//   GET  /kalkulator              → Halaman utama kalkulator
//   GET  /kalkulator/api/products → Data produk + grup + harga (JSON)
//   POST /kalkulator/api/hitung   → Hitung total + diskon (JSON)
//
// AKSES: Semua user yang sudah login bisa menggunakan kalkulator
// ============================================================

const db = require('./database');

// ----------------------------------------------------------
// KONSTANTA: PPN 11%
// ----------------------------------------------------------
const PPN_RATE = 0.11;

// ============================================================
// GET /kalkulator
// Render halaman utama kalkulator
// ============================================================
function halamanKalkulator(req, res) {
    var user = res.locals.user;

    res.render('kalkulator', {
        title : 'Kalkulator Harga',
        user  : user
    });
}

// ============================================================
// GET /kalkulator/api/products
// Kirim data produk, grup, member, dan harga dalam format JSON
// Data ini dipakai oleh JavaScript di browser untuk render produk
//
// Response:
// {
//   products: [...],
//   groups: [...],
//   members: [...],
//   prices: [...],
//   promos: { principal: [...], group: [...], invoice: [...] }
// }
// ============================================================
function apiGetProducts(req, res) {
    // Ambil zona dari query (default: 'DEFAULT')
    var zoneCode = req.query.zone || 'DEFAULT';

    // 1. Ambil semua produk
    var products = db.prepare(
        'SELECT * FROM kalk_products ORDER BY name'
    ).all();

    // 2. Ambil semua grup produk (urut prioritas)
    var groups = db.prepare(
        'SELECT * FROM kalk_product_groups ORDER BY priority, code'
    ).all();

    // 3. Ambil member grup (produk → grup)
    var members = db.prepare(
        'SELECT * FROM kalk_group_members ORDER BY product_group_code, priority'
    ).all();

    // 4. Ambil harga per zona
    var prices = db.prepare(
        'SELECT product_code, base_price FROM kalk_prices WHERE zone_code = ?'
    ).all(zoneCode);

    // 5. Ambil semua promo
    var promoPrincipal = db.prepare(
        'SELECT * FROM kalk_promo_principal ORDER BY principal_code, min_purchase_amount'
    ).all();

    var promoGroup = db.prepare(
        'SELECT * FROM kalk_promo_group ORDER BY product_group_code, min_qty'
    ).all();

    var promoInvoice = db.prepare(
        'SELECT * FROM kalk_promo_invoice ORDER BY min_invoice_amount'
    ).all();

    var promoFlushOut = db.prepare(
        'SELECT * FROM kalk_promo_flush_out ORDER BY product_code, min_qty'
    ).all();

    var promoFreeProduct = db.prepare(
        'SELECT * FROM kalk_promo_free_product ORDER BY product_code, min_qty'
    ).all();

    var promoBundle = db.prepare(
        'SELECT * FROM kalk_promo_bundle ORDER BY promo_id, bucket_id, product_code'
    ).all();

    res.json({
        products : products,
        groups   : groups,
        members  : members,
        prices   : prices,
        promos   : {
            principal   : promoPrincipal,
            group       : promoGroup,
            invoice     : promoInvoice,
            flushOut    : promoFlushOut,
            freeProduct : promoFreeProduct,
            bundle      : promoBundle
        }
    });
}

// ============================================================
// POST /kalkulator/api/hitung
// Hitung total harga, diskon, dan final tagihan
//
// Request body:
// {
//   items: [
//     { productCode: 'WF001', qtyKrt: 2, qtyBox: 5 },
//     { productCode: 'BS001', qtyKrt: 1, qtyBox: 0 }
//   ],
//   storeType: 'grosir',
//   paymentMethod: 'COD',
//   voucher: 0,
//   zone: 'DEFAULT'
// }
//
// Response:
// {
//   totalGross, diskonReguler, diskonStrata, diskonBundle,
//   diskonFlushOut, diskonFreeProduct, diskonInvoice,
//   totalNett, finalTagihan,
//   detail: [ ... per item ... ]
// }
// ============================================================
function apiHitung(req, res) {
    var items         = req.body.items         || [];
    var storeType     = req.body.storeType     || 'grosir';
    var paymentMethod = req.body.paymentMethod || 'COD';
    var voucherInput  = parseFloat(req.body.voucher) || 0;
    var zoneCode      = req.body.zone          || 'DEFAULT';

    // Validasi: minimal ada 1 item
    if (items.length === 0) {
        return res.json({
            totalGross       : 0,
            diskonReguler    : 0,
            diskonStrata     : 0,
            diskonBundle     : 0,
            diskonFlushOut   : 0,
            diskonFreeProduct: 0,
            diskonInvoice    : 0,
            totalNett        : 0,
            finalTagihan     : 0,
            detail           : []
        });
    }

    // -------------------------------------------------------
    // LANGKAH 1: Ambil data produk dan harga dari database
    // -------------------------------------------------------
    var productCodes = items.map(function(item) { return item.productCode; });
    var placeholders = productCodes.map(function() { return '?'; }).join(',');

    var productsMap = {};
    var productRows = db.prepare(
        'SELECT * FROM kalk_products WHERE code IN (' + placeholders + ')'
    ).all.apply(db.prepare('SELECT * FROM kalk_products WHERE code IN (' + placeholders + ')'), productCodes);

    productRows.forEach(function(p) {
        productsMap[p.code] = p;
    });

    var pricesMap = {};
    var priceRows = db.prepare(
        'SELECT product_code, base_price FROM kalk_prices WHERE zone_code = ? AND product_code IN (' + placeholders + ')'
    ).all.apply(
        db.prepare('SELECT product_code, base_price FROM kalk_prices WHERE zone_code = ? AND product_code IN (' + placeholders + ')'),
        [zoneCode].concat(productCodes)
    );

    priceRows.forEach(function(p) {
        pricesMap[p.product_code] = p.base_price;
    });

    // -------------------------------------------------------
    // LANGKAH 2: Hitung subtotal per item (Total Gross)
    // base_price = per Karton (unit_1)
    // Konversi: qtyBox total = (qtyKrt * ratio) + qtyBox
    // pricePerBox = base_price / ratio
    // subtotal = qtyBoxTotal * pricePerBox
    // -------------------------------------------------------
    var totalGross = 0;
    var detailItems = [];
    var totalPerPrincipal = {};

    items.forEach(function(item) {
        var product = productsMap[item.productCode];
        if (!product) return;

        var basePrice   = pricesMap[item.productCode] || 0;
        var ratio       = product.ratio_unit_2_per_unit_1 || 1;
        var qtyKrt      = parseInt(item.qtyKrt) || 0;
        var qtyBox      = parseInt(item.qtyBox) || 0;
        var qtyBoxTotal = (qtyKrt * ratio) + qtyBox;
        var pricePerBox = basePrice / ratio;
        var subtotal    = qtyBoxTotal * pricePerBox;

        totalGross += subtotal;

        // Akumulasi per principal untuk diskon reguler
        var principal = (product.principal_code || '').toUpperCase().trim();
        if (principal) {
            totalPerPrincipal[principal] = (totalPerPrincipal[principal] || 0) + subtotal;
        }

        detailItems.push({
            productCode : item.productCode,
            productName : product.name,
            principal   : principal,
            basePrice   : basePrice,
            ratio       : ratio,
            qtyKrt      : qtyKrt,
            qtyBox      : qtyBox,
            qtyBoxTotal : qtyBoxTotal,
            pricePerBox : pricePerBox,
            subtotal    : subtotal
        });
    });

    // -------------------------------------------------------
    // LANGKAH 3: Hitung Diskon Reguler (per principal)
    // Cari tier tertinggi yang terpenuhi (min_purchase ≤ total)
    // -------------------------------------------------------
    var diskonReguler = 0;
    var principalTiers = db.prepare(
        "SELECT * FROM kalk_promo_principal WHERE store_type = ? ORDER BY principal_code, min_purchase_amount DESC"
    ).all(storeType);

    var principalDiscounts = {};

    Object.keys(totalPerPrincipal).forEach(function(principal) {
        var totalBelanja = totalPerPrincipal[principal];
        var bestTier = null;

        principalTiers.forEach(function(tier) {
            if (tier.principal_code.toUpperCase().trim() === principal) {
                if (totalBelanja >= tier.min_purchase_amount) {
                    if (!bestTier || tier.min_purchase_amount > bestTier.min_purchase_amount) {
                        bestTier = tier;
                    }
                }
            }
        });

        if (bestTier) {
            var discPct = bestTier.discount_percentage;
            var discAmount = totalBelanja * (discPct / 100);
            principalDiscounts[principal] = {
                percentage : discPct,
                amount     : discAmount
            };
            diskonReguler += discAmount;
        }
    });

    // -------------------------------------------------------
    // LANGKAH 4: Hitung Diskon Strata (per grup produk)
    // Kumpulkan qty per grup → cari tier tertinggi
    // discount_per_unit * qtyBoxTotal
    // -------------------------------------------------------
    var diskonStrata = 0;
    var qtyPerGroup = {};

    // Ambil member grup
    var allMembers = db.prepare('SELECT * FROM kalk_group_members').all();
    var productToGroup = {};
    allMembers.forEach(function(m) {
        if (!productToGroup[m.product_code]) {
            productToGroup[m.product_code] = [];
        }
        productToGroup[m.product_code].push(m.product_group_code);
    });

    detailItems.forEach(function(d) {
        var groups = productToGroup[d.productCode] || [];
        groups.forEach(function(groupCode) {
            qtyPerGroup[groupCode] = (qtyPerGroup[groupCode] || 0) + d.qtyBoxTotal;
        });
    });

    var groupTiers = db.prepare(
        "SELECT * FROM kalk_promo_group WHERE store_type = ? ORDER BY product_group_code, min_qty DESC"
    ).all(storeType);

    Object.keys(qtyPerGroup).forEach(function(groupCode) {
        var qty = qtyPerGroup[groupCode];
        var bestTier = null;

        groupTiers.forEach(function(tier) {
            if (tier.product_group_code === groupCode && qty >= tier.min_qty) {
                if (!bestTier || tier.min_qty > bestTier.min_qty) {
                    bestTier = tier;
                }
            }
        });

        if (bestTier) {
            diskonStrata += bestTier.discount_per_unit * qty;
        }
    });

    // -------------------------------------------------------
    // LANGKAH 5: Hitung Diskon Flush Out
    // Per produk: cari tier qty tertinggi yang terpenuhi
    // -------------------------------------------------------
    var diskonFlushOut = 0;
    var flushTiers = db.prepare(
        "SELECT * FROM kalk_promo_flush_out WHERE store_type = ? ORDER BY product_code, min_qty DESC"
    ).all(storeType);

    detailItems.forEach(function(d) {
        var bestTier = null;
        flushTiers.forEach(function(tier) {
            if (tier.product_code === d.productCode && d.qtyBoxTotal >= tier.min_qty) {
                if (!bestTier || tier.min_qty > bestTier.min_qty) {
                    bestTier = tier;
                }
            }
        });
        if (bestTier) {
            diskonFlushOut += bestTier.discount_amount * d.qtyBoxTotal;
        }
    });

    // -------------------------------------------------------
    // LANGKAH 6: Hitung Diskon Free Product
    // Jika qty terpenuhi → tambah value gratis
    // -------------------------------------------------------
    var diskonFreeProduct = 0;
    var freeTiers = db.prepare(
        "SELECT * FROM kalk_promo_free_product WHERE store_type = ? ORDER BY product_code, min_qty DESC"
    ).all(storeType);

    detailItems.forEach(function(d) {
        var bestTier = null;
        freeTiers.forEach(function(tier) {
            if (tier.product_code === d.productCode && d.qtyBoxTotal >= tier.min_qty) {
                if (!bestTier || tier.min_qty > bestTier.min_qty) {
                    bestTier = tier;
                }
            }
        });
        if (bestTier) {
            diskonFreeProduct += bestTier.free_value;
        }
    });

    // -------------------------------------------------------
    // LANGKAH 7: Hitung Diskon Bundle (Program Kawin)
    // Semua bucket dalam 1 promo harus terpenuhi
    // -------------------------------------------------------
    var diskonBundle = 0;
    // (Simplified — full bundle logic bisa ditambah nanti)

    // -------------------------------------------------------
    // LANGKAH 8: Hitung Diskon Invoice
    // Berdasarkan total setelah diskon sebelumnya
    // -------------------------------------------------------
    var afterDiscount = totalGross - diskonReguler - diskonStrata - diskonBundle - diskonFlushOut - diskonFreeProduct;
    var diskonInvoice = 0;

    var invoiceTiers = db.prepare(
        "SELECT * FROM kalk_promo_invoice WHERE store_type = ? ORDER BY min_invoice_amount DESC"
    ).all(storeType);

    var bestInvoiceTier = null;
    invoiceTiers.forEach(function(tier) {
        if (afterDiscount >= tier.min_invoice_amount) {
            if (!bestInvoiceTier || tier.min_invoice_amount > bestInvoiceTier.min_invoice_amount) {
                bestInvoiceTier = tier;
            }
        }
    });

    if (bestInvoiceTier) {
        diskonInvoice = afterDiscount * (bestInvoiceTier.discount_percentage / 100);
    }

    // -------------------------------------------------------
    // LANGKAH 9: Hitung Total Nett dan Final Tagihan
    // -------------------------------------------------------
    var totalNett = afterDiscount - diskonInvoice;
    if (totalNett < 0) totalNett = 0;

    var finalTagihan = totalNett - voucherInput;
    if (finalTagihan < 0) finalTagihan = 0;

    // -------------------------------------------------------
    // LANGKAH 10: Kirim response
    // -------------------------------------------------------
    res.json({
        totalGross        : Math.round(totalGross),
        diskonReguler     : Math.round(diskonReguler),
        diskonStrata      : Math.round(diskonStrata),
        diskonBundle      : Math.round(diskonBundle),
        diskonFlushOut    : Math.round(diskonFlushOut),
        diskonFreeProduct : Math.round(diskonFreeProduct),
        diskonInvoice     : Math.round(diskonInvoice),
        totalNett         : Math.round(totalNett),
        finalTagihan      : Math.round(finalTagihan),
        principalDiscounts: principalDiscounts,
        detail            : detailItems
    });
}

module.exports = {
    halamanKalkulator,
    apiGetProducts,
    apiHitung
};

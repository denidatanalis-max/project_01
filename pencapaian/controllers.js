// ============================================================
// FILE: pencapaian/controllers.js
// FUNGSI: Controller untuk modul Pencapaian dan sub-halaman
// ALUR: urls.js → router → controller ini → render view
// ============================================================

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ============================================================
// HELPER: Baca file .busdev / .parquet menggunakan hyparquet
// Gunakan dynamic import() karena hyparquet adalah ESM-only
// ============================================================
async function readBusdevFile(filePath, limit = 500) {
    const { parquetRead, parquetMetadata } = await import('hyparquet');

    const buffer = fs.readFileSync(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const meta = parquetMetadata(arrayBuffer);
    const columns = meta.schema.slice(1).map(s => s.name);

    return new Promise((resolve, reject) => {
        parquetRead({
            file: arrayBuffer,
            rowStart: 0,
            rowEnd: limit,
            onComplete: (rows) => {
                const data = rows.map(row => {
                    const obj = {};
                    columns.forEach((col, i) => { obj[col] = row[i]; });
                    return obj;
                });
                resolve({ columns, rows: data });
            }
        }).catch(reject);
    });
}

// ============================================================
// CONTROLLERS HALAMAN
// ============================================================
function halamanPencapaian(req, res) {
    res.render('halamanPencapaian', {
        title: 'Pencapaian',
        user: res.locals.user
    });
}

function halamanLPH(req, res) {
    res.render('pencapaian_lph', {
        title: 'LPH',
        user: res.locals.user
    });
}

function halamanScoreCard(req, res) {
    res.render('pencapaian_scorecard', {
        title: 'ScoreCard',
        user: res.locals.user
    });
}

function halamanMPP(req, res) {
    res.render('pencapaian_mpp', {
        title: 'MPP',
        user: res.locals.user
    });
}

// ============================================================
// Controller untuk halaman Stock
// ============================================================
function halamanStock(req, res) {
    const databaseDir = path.join(__dirname, 'database');
    let stockFile = null;
    let columns = [];
    let rows = [];

    if (fs.existsSync(databaseDir)) {
        const files = fs.readdirSync(databaseDir);
        const stockFiles = files.filter(file => file.startsWith('Stock') && file.endsWith('.xlsx'));
        if (stockFiles.length > 0) {
            stockFile = path.join(databaseDir, stockFiles[0]);
            const ambilKolom = ["region", "PMA", "Area", "SKU", "Description", "High(CTN)", "Middle(PAC)", "Low(PCS)", "Total in PCS", "Total in CTN"];

            const workbook = XLSX.readFile(stockFile);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];

            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            if (data.length >= 2) {
                const rawHeader = data[1];
                const seen = {};
                const headerMap = [];
                for (let i = 0; i < rawHeader.length; i++) {
                    const trimmed = String(rawHeader[i] || '').trim()
                        .replace(/\(PAC$/, '(PAC)')
                        .replace(/\(PCS$/, '(PCS)')
                        ;
                    if (!seen[trimmed]) {
                        seen[trimmed] = true;
                        headerMap.push({ name: trimmed, idx: i });
                    }
                }
                const colIndices = ambilKolom
                    .map(col => headerMap.find(h => h.name === col))
                    .filter(c => c != null);

                columns = colIndices.map(c => c.name);
                rows = data.slice(2).map(row => {
                    const obj = {};
                    colIndices.forEach(c => { obj[c.name] = row[c.idx] ?? ''; });
                    return obj;
                });
            }
        }
    }

    res.render('pencapaian_stock', {
        title: 'Stock',
        user: res.locals.user,
        stockFile,
        columns,
        rows
    });
}

// ============================================================
// EXPORT CONTROLLERS
// ============================================================
module.exports = {
    halamanPencapaian,
    halamanLPH,
    halamanScoreCard,
    halamanMPP,
    halamanStock,
    readBusdevFile
};
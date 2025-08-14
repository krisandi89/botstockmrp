const { google } = require('googleapis');
const axios = require('axios');

// --- KONFIGURASI ---
const SPREADSHEET_ID = '1i940JEzxFakE_XzNE_sEaJte7l484nBE0FGB0IiJJFg';
const SHEET_NAME = 'FRONT';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');

/**
 * Fungsi untuk mengautentikasi dan mendapatkan instance Google Sheets API
 */
async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: GOOGLE_CREDENTIALS.client_email,
            private_key: GOOGLE_CREDENTIALS.private_key,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

/**
 * Fungsi untuk mencari stok barang di Google Sheet
 * @param {string} itemName - Nama barang yang dicari
 * @returns {Array
|null} - Array data barang jika ditemukan, atau null jika tidak
 */
async function findStock(itemName) {
    try {
        const sheets = await getSheetsClient();
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A7:H`, // Mulai membaca dari baris 7
        });

        let rows = res.data.values;
        if (!rows || rows.length === 0) {
            return null;
        }

        // --- REVISI 1: MENANGANI MERGED CELLS UNTUK BRAND ---
        let lastBrand = '';
        rows = rows.map(row => {
            if (row[0] && row[0].trim() !== '') {
                lastBrand = row[0];
            } else {
                row[0] = lastBrand;
            }
            return row;
        });

        const header = rows[0].map(h => (h || '').toString().toLowerCase().trim().replace(/ /g, '_'));
        const nameIndex = header.indexOf('material');

        if (nameIndex === -1) {
            console.error('Kolom "Material" tidak ditemukan di header (baris 7).');
            return null;
        }
        
        // --- REVISI 2: PENCARIAN FLEKSIBEL (BROAD SEARCH) ---
        const searchTerm = itemName.toLowerCase().replace(/\s/g, '');

        // --- REVISI 3: MENCARI SEMUA HASIL YANG COCOK (FILTER) ---
        const foundRows = rows.slice(1).filter(row => {
            const materialName = row[nameIndex];
            if (materialName) {
                const cleanMaterialName = materialName.toLowerCase().replace(/\s/g, '');
                return cleanMaterialName.includes(searchTerm);
            }
            return false;
        });

        if (foundRows.length === 0) {
            return null; // Tidak ada hasil sama sekali
        }

        // Ubah semua baris yang ditemukan menjadi objek
        return foundRows.map(row => {
            const itemData = {};
            header.forEach((key, index) => {
                itemData[key] = row[index] || 'N/A';
            });
            return itemData;
        });

    } catch (error) {
        console.error('Error saat mengakses Google Sheet:', error);
        return null;
    }
}

/**
 * Fungsi untuk mengirim pesan balasan ke Telegram
 */
async function sendTelegramMessage(chatId, text) {
    // Batasi panjang pesan agar tidak error di Telegram
    const MAX_LENGTH = 4096;
    if (text.length > MAX_LENGTH) {
        text = text.substring(0, MAX_LENGTH - 15) + '... (dan lainya)';
    }
    try {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
        });
    } catch (error) {
        console.error('Error saat mengirim pesan ke Telegram:', error.response ? error.response.data : error.message);
    }
}

/**
 * Fungsi utama yang dijalankan oleh Vercel (Handler)
 */
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }
    
    const { message } = req.body;
    if (!message || !message.text) {
        return res.status(200).send('OK');
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    let replyText = '';

    if (text === '/start') {
        replyText = `👋 Halo ${message.from.first_name}!\n\nSelamat datang di Bot Cek Stok.\nKetik \`/cek_stok [material]\` untuk mencari stok.\n\nContoh: \`/cek_stok Geotextile\``;
    } else if (text.startsWith('/cek_stok')) {
        const itemName = text.substring('/cek_stok'.length).trim();
        if (!itemName) {
            replyText = 'Silakan masukkan nama material yang ingin dicari.\nContoh: `/cek_stok Geotextile`';
        } else {
            const results = await findStock(itemName);
            if (results && results.length > 0) {
                if (results.length === 1) {
                    // Jika hanya ada 1 hasil, tampilkan detail lengkap
                    const itemData = results[0];
                    replyText = `✅ *Stok Ditemukan*\n\n` +
                                `*Brand:* ${itemData.brand}\n` +
                                `*Material:* ${itemData.material}\n` +
                                `*Dimensi Roll:* ${itemData.dimensi_roll}\n` +
                                `*Saldo:* ${itemData.saldo}`;
                } else {
                    // Jika ada banyak hasil, tampilkan daftar ringkas
                    replyText = `✅ Ditemukan *${results.length}* material yang cocok:\n\n`;
                    results.forEach((item, index) => {
                        // Batasi daftar hingga 15 item agar tidak terlalu panjang
                        if (index < 15) {
                            replyText += `• *${item.material}* (Saldo: ${item.saldo})\n`;
                        }
                    });
                     if (results.length > 15) {
                        replyText += `\n... dan ${results.length - 15} lainnya.`;
                    }
                }
            } else {
                replyText = `❌ Maaf, material dengan nama "${itemName}" tidak ditemukan di database.`;
            }
        }
    } else {
        replyText = 'Perintah tidak dikenali. Gunakan `/cek_stok [material]` untuk memulai.';
    }

    await sendTelegramMessage(chatId, replyText);
    res.status(200).send('OK');
};

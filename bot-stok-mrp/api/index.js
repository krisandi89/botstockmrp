const { google } = require('googleapis');
const axios = require('axios');

// --- KONFIGURASI ---
// ID Google Sheet Anda (ambil dari URL)
const SPREADSHEET_ID = '1i940JEzxFakE_XzNE_sEaJte7l484nBE0FGB0IiJJFg'; // ID Sheet BARU

// Nama sheet/tab di dalam file Google Sheet Anda
const SHEET_NAME = 'FRONT'; // Nama sheet diubah ke FRONT

// Token Bot Telegram Anda (dari Environment Variable)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Kredensial Google Service Account (dari Environment Variable)
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
 * @returns {object|null} - Data barang jika ditemukan, atau null jika tidak
 */
async function findStock(itemName) {
    try {
        const sheets = await getSheetsClient();
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:H`, // Baca dari kolom A sampai H
        });

        const rows = res.data.values;
        if (rows && rows.length > 0) {
            // --- PERBAIKAN LOGIKA HEADER ---
            // Mengubah header menjadi format kecil, tanpa spasi, dan underscore
            const header = rows[0].map(h => (h || '').toString().toLowerCase().trim().replace(/ /g, '_'));
            
            // Mencari di kolom 'material'
            const nameIndex = header.indexOf('material');

            if (nameIndex === -1) {
                console.error('Kolom "Material" tidak ditemukan di header sheet. Header yang terdeteksi:', header.join(', '));
                return null;
            }

            // Cari baris yang cocok (case-insensitive dan partial match)
            const searchTerm = itemName.toLowerCase();
            const foundRow = rows.slice(1).find(row => row[nameIndex] && row[nameIndex].toLowerCase().includes(searchTerm));
            
            if (foundRow) {
                // Ubah baris array menjadi objek yang mudah dibaca
                const itemData = {};
                header.forEach((key, index) => {
                    itemData[key] = foundRow[index] || 'N/A';
                });
                return itemData;
            }
        }
        return null; // Tidak ditemukan
    } catch (error) {
        console.error('Error saat mengakses Google Sheet:', error);
        return null;
    }
}

/**
 * Fungsi untuk mengirim pesan balasan ke Telegram
 * @param {number} chatId - ID chat pengguna
 * @param {string} text - Teks pesan yang akan dikirim
 */
async function sendTelegramMessage(chatId, text) {
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
        return res.status(200).send('OK'); // Abaikan update tanpa pesan teks
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    
    let replyText = '';

    if (text === '/start') {
        replyText = `👋 Halo ${message.from.first_name}!\n\nSelamat datang di Bot Cek Stok.\nKetik \`/cek_stok [material]\` untuk mencari stok.\n\nContoh: \`/cek_stok Geotextile Non Woven\``;
    } else if (text.startsWith('/cek_stok')) {
        const itemName = text.substring('/cek_stok'.length).trim();
        if (!itemName) {
            replyText = 'Silakan masukkan nama material yang ingin dicari.\nContoh: `/cek_stok Geotextile Non Woven`';
        } else {
            const itemData = await findStock(itemName);
            if (itemData) {
                // Format balasan sesuai permintaan
                replyText = `✅ *Stok Ditemukan*\n\n` +
                            `*Brand:* ${itemData.brand}\n` +
                            `*Material:* ${itemData.material}\n` +
                            `*Dimensi Roll:* ${itemData.dimensi_roll}\n` +
                            `*Saldo:* ${itemData.saldo}`;
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

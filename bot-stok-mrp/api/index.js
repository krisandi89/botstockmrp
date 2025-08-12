const { google } = require('googleapis');
const axios = require('axios');

// --- KONFIGURASI ---
// ID Google Sheet Anda (ambil dari URL)
// https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
const SPREADSHEET_ID = '1z1XHeUaaAMuEvWm_sVqpORf-Gd1wfANxY6VcDROQRrk'; 

// Nama sheet/tab di dalam file Google Sheet Anda
const SHEET_NAME = 'Stok MRP'; // Nama sheet disesuaikan

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
            // Mengubah header menjadi format kecil_dengan_underscore (contoh: "Nama Barang" -> "nama_barang")
            const header = rows[0].map(h => h.toLowerCase().replace(/ /g, '_'));
            // Mencari di kolom 'nama_barang' (sebelumnya 'Material')
            const nameIndex = header.indexOf('nama_barang');

            if (nameIndex === -1) {
                console.error('Kolom "nama_barang" tidak ditemukan di header sheet. Pastikan sel A1 berisi "nama_barang".');
                return null;
            }

            // Cari baris yang cocok (case-insensitive)
            const foundRow = rows.slice(1).find(row => row[nameIndex] && row[nameIndex].toLowerCase() === itemName.toLowerCase());
            
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
        replyText = `👋 Halo ${message.from.first_name}!\n\nSelamat datang di Bot Cek Stok.\nKetik \`/cek_stok [nama barang]\` untuk mencari stok.\n\nContoh: \`/cek_stok Geogrid TX160\``;
    } else if (text.startsWith('/cek_stok')) {
        const itemName = text.substring('/cek_stok'.length).trim();
        if (!itemName) {
            replyText = 'Silakan masukkan nama barang yang ingin dicari.\nContoh: `/cek_stok Geogrid TX160`';
        } else {
            const itemData = await findStock(itemName);
            if (itemData) {
                // --- PERUBAHAN DIMULAI DI SINI ---
                
                // Menentukan status stok berdasarkan kolom 'jumlah'
                // Jika ada isinya (bukan 'N/A' atau kosong), maka Ready.
                const stokStatus = (itemData.jumlah && itemData.jumlah !== 'N/A') ? 'Ready' : 'Tidak Ready';

                // Menyusun teks balasan sesuai format yang Anda minta
                replyText = `✅ *Barang Ditemukan*\n\n` +
                            `*Nama:* ${itemData.nama_barang}\n` +
                            `*Dimensi:* ${itemData.dimensi}\n` +
                            `*Stok:* ${stokStatus}\n` +
                            `*Jumlah:* ${itemData.jumlah}`;
                
                // --- PERUBAHAN SELESAI DI SINI ---
            } else {
                replyText = `❌ Maaf, barang dengan nama "${itemName}" tidak ditemukan di database.`;
            }
        }
    } else {
        replyText = 'Perintah tidak dikenali. Gunakan `/cek_stok [nama barang]` untuk memulai.';
    }

    await sendTelegramMessage(chatId, replyText);
    
    res.status(200).send('OK');
};

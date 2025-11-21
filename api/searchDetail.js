import fs from "fs";
import path from "path";

let cache = null;

export default function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const book = (req.query.book || "").trim().toLowerCase();
  const number = parseInt(req.query.number);

  // Validasi parameter
  if (!book) {
    return res.status(400).json({ error: "Parameter 'book' diperlukan" });
  }

  if (!number || isNaN(number)) {
    return res.status(400).json({ error: "Parameter 'number' harus berupa angka" });
  }

  // load dataset hanya sekali
  if (!cache) {
    try {
      const filePath = path.join(process.cwd(), "public", "hadist_combined.json");
      const raw = fs.readFileSync(filePath, "utf8");
      cache = JSON.parse(raw);
    } catch (error) {
      return res.status(500).json({ error: "Gagal memuat data hadist", details: error.message });
    }
  }

  // Cari hadist berdasarkan book dan number
  const hadith = cache.find((h) => {
    const hBook = (h.book || "").toLowerCase();
    const hNumber = parseInt(h.number);
    
    return hBook.includes(book) && hNumber === number;
  });

  if (!hadith) {
    return res.status(404).json({ 
      error: "Hadist tidak ditemukan",
      book: book,
      number: number
    });
  }

  res.status(200).json(hadith);
}

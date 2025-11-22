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

  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) {
    return res.status(400).json({ error: "query kosong " });
  }

  // ambil parameter total (default 50, max 100)
  const total = Math.min(parseInt(req.query.max) || 50, 100);

  // ambil parameter book (bisa lebih dari 1, dipisah koma)
  const bookFilter = req.query.book ? 
    req.query.book.toLowerCase().split(',').map(b => b.trim()).filter(Boolean) : 
    [];

  // pecah query jadi kata-kata
  const keywords = q.split(/\s+/).filter(Boolean);

  // Fungsi untuk menghitung similarity (Jaccard similarity)
  const calculateSimilarity = (text, keywords) => {
    const textWords = text.toLowerCase().split(/\s+/).filter(Boolean);
    const textSet = new Set(textWords);
    const keywordSet = new Set(keywords);
    
    // Hitung intersection (kata yang sama)
    const intersection = [...keywordSet].filter(kw => {
      return [...textSet].some(tw => tw.includes(kw) || kw.includes(tw));
    }).length;
    
    // Jaccard similarity
    return intersection / keywordSet.size;
  };

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

  // Simple & fast search untuk semua query
  const results = cache.filter((h) => {
    const indo = (h.indonesia || "").toLowerCase();
    const arab = (h.arab || "").toLowerCase();
    const book = (h.book || "").toLowerCase();

    // Filter berdasarkan buku
    if (bookFilter.length > 0) {
      const matchBook = bookFilter.some(bf => book.includes(bf));
      if (!matchBook) return false;
    }

    // Untuk Arab: exact match
    if (arab.includes(q)) return true;

    // Untuk Indonesia: by word
    return keywords.every((kw) => indo.includes(kw));
  }).map((h) => {
    // Hitung simple score: jumlah kata yang match
    const indo = (h.indonesia || "").toLowerCase();
    const matchCount = keywords.filter(kw => indo.includes(kw)).length;
    
    return {
      ...h,
      _score: matchCount,
      _length: (h.indonesia || "").length
    };
  });

  // Sort: prioritas match count tertinggi (untuk query panjang), lalu text terpendek
  results.sort((a, b) => {
    // Untuk query panjang, prioritaskan yang banyak match
    if (keywords.length > 6 && a._score !== b._score) {
      return b._score - a._score;
    }
    // Sort by length
    return a._length - b._length;
  });

  // Remove scoring fields
  const cleanResults = results.map(({ _score, _length, ...rest }) => rest);

  // Hapus duplikat untuk query panjang
  if (keywords.length > 6) {
    const uniqueResults = [];
    const seenTexts = new Set();

    for (const hadith of cleanResults) {
      const fingerprint = (hadith.indonesia || "").substring(0, 100).toLowerCase().trim();
      
      if (!seenTexts.has(fingerprint)) {
        seenTexts.add(fingerprint);
        uniqueResults.push(hadith);
      }
    }

    return res.status(200).json(uniqueResults.slice(0, total));
  }

  res.status(200).json(cleanResults.slice(0, total));
}

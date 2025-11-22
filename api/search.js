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

  // Fungsi untuk menghitung similarity dengan mempertimbangkan density dan sequence
  const calculateSimilarity = (text, query) => {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    const textWords = textLower.split(/\s+/).filter(Boolean);
    const queryWords = queryLower.split(/\s+/).filter(Boolean);
    
    // 1. Exact substring match - prioritas tertinggi
    if (textLower.includes(queryLower)) {
      return 1.0;
    }
    
    // 2. Hitung berapa kata yang match
    const matchedWords = queryWords.filter(qw => 
      textWords.some(tw => tw.includes(qw) || qw.includes(tw))
    );
    const wordMatchRatio = matchedWords.length / queryWords.length;
    
    // Jika word match < 70%, langsung return
    if (wordMatchRatio < 0.7) {
      return wordMatchRatio * 0.5; // Penalty untuk match rendah
    }
    
    // 3. Hitung density - seberapa rapat kata-kata muncul
    const positions = [];
    matchedWords.forEach(qw => {
      const idx = textWords.findIndex(tw => tw.includes(qw) || qw.includes(tw));
      if (idx !== -1) positions.push(idx);
    });
    
    if (positions.length > 1) {
      positions.sort((a, b) => a - b);
      const span = positions[positions.length - 1] - positions[0] + 1;
      const density = matchedWords.length / span; // Semakin rapat = semakin tinggi
      
      // 4. Combine: word match + density
      return wordMatchRatio * 0.7 + Math.min(density, 1) * 0.3;
    }
    
    return wordMatchRatio;
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

  const results = cache.filter((h) => {
    const indo = (h.indonesia || "").toLowerCase();
    const arab = (h.arab || "").toLowerCase();
    const book = (h.book || "").toLowerCase();

    // Filter berdasarkan buku jika parameter book ada
    if (bookFilter.length > 0) {
      const matchBook = bookFilter.some(bf => book.includes(bf));
      if (!matchBook) return false;
    }

    // Jika query pendek (<= 6 kata), gunakan exact match (kata harus ada, urutan bebas)
    if (keywords.length <= 6) {
      return keywords.every((kw) =>
        indo.includes(kw) || arab.includes(kw)
      );
    }

    // Jika query panjang (> 6 kata), gunakan similarity matching
    const indoSimilarity = calculateSimilarity(indo, q);
    const arabMatch = arab.includes(q); // Arab tetap exact match
    
    // Minimal 70% similarity untuk Indonesia, atau exact match untuk Arab
    return indoSimilarity >= 0.7 || arabMatch;
  }).map((h) => {
    // Tambahkan score untuk sorting
    const indoSimilarity = calculateSimilarity((h.indonesia || "").toLowerCase(), q);
    const arabMatch = (h.arab || "").toLowerCase().includes(q) ? 1.0 : 0;
    
    return {
      ...h,
      _similarity: Math.max(indoSimilarity, arabMatch)
    };
  });

  // Sorting:
  // - Untuk query panjang (> 6 kata): prioritas similarity score tertinggi dulu
  // - Untuk query pendek (<= 6 kata): berdasarkan panjang teks
  const sortedResults = results.sort((a, b) => {
    if (keywords.length > 6) {
      // Prioritaskan similarity score (tertinggi di atas)
      if (b._similarity !== a._similarity) {
        return b._similarity - a._similarity;
      }
    }
    
    // Jika similarity sama atau query pendek, sort by length
    const lengthA = (a.indonesia || "").length;
    const lengthB = (b.indonesia || "").length;
    
    return lengthA - lengthB;
  });

  // Hapus field _similarity sebelum return
  const cleanResults = sortedResults.map(({ _similarity, ...rest }) => rest);

  // Hapus duplikat hanya untuk query panjang (> 6 kata)
  if (keywords.length > 6) {
    const uniqueResults = [];
    const seenTexts = new Set();

    for (const hadith of cleanResults) {
      // Buat fingerprint dari 100 karakter pertama untuk deteksi duplikat
      const fingerprint = (hadith.indonesia || "").substring(0, 100).toLowerCase().trim();
      
      if (!seenTexts.has(fingerprint)) {
        seenTexts.add(fingerprint);
        uniqueResults.push(hadith);
      }
    }

    return res.status(200).json(uniqueResults.slice(0, total));
  }

  // Untuk query pendek, tampilkan semua hasil
  res.status(200).json(cleanResults.slice(0, total));
}

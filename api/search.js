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

  const results = cache.filter((h) => {
    const indo = (h.indonesia || "").toLowerCase();
    const arab = (h.arab || "").toLowerCase();

    // Jika query pendek (<= 6 kata), gunakan exact match (kata harus ada, urutan bebas)
    if (keywords.length <= 6) {
      return keywords.every((kw) =>
        indo.includes(kw) || arab.includes(kw)
      );
    }

    // Jika query panjang (> 6 kata), gunakan similarity matching
    const indoSimilarity = calculateSimilarity(indo, keywords);
    const arabSimilarity = calculateSimilarity(arab, keywords);
    
    // Minimal 70% similarity
    return indoSimilarity >= 0.7 || arabSimilarity >= 0.7;
  }).map((h) => {
    // Tambahkan score untuk sorting
    const indoSimilarity = calculateSimilarity((h.indonesia || "").toLowerCase(), keywords);
    const arabSimilarity = calculateSimilarity((h.arab || "").toLowerCase(), keywords);
    
    return {
      ...h,
      _similarity: Math.max(indoSimilarity, arabSimilarity)
    };
  });

  // Prioritaskan urutan: Shahih al-Bukhari, Shahih Muslim, lalu yang lain
  // Dalam setiap kategori, urutkan dari teks terpendek ke terpanjang
  // Jika ada similarity score, prioritaskan yang lebih tinggi
  const sortedResults = results.sort((a, b) => {
    const bookA = (a.book || "").toLowerCase();
    const bookB = (b.book || "").toLowerCase();
    
    const priorityA = bookA.includes("bukhari") ? 1 : bookA.includes("muslim") ? 2 : 3;
    const priorityB = bookB.includes("bukhari") ? 1 : bookB.includes("muslim") ? 2 : 3;
    
    // Jika prioritas berbeda, urutkan berdasarkan prioritas
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Jika prioritas sama, urutkan berdasarkan similarity score (tertinggi dulu)
    if (a._similarity !== b._similarity) {
      return b._similarity - a._similarity;
    }
    
    // Jika similarity sama, urutkan berdasarkan panjang teks (terpendek dulu)
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

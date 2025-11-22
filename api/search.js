import fs from "fs";
import path from "path";
import Fuse from "fuse.js";

let cache = null;
let fuseIndex = null;

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
      
      // Inisialisasi Fuse.js untuk fuzzy search
      fuseIndex = new Fuse(cache, {
        keys: ['indonesia', 'arab'],
        threshold: 0.3, // 0 = exact match, 1 = match anything (0.3 = cukup ketat)
        ignoreLocation: true, // Cari di seluruh teks, tidak peduli posisi
        minMatchCharLength: 3,
        includeScore: true
      });
    } catch (error) {
      return res.status(500).json({ error: "Gagal memuat data hadist", details: error.message });
    }
  }

  // Gunakan Fuse.js untuk fuzzy search
  let fuseResults = fuseIndex.search(q);
  
  // Filter berdasarkan buku jika parameter book ada
  if (bookFilter.length > 0) {
    fuseResults = fuseResults.filter(result => {
      const book = (result.item.book || "").toLowerCase();
      return bookFilter.some(bf => book.includes(bf));
    });
  }
  
  // Untuk query pendek (<= 6 kata), fallback ke exact match jika hasil Fuse terlalu sedikit
  if (keywords.length <= 6 && fuseResults.length < 10) {
    const exactResults = cache.filter((h) => {
      const indo = (h.indonesia || "").toLowerCase();
      const arab = (h.arab || "").toLowerCase();
      const book = (h.book || "").toLowerCase();

      // Filter berdasarkan buku
      if (bookFilter.length > 0) {
        const matchBook = bookFilter.some(bf => book.includes(bf));
        if (!matchBook) return false;
      }

      return keywords.every((kw) =>
        indo.includes(kw) || arab.includes(kw)
      );
    }).map(item => ({ item, score: 0 })); // score 0 = exact match
    
    // Gabungkan hasil Fuse dengan exact match, hindari duplikat
    const fuseIds = new Set(fuseResults.map(r => r.item.number + r.item.book));
    const additionalResults = exactResults.filter(r => 
      !fuseIds.has(r.item.number + r.item.book)
    );
    
    fuseResults = [...fuseResults, ...additionalResults];
  }

  // Sorting berdasarkan score (semakin kecil semakin relevan) dan panjang teks
  const sortedResults = fuseResults.sort((a, b) => {
    // Prioritaskan score Fuse (semakin kecil semakin baik)
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    
    // Jika score sama, urutkan berdasarkan panjang teks
    const lengthA = (a.item.indonesia || "").length;
    const lengthB = (b.item.indonesia || "").length;
    
    return lengthA - lengthB;
  });

  // Extract item dari hasil Fuse
  const cleanResults = sortedResults.map(r => r.item);

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

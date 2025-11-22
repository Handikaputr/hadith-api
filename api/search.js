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
      
      // Inisialisasi Fuse.js index hanya sekali (bukan per request)
      fuseIndex = new Fuse(cache, {
        keys: ['indonesia', 'arab'],
        threshold: 0.4, // Sedikit lebih longgar untuk performa
        ignoreLocation: true,
        minMatchCharLength: 3,
        includeScore: true,
        useExtendedSearch: false, // Matikan fitur extended untuk speed
        findAllMatches: false, // Stop saat cukup match
        distance: 100 // Batasi distance untuk speed
      });
    } catch (error) {
      return res.status(500).json({ error: "Gagal memuat data hadist", details: error.message });
    }
  }

  // Untuk query pendek (<= 6 kata), gunakan simple search (lebih cepat)
  if (keywords.length <= 6) {
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
    });
    
    // Sort by length
    exactResults.sort((a, b) => {
      return (a.indonesia || "").length - (b.indonesia || "").length;
    });
    
    return res.status(200).json(exactResults.slice(0, total));
  }

  // Gunakan Fuse.js hanya untuk query panjang (> 6 kata)
  let fuseResults = fuseIndex.search(q, { limit: total * 2 }); // Batasi hasil untuk speed
  
  // Filter berdasarkan buku jika parameter book ada
  if (bookFilter.length > 0) {
    fuseResults = fuseResults.filter(result => {
      const book = (result.item.book || "").toLowerCase();
      return bookFilter.some(bf => book.includes(bf));
    });
  }
  
  // Sorting berdasarkan score dan panjang teks
  fuseResults.sort((a, b) => {
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
  const cleanResults = fuseResults.map(r => r.item);

  // Hapus duplikat untuk query panjang
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

  res.status(200).json(uniqueResults.slice(0, total));
}

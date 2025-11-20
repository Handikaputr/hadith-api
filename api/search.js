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
    return res.status(400).json({ error: "query kosong ya sayang 💗" });
  }

  // pecah query jadi kata-kata
  const keywords = q.split(/\s+/).filter(Boolean);

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

    // setiap keyword harus muncul minimal di salah satu field (AND search)
    return keywords.every((kw) =>
      indo.includes(kw) || arab.includes(kw)
    );
  });

  // Prioritaskan urutan: Shahih al-Bukhari, Shahih Muslim, lalu yang lain
  const sortedResults = results.sort((a, b) => {
    const bookA = (a.book || "").toLowerCase();
    const bookB = (b.book || "").toLowerCase();
    
    const priorityA = bookA.includes("bukhari") ? 1 : bookA.includes("muslim") ? 2 : 3;
    const priorityB = bookB.includes("bukhari") ? 1 : bookB.includes("muslim") ? 2 : 3;
    
    return priorityA - priorityB;
  });

  res.status(200).json(sortedResults.slice(0, 50));
}

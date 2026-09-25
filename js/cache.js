// Cache data hasil fetch (Google Sheets) di sessionStorage, supaya saat
// pindah antar halaman (index/spm/peta) yang butuh data sama, tidak perlu
// menunggu fetch ulang selama masih dalam tab yang sama & belum kedaluwarsa.
(function () {
  "use strict";

  const PREFIX = "rapordaerah:";

  function readFresh(key, ttlMs) {
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || typeof entry.ts !== "number") return null;
      if (Date.now() - entry.ts > ttlMs) return null;
      return entry.data;
    } catch (err) {
      return null;
    }
  }

  function write(key, data) {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
    } catch (err) {
      // sessionStorage penuh atau diblokir (mis. mode penyamaran) — lewati
      // saja, halaman tetap jalan tanpa cache (fetch langsung tiap kali).
    }
  }

  window.DataCache = { readFresh, write };
})();

// Util bersama yang dipakai lebih dari satu halaman (index.html, spm.html):
// warna kategori Label Capaian, badge chip, escape HTML, dan indikator tren.
(function () {
  "use strict";

  // Warna tetap per kategori Label Capaian (bukan tangga ordinal): Baik/Tinggi
  // = hijau, Sedang = oranye, Kurang/Rendah = merah, Tidak Tersedia = abu.
  const MUTED = "#898781";
  const GOOD = "#0ca30c";
  const ORANGE = "#eb6834";
  const CRITICAL = "#d03b3b";

  // Kata kunci label, dicek berurutan (yang paling spesifik/negatif duluan
  // supaya "kurang baik" dsb. tidak salah kena cocokkan sebagai "baik").
  const CATEGORY_RULES = [
    { rank: 3, color: MUTED, test: (l) => l.indexOf("tidak tersedia") >= 0 },
    { rank: 2, color: CRITICAL, test: (l) => /rendah|kurang/.test(l) },
    { rank: 0, color: GOOD, test: (l) => /tinggi|baik/.test(l) },
    { rank: 1, color: ORANGE, test: (l) => /sedang|menengah|cukup/.test(l) },
  ];

  function categorize(label) {
    if (!label) return { rank: 3, color: MUTED };
    const l = String(label).toLowerCase();
    for (const rule of CATEGORY_RULES) {
      if (rule.test(l)) return { rank: rule.rank, color: rule.color };
    }
    return { rank: 3, color: MUTED };
  }

  function trendArrow(text) {
    if (!text) return { symbol: "", color: MUTED, text: "-" };
    const t = String(text).toLowerCase();
    if (t.startsWith("naik")) return { symbol: "▲", color: GOOD, text: String(text) };
    if (t.startsWith("turun")) return { symbol: "▼", color: CRITICAL, text: String(text) };
    if (t.startsWith("tetap")) return { symbol: "▬", color: MUTED, text: String(text) };
    return { symbol: "", color: MUTED, text: String(text) };
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** Bangun HTML badge <span class="chip"> untuk sebuah Label Capaian. */
  function chipHtml(label) {
    if (!label) return "<span class='chip chip-muted'>-</span>";
    const color = categorize(label).color;
    return (
      "<span class='chip' style='background:" + color + "' title='" + escapeHtml(label) + "'>" + escapeHtml(label) + "</span>"
    );
  }

  window.Shared = { MUTED, GOOD, ORANGE, CRITICAL, categorize, trendArrow, escapeHtml, chipHtml };
})();

// Helper tipis untuk membaca data dari Google Sheets di sisi browser,
// memanfaatkan Google Visualization API (gviz) yang tersedia gratis untuk
// sheet yang dibagikan "siapa saja yang memiliki link dapat melihat".
// Tidak perlu API key / OAuth.
(function () {
  "use strict";

  /** Ubah "AB" -> 28 (1-based). */
  function colLetterToIndex(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n;
  }

  /** Ubah 28 -> "AB" (1-based). */
  function colIndexToLetter(n) {
    let s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /**
   * Parse referensi 1 sel seperti "2. CAPAIAN KABKOT!E3625" menjadi
   * { sheet, col, row } (kolom huruf, baris angka).
   */
  function parseCellRef(ref) {
    const bangIdx = ref.lastIndexOf("!");
    if (bangIdx === -1) throw new Error("Referensi sel tidak valid: " + ref);
    const sheet = ref.slice(0, bangIdx);
    const cell = ref.slice(bangIdx + 1);
    const m = cell.match(/^([A-Z]+)(\d+)$/);
    if (!m) throw new Error("Format sel tidak dikenali: " + cell);
    return { sheet: sheet, col: m[1], row: parseInt(m[2], 10) };
  }

  /**
   * Parse referensi seperti:
   *   "5. CAPAIAN SATDIK-DASMEN VOKASI!A7:F9312"
   * menjadi { sheet, startCol, startRow, endCol, endRow } (kolom huruf, baris angka).
   */
  function parseRangeRef(ref) {
    const bangIdx = ref.lastIndexOf("!");
    if (bangIdx === -1) throw new Error("Referensi rentang tidak valid: " + ref);
    const sheet = ref.slice(0, bangIdx);
    const range = ref.slice(bangIdx + 1);
    const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!m) throw new Error("Format rentang tidak dikenali: " + range);
    return {
      sheet: sheet,
      startCol: m[1],
      startRow: parseInt(m[2], 10),
      endCol: m[3],
      endRow: parseInt(m[4], 10),
    };
  }

  function gvizUrl(spreadsheetId, sheetName, a1Range) {
    const base = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/gviz/tq";
    const params = new URLSearchParams({
      sheet: sheetName,
      range: a1Range,
      headers: "0",
      tqx: "out:json",
    });
    return base + "?" + params.toString();
  }

  function parseGvizResponse(text) {
    // Respons dibungkus: google.visualization.Query.setResponse({...});
    const start = text.indexOf("(");
    const end = text.lastIndexOf(")");
    if (start === -1 || end === -1) {
      throw new Error("Respons Google Sheets tidak dikenali.");
    }
    const json = JSON.parse(text.slice(start + 1, end));
    if (json.status === "error") {
      const msg = (json.errors && json.errors.map((e) => e.detailed_message).join("; ")) || "unknown error";
      throw new Error("Gagal membaca sheet: " + msg);
    }
    const rows = json.table.rows || [];
    return rows.map((r) =>
      (r.c || []).map((cell) => {
        if (!cell) return null;
        return cell.v !== undefined && cell.v !== null ? cell.v : cell.f ?? null;
      })
    );
  }

  /** Ambil seluruh isi satu sheet (dipakai untuk sheet konfigurasi yang kecil). */
  async function fetchSheetRaw(spreadsheetId, sheetName) {
    const params = new URLSearchParams({ sheet: sheetName, headers: "0", tqx: "out:json" });
    const url = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/gviz/tq?" + params.toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status + " saat mengambil sheet " + sheetName);
    const text = await res.text();
    return parseGvizResponse(text);
  }

  /** Ambil rentang "Sheet!A1:B2" apa adanya (tanpa asumsi baris header di atasnya). */
  async function fetchRange(spreadsheetId, sheetName, a1Range) {
    const url = gvizUrl(spreadsheetId, sheetName, a1Range);
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status + " saat mengambil " + sheetName + "!" + a1Range);
    const text = await res.text();
    return parseGvizResponse(text);
  }

  /**
   * Ambil sebuah rentang "Sheet!A1:B2" dari spreadsheet, mengembalikan
   * { header: [...5 label kolom dari 1 baris di atas startRow...], rows: [[..],[..]] }
   */
  async function fetchRangeWithHeader(spreadsheetId, rangeRef) {
    const parsed = parseRangeRef(rangeRef);
    const headerRow = Math.max(1, parsed.startRow - 1);
    const fullA1 = parsed.startCol + headerRow + ":" + parsed.endCol + parsed.endRow;
    const url = gvizUrl(spreadsheetId, parsed.sheet, fullA1);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("HTTP " + res.status + " saat mengambil " + rangeRef);
    }
    const text = await res.text();
    const table = parseGvizResponse(text);
    const header = table.length ? table[0] : [];
    const rows = table.slice(1);
    return { header, rows, meta: parsed };
  }

  window.Gviz = {
    colLetterToIndex,
    colIndexToLetter,
    parseCellRef,
    parseRangeRef,
    gvizUrl,
    parseGvizResponse,
    fetchSheetRaw,
    fetchRange,
    fetchRangeWithHeader,
  };
})();

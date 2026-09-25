// Pemuatan data satuan pendidikan + indikator dari spreadsheet sumber,
// dipakai bersama oleh index.html (js/app.js) dan peta.html (js/peta.js)
// supaya logika deteksi kolom & penggabungan data tidak dobel.
(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;

  function findFieldIdx(header, regex, excludeIdx) {
    for (let i = 0; i < header.length; i++) {
      if (excludeIdx && excludeIdx.has(i)) continue;
      const h = (header[i] || "").toString().toLowerCase();
      if (regex.test(h)) return i;
    }
    return -1;
  }

  /** Deteksi peran tiap kolom (5 kolom) dalam satu blok indikator dari teks headernya. */
  function detectIndicatorRoles(header) {
    const used = new Set();
    const peringkatIdx = findFieldIdx(header, /peringkat/i);
    if (peringkatIdx >= 0) used.add(peringkatIdx);
    const perubahanNilaiIdx = findFieldIdx(header, /perubahan.*nilai/i, used);
    if (perubahanNilaiIdx >= 0) used.add(perubahanNilaiIdx);
    const perubahanTahunIdx = findFieldIdx(header, /perubahan/i, used);
    if (perubahanTahunIdx >= 0) used.add(perubahanTahunIdx);
    const labelIdx = findFieldIdx(header, /label/i, used);
    if (labelIdx >= 0) used.add(labelIdx);
    // Sisanya (biasanya 1 kolom) dianggap nilai capaian mentah.
    let nilaiIdx = -1;
    for (let i = 0; i < header.length; i++) {
      if (!used.has(i)) {
        nilaiIdx = i;
        break;
      }
    }
    return { nilaiIdx, labelIdx, perubahanTahunIdx, perubahanNilaiIdx, peringkatIdx };
  }

  async function loadIndicatorMap() {
    const raw = await Gviz.fetchSheetRaw(CFG.CONFIG_SHEET_ID, "Sheet1");
    if (raw.length < 2) throw new Error("Sheet konfigurasi kosong / format tidak dikenali.");
    const header = raw[0];
    const refs = raw[1];
    const map = {};
    header.forEach((name, i) => {
      if (name && refs[i]) map[String(name).trim()] = String(refs[i]).trim();
    });
    return map;
  }

  function toNumberOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }

  // Data identitas+indikator sekolah sama persis dipakai index.html & peta.html
  // — di-cache di sessionStorage supaya pindah antar 2 halaman itu tidak
  // perlu menunggu fetch ulang ke Google Sheets selama masih segar.
  const CACHE_KEY = "schoolData:" + CFG.SOURCE_SHEET_ID;
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit

  /** Ambil & gabungkan identitas + semua indikator di CFG.INDICATORS.
   * onProgress(pesan) dipanggil di tiap tahap untuk status loading. */
  async function loadAll(onProgress) {
    const cached = window.DataCache && window.DataCache.readFresh(CACHE_KEY, CACHE_TTL_MS);
    if (cached) {
      onProgress("Memuat data dari cache (tersimpan dari halaman sebelumnya)...");
      return cached;
    }

    onProgress("Membaca peta lokasi data (sheet konfigurasi)...");
    const map = await loadIndicatorMap();

    const identityRef = map["Identitas"];
    if (!identityRef) throw new Error('Kolom "Identitas" tidak ditemukan di sheet konfigurasi.');

    onProgress("Mengambil data identitas satuan pendidikan...");
    const identity = await Gviz.fetchRangeWithHeader(CFG.SOURCE_SHEET_ID, identityRef);

    const indicatorBlocks = [];
    for (const ind of CFG.INDICATORS) {
      const ref = map[ind.key];
      if (!ref) {
        console.warn('Indikator "' + ind.key + '" tidak ada di sheet konfigurasi, dilewati.');
        continue;
      }
      onProgress("Mengambil data indikator: " + ind.label + "...");
      const block = await Gviz.fetchRangeWithHeader(CFG.SOURCE_SHEET_ID, ref);
      const roles = detectIndicatorRoles(block.header);
      indicatorBlocks.push({ key: ind.key, label: ind.label, roles, rows: block.rows });
    }

    onProgress("Menggabungkan data...");
    const schools = identity.rows.map((idRow, i) => {
      const school = {
        npsn: idRow[0] ?? "",
        nama: idRow[1] ?? "",
        jenis: idRow[2] ?? "",
        status: idRow[3] ?? "",
        kabkota: idRow[4] ?? "",
        kecamatan: idRow[5] ?? "",
        indikator: {},
      };
      for (const block of indicatorBlocks) {
        const row = block.rows[i];
        if (!row) {
          school.indikator[block.key] = null;
          continue;
        }
        const r = block.roles;
        school.indikator[block.key] = {
          label: r.labelIdx >= 0 ? row[r.labelIdx] : null,
          nilai: r.nilaiIdx >= 0 ? toNumberOrNull(row[r.nilaiIdx]) : null,
          perubahanTahun: r.perubahanTahunIdx >= 0 ? row[r.perubahanTahunIdx] : null,
          perubahanNilai: r.perubahanNilaiIdx >= 0 ? toNumberOrNull(row[r.perubahanNilaiIdx]) : null,
          peringkat: r.peringkatIdx >= 0 ? row[r.peringkatIdx] : null,
        };
      }
      return school;
    });

    const result = { schools, indicatorBlocks };
    if (window.DataCache) window.DataCache.write(CACHE_KEY, result);
    return result;
  }

  window.SchoolData = { loadAll };
})();

(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { chipHtml, escapeHtml } = window.Shared;

  const el = (id) => document.getElementById(id);

  const state = {
    rows: [], // 1 baris = 1 pasangan (indikator, kabupaten/kota) dgn rujukan selnya sendiri
    indicatorOrder: [], // daftar indikator unik (no+nama), urutan kemunculan pertama
    kabupaten: [],
    cache: {}, // nama kabupaten -> array hasil selaras dgn indicatorOrder
  };

  function setStatus(msg, isError) {
    const box = el("status-box");
    if (!msg) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.textContent = msg;
    box.className = "status-box" + (isError ? " status-error" : "");
  }

  function findCol(header, regex) {
    for (let i = 0; i < header.length; i++) {
      if (regex.test(String(header[i] || "").toLowerCase())) return i;
    }
    return -1;
  }

  const indicatorKey = (no, nama) => no + "|" + nama;

  /** Baca sheet "spm": tiap baris = 1 pasangan (indikator, kabupaten/kota)
   * dengan rujukan sel Label/Nilai Capaian 2025 miliknya sendiri (kolom
   * "Wilayah" menandai kabupaten/kota mana baris itu berlaku), plus daftar
   * nama kabupaten/kota & judul spreadsheet sumbernya (kolom Kabupaten/
   * Sumber data). */
  async function loadSpmConfig() {
    const raw = await Gviz.fetchSheetRaw(CFG.CONFIG_SHEET_ID, CFG.SPM_SHEET_NAME);
    if (raw.length < 2) throw new Error('Sheet "' + CFG.SPM_SHEET_NAME + '" kosong / format tidak dikenali.');
    const header = raw[0];
    const idx = {
      no: findCol(header, /no\.?\s*indikator/),
      nama: findCol(header, /nama indikator/),
      wilayah: findCol(header, /wilayah/),
      label: findCol(header, /label capaian 2025/),
      nilai: findCol(header, /nilai capaian 2025/),
      kab: findCol(header, /^kabupaten$|daftar kabupaten/),
      sumber: findCol(header, /sumber data/),
    };
    for (const [key, i] of Object.entries(idx)) {
      if (i === -1) throw new Error('Kolom "' + key + '" tidak ditemukan di header sheet "' + CFG.SPM_SHEET_NAME + '".');
    }

    const rows = [];
    const indicatorOrder = [];
    const seen = new Set();
    const kabupaten = [];
    for (const row of raw.slice(1)) {
      const no = row[idx.no] ?? "";
      const nama = row[idx.nama] ?? "";
      if (no || nama) {
        rows.push({
          no,
          nama,
          wilayah: row[idx.wilayah] ?? "",
          labelRef: row[idx.label] ?? null,
          nilaiRef: row[idx.nilai] ?? null,
        });
        const key = indicatorKey(no, nama);
        if (!seen.has(key)) {
          seen.add(key);
          indicatorOrder.push({ no, nama });
        }
      }
      if (row[idx.kab]) {
        kabupaten.push({ nama: row[idx.kab], sumberTitle: row[idx.sumber] ?? "" });
      }
    }
    return { rows, indicatorOrder, kabupaten };
  }

  /** Ambil label+nilai capaian 2025 untuk sekumpulan baris (indikator) dari
   * satu spreadsheet kabupaten, dengan sesedikit mungkin request (satu
   * fetch per nama sheet rujukan yang dipakai). */
  async function fetchCellValues(spreadsheetId, rowsWithRefs) {
    const bounds = new Map(); // sheetName -> {minRow,maxRow,minCol,maxCol}
    for (const r of rowsWithRefs) {
      for (const key of ["labelRef", "nilaiRef"]) {
        const ref = r[key];
        if (!ref) continue;
        const parsed = Gviz.parseCellRef(ref);
        const colN = Gviz.colLetterToIndex(parsed.col);
        const b = bounds.get(parsed.sheet) || { minRow: Infinity, maxRow: -Infinity, minCol: Infinity, maxCol: -Infinity };
        b.minRow = Math.min(b.minRow, parsed.row);
        b.maxRow = Math.max(b.maxRow, parsed.row);
        b.minCol = Math.min(b.minCol, colN);
        b.maxCol = Math.max(b.maxCol, colN);
        bounds.set(parsed.sheet, b);
      }
    }

    const tables = new Map(); // sheetName -> {rows, minRow, minCol}
    for (const [sheetName, b] of bounds.entries()) {
      const a1 =
        Gviz.colIndexToLetter(b.minCol) + b.minRow + ":" + Gviz.colIndexToLetter(b.maxCol) + b.maxRow;
      const rows = await Gviz.fetchRange(spreadsheetId, sheetName, a1);
      tables.set(sheetName, { rows, minRow: b.minRow, minCol: b.minCol });
    }

    function readCell(ref) {
      if (!ref) return null;
      const parsed = Gviz.parseCellRef(ref);
      const t = tables.get(parsed.sheet);
      if (!t) return null;
      const r = parsed.row - t.minRow;
      const c = Gviz.colLetterToIndex(parsed.col) - t.minCol;
      const row = t.rows[r];
      return row ? row[c] ?? null : null;
    }

    return rowsWithRefs.map((r) => ({ label: readCell(r.labelRef), nilai: readCell(r.nilaiRef) }));
  }

  function renderTable(values) {
    const table = el("spm-table");
    const tbody = el("spm-body");
    tbody.innerHTML = "";

    state.indicatorOrder.forEach((ind, i) => {
      const v = values[i];
      const tr = document.createElement("tr");

      const tdNo = document.createElement("td");
      tdNo.textContent = ind.no;
      const tdNama = document.createElement("td");
      tdNama.className = "col-truncate";
      tdNama.textContent = ind.nama;
      tdNama.title = ind.nama;
      const tdNilai = document.createElement("td");
      const tdLabel = document.createElement("td");
      tdLabel.className = "col-indicator";

      if (!v || v.label === null || v.label === undefined || v.label === "") {
        tdNilai.textContent = "-";
        tdLabel.innerHTML = "<span class='chip chip-muted'>-</span>";
      } else {
        tdNilai.textContent = v.nilai === null || v.nilai === undefined || v.nilai === "" ? "-" : v.nilai;
        tdLabel.innerHTML = chipHtml(v.label);
      }

      tr.appendChild(tdNo);
      tr.appendChild(tdNama);
      tr.appendChild(tdNilai);
      tr.appendChild(tdLabel);
      tbody.appendChild(tr);
    });

    table.hidden = false;
  }

  async function showKabupaten(nama) {
    const kab = state.kabupaten.find((k) => k.nama === nama);
    if (!kab) return;

    const id = CFG.SPM_SOURCE_BY_TITLE[kab.sumberTitle];
    const sourceLink = el("kab-source-link");
    sourceLink.innerHTML = id
      ? "Sumber data: <a href='https://docs.google.com/spreadsheets/d/" +
        id +
        "/edit' target='_blank' rel='noopener'>" +
        escapeHtml(kab.sumberTitle) +
        "</a>"
      : "";

    if (!id) {
      setStatus('ID spreadsheet sumber untuk "' + kab.sumberTitle + '" belum terdaftar di SPM_SOURCE_BY_TITLE.', true);
      el("spm-table").hidden = true;
      return;
    }

    if (!state.cache[nama]) {
      const rowsForKab = state.rows.filter((r) => r.wilayah === nama);
      if (rowsForKab.length === 0) {
        // Belum ada baris rujukan untuk kabupaten/kota ini di sheet spm —
        // tampilkan daftar indikator apa adanya dgn "-" (Tidak Tersedia).
        state.cache[nama] = state.indicatorOrder.map(() => null);
      } else {
        setStatus("Mengambil data " + nama + "...", false);
        try {
          const values = await fetchCellValues(id, rowsForKab);
          const byKey = {};
          rowsForKab.forEach((r, i) => {
            byKey[indicatorKey(r.no, r.nama)] = values[i];
          });
          state.cache[nama] = state.indicatorOrder.map((ind) => byKey[indicatorKey(ind.no, ind.nama)] || null);
        } catch (err) {
          console.error(err);
          setStatus("Gagal memuat data " + nama + ": " + err.message, true);
          el("spm-table").hidden = true;
          return;
        }
      }
    }

    renderTable(state.cache[nama]);
    setStatus("");
  }

  function renderKabupatenSelect() {
    const select = el("kab-select");
    select.innerHTML = "";
    for (const kab of state.kabupaten) {
      const opt = document.createElement("option");
      opt.value = kab.nama;
      opt.textContent = kab.nama;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => showKabupaten(select.value));
  }

  async function main() {
    try {
      setStatus("Membaca daftar indikator SPM...", false);
      const { rows, indicatorOrder, kabupaten } = await loadSpmConfig();
      if (kabupaten.length === 0) throw new Error("Daftar Kabupaten/Kota tidak ditemukan di sheet spm.");
      state.rows = rows;
      state.indicatorOrder = indicatorOrder;
      state.kabupaten = kabupaten;

      renderKabupatenSelect();
      await showKabupaten(kabupaten[0].nama);
    } catch (err) {
      console.error(err);
      setStatus(
        "Gagal memuat data: " + err.message + ". Pastikan semua spreadsheet sumber dibagikan sebagai “siapa saja yang memiliki link dapat melihat” dan koneksi internet aktif.",
        true
      );
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();

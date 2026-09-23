(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { chipHtml, escapeHtml } = window.Shared;

  const el = (id) => document.getElementById(id);

  const state = {
    indicators: [],
    kabupaten: [],
    cache: {}, // nama kabupaten -> hasil loadKabupatenData
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

  /** Baca sheet "spm": daftar indikator (kol. No/Nama/ref Label/ref Nilai)
   * dan daftar kabupaten/kota (kol. Kabupaten/Sumber data). */
  async function loadSpmConfig() {
    const raw = await Gviz.fetchSheetRaw(CFG.CONFIG_SHEET_ID, CFG.SPM_SHEET_NAME);
    if (raw.length < 2) throw new Error('Sheet "' + CFG.SPM_SHEET_NAME + '" kosong / format tidak dikenali.');
    const header = raw[0];
    const idx = {
      no: findCol(header, /no\.?\s*indikator/),
      nama: findCol(header, /nama indikator/),
      label: findCol(header, /label capaian 2025/),
      nilai: findCol(header, /nilai capaian 2025/),
      kab: findCol(header, /kabupaten/),
      sumber: findCol(header, /sumber data/),
    };
    for (const [key, i] of Object.entries(idx)) {
      if (i === -1) throw new Error('Kolom "' + key + '" tidak ditemukan di header sheet "' + CFG.SPM_SHEET_NAME + '".');
    }

    const indicators = [];
    const kabupaten = [];
    for (const row of raw.slice(1)) {
      if (row[idx.no] || row[idx.nama]) {
        indicators.push({
          no: row[idx.no] ?? "",
          nama: row[idx.nama] ?? "",
          labelRef: row[idx.label] ?? null,
          nilaiRef: row[idx.nilai] ?? null,
        });
      }
      if (row[idx.kab]) {
        kabupaten.push({ nama: row[idx.kab], sumberTitle: row[idx.sumber] ?? "" });
      }
    }
    return { indicators, kabupaten };
  }

  /** Ambil label+nilai capaian 2025 semua indikator untuk satu kabupaten,
   * dengan sesedikit mungkin request (satu fetch per nama sheet rujukan). */
  async function loadKabupatenData(spreadsheetId, indicators) {
    // Kelompokkan rujukan sel per nama sheet, cari batas baris/kolom yang perlu diambil.
    const bounds = new Map(); // sheetName -> {minRow,maxRow,minCol,maxCol}
    for (const ind of indicators) {
      for (const key of ["labelRef", "nilaiRef"]) {
        const ref = ind[key];
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

    return indicators.map((ind) => ({
      label: readCell(ind.labelRef),
      nilai: readCell(ind.nilaiRef),
    }));
  }

  function renderTable(values) {
    const table = el("spm-table");
    const tbody = el("spm-body");
    tbody.innerHTML = "";

    state.indicators.forEach((ind, i) => {
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
      setStatus("Mengambil data " + nama + "...", false);
      try {
        state.cache[nama] = await loadKabupatenData(id, state.indicators);
      } catch (err) {
        console.error(err);
        setStatus("Gagal memuat data " + nama + ": " + err.message, true);
        el("spm-table").hidden = true;
        return;
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
      const { indicators, kabupaten } = await loadSpmConfig();
      if (kabupaten.length === 0) throw new Error("Daftar Kabupaten/Kota tidak ditemukan di sheet spm.");
      state.indicators = indicators;
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

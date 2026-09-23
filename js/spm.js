(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { chipHtml, escapeHtml } = window.Shared;

  const el = (id) => document.getElementById(id);

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
    const refs = [];
    for (const ind of indicators) {
      for (const key of ["labelRef", "nilaiRef"]) {
        const ref = ind[key];
        if (!ref) continue;
        const parsed = Gviz.parseCellRef(ref);
        refs.push(parsed);
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

  function renderTable(indicators, kabupaten, dataByKab) {
    const table = el("spm-table");
    const colgroup = el("spm-colgroup");
    const headRow = el("spm-head-row");
    const tbody = el("spm-body");
    colgroup.innerHTML = "";
    headRow.innerHTML = "";
    tbody.innerHTML = "";

    const noWidth = 6;
    const namaWidth = 20;
    const kabWidth = (100 - noWidth - namaWidth) / kabupaten.length;

    const addCol = (width) => {
      const c = document.createElement("col");
      c.style.width = width + "%";
      colgroup.appendChild(c);
    };
    addCol(noWidth);
    addCol(namaWidth);

    const thNo = document.createElement("th");
    thNo.textContent = "No";
    const thNama = document.createElement("th");
    thNama.textContent = "Nama Indikator";
    thNama.className = "col-truncate";
    headRow.appendChild(thNo);
    headRow.appendChild(thNama);

    for (const kab of kabupaten) {
      addCol(kabWidth);
      const th = document.createElement("th");
      const id = CFG.SPM_SOURCE_BY_TITLE[kab.sumberTitle];
      if (id) {
        const a = document.createElement("a");
        a.href = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = kab.nama;
        th.appendChild(a);
      } else {
        th.textContent = kab.nama;
      }
      headRow.appendChild(th);
    }

    indicators.forEach((ind, i) => {
      const tr = document.createElement("tr");
      const tdNo = document.createElement("td");
      tdNo.textContent = ind.no;
      const tdNama = document.createElement("td");
      tdNama.className = "col-truncate";
      tdNama.textContent = ind.nama;
      tdNama.title = ind.nama;
      tr.appendChild(tdNo);
      tr.appendChild(tdNama);

      for (const kab of kabupaten) {
        const v = (dataByKab[kab.nama] || [])[i];
        const td = document.createElement("td");
        td.className = "col-indicator";
        if (!v || v.label === null || v.label === undefined || v.label === "") {
          td.innerHTML = "<span class='chip chip-muted'>-</span>";
        } else {
          td.innerHTML =
            chipHtml(v.label) +
            (v.nilai !== null && v.nilai !== undefined && v.nilai !== ""
              ? "<span class='spm-value'>" + escapeHtml(v.nilai) + "</span>"
              : "");
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });

    table.hidden = false;
  }

  async function main() {
    try {
      setStatus("Membaca daftar indikator SPM...", false);
      const { indicators, kabupaten } = await loadSpmConfig();
      if (kabupaten.length === 0) throw new Error("Daftar Kabupaten/Kota tidak ditemukan di sheet spm.");

      const missing = kabupaten.filter((k) => !CFG.SPM_SOURCE_BY_TITLE[k.sumberTitle]);
      if (missing.length) {
        console.warn(
          "ID spreadsheet sumber belum terdaftar di SPM_SOURCE_BY_TITLE untuk: " +
            missing.map((k) => k.sumberTitle).join(", ")
        );
      }

      const dataByKab = {};
      for (const kab of kabupaten) {
        const id = CFG.SPM_SOURCE_BY_TITLE[kab.sumberTitle];
        if (!id) {
          dataByKab[kab.nama] = [];
          continue;
        }
        setStatus("Mengambil data " + kab.nama + "...", false);
        dataByKab[kab.nama] = await loadKabupatenData(id, indicators);
      }

      renderTable(indicators, kabupaten, dataByKab);
      setStatus(
        missing.length
          ? "Data sumber belum terdaftar untuk: " + missing.map((k) => k.nama).join(", ") + "."
          : "",
        missing.length > 0
      );
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

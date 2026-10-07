(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { chipHtml } = window.Shared;

  const el = (id) => document.getElementById(id);

  const state = {
    rows: [], // 1 baris = 1 pasangan (kabupaten/kota, indikator) dgn nilai capaiannya langsung
    indicatorOrder: [], // daftar indikator unik (no+nama), urutan kemunculan pertama
    kabupatenList: [], // nama kabupaten/kota unik, urutan kemunculan pertama di sheet
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

  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit

  /** Baca sheet "spm": tiap baris = 1 pasangan (kabupaten/kota, indikator)
   * dengan Label & Nilai Capaian 2025-nya sudah langsung berupa data di
   * sheet ini sendiri (bukan rujukan sel ke spreadsheet lain lagi). Di-cache
   * di sessionStorage supaya balik lagi ke halaman ini dalam tab yang sama
   * tidak perlu fetch ulang. */
  async function loadSpmData() {
    const cacheKey = "spmData:" + CFG.CONFIG_SHEET_ID + ":" + CFG.SPM_SHEET_NAME;
    const cached = window.DataCache && window.DataCache.readFresh(cacheKey, CACHE_TTL_MS);
    if (cached) return cached;

    const raw = await Gviz.fetchSheetRaw(CFG.CONFIG_SHEET_ID, CFG.SPM_SHEET_NAME);
    if (raw.length < 2) throw new Error('Sheet "' + CFG.SPM_SHEET_NAME + '" kosong / format tidak dikenali.');
    const header = raw[0];
    const idx = {
      pemda: findCol(header, /^pemda$|kabupaten\/kota/),
      no: findCol(header, /no\.?\s*indikator/),
      nama: findCol(header, /nama indikator/),
      label: findCol(header, /label capaian 2025/),
      nilai: findCol(header, /nilai capaian 2025/),
    };
    for (const [key, i] of Object.entries(idx)) {
      if (i === -1) throw new Error('Kolom "' + key + '" tidak ditemukan di header sheet "' + CFG.SPM_SHEET_NAME + '".');
    }

    const rows = [];
    const indicatorOrder = [];
    const seenIndicator = new Set();
    const kabupatenList = [];
    const seenKab = new Set();
    for (const row of raw.slice(1)) {
      const pemda = String(row[idx.pemda] ?? "").trim();
      const no = String(row[idx.no] ?? "").trim();
      const nama = String(row[idx.nama] ?? "").trim();
      if (!pemda || (!no && !nama)) continue;

      rows.push({
        pemda,
        no,
        nama,
        label: row[idx.label] ?? null,
        nilai: row[idx.nilai] ?? null,
      });

      const key = indicatorKey(no, nama);
      if (!seenIndicator.has(key)) {
        seenIndicator.add(key);
        indicatorOrder.push({ no, nama });
      }
      if (!seenKab.has(pemda)) {
        seenKab.add(pemda);
        kabupatenList.push(pemda);
      }
    }
    const result = { rows, indicatorOrder, kabupatenList };
    if (window.DataCache) window.DataCache.write(cacheKey, result);
    return result;
  }

  function isBlank(v) {
    return v === null || v === undefined || v === "";
  }

  function renderTable(nama) {
    const table = el("spm-table");
    const tbody = el("spm-body");
    tbody.innerHTML = "";

    const byKey = {};
    for (const r of state.rows) {
      if (r.pemda === nama) byKey[indicatorKey(r.no, r.nama)] = r;
    }

    state.indicatorOrder.forEach((ind) => {
      const r = byKey[indicatorKey(ind.no, ind.nama)];
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

      // Nilai & label ditampilkan independen: sebagian indikator (mis.
      // Kemampuan literasi/numerasi) memang cuma berupa skor tanpa label
      // kategori, jadi label kosong tidak berarti nilainya ikut kosong.
      tdNilai.textContent = !r || isBlank(r.nilai) ? "-" : r.nilai;
      tdLabel.innerHTML = !r || isBlank(r.label) ? "<span class='chip chip-muted'>-</span>" : chipHtml(r.label);

      tr.appendChild(tdNo);
      tr.appendChild(tdNama);
      tr.appendChild(tdNilai);
      tr.appendChild(tdLabel);
      tbody.appendChild(tr);
    });

    table.hidden = false;
  }

  function showKabupaten(nama) {
    renderTable(nama);
    setStatus("");
  }

  function renderKabupatenSelect() {
    const select = el("kab-select");
    select.innerHTML = "";
    for (const nama of state.kabupatenList) {
      const opt = document.createElement("option");
      opt.value = nama;
      opt.textContent = nama;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => showKabupaten(select.value));
  }

  async function main() {
    try {
      setStatus("Membaca data indikator SPM...", false);
      const { rows, indicatorOrder, kabupatenList } = await loadSpmData();
      if (kabupatenList.length === 0) throw new Error("Daftar Kabupaten/Kota tidak ditemukan di sheet spm.");
      state.rows = rows;
      state.indicatorOrder = indicatorOrder;
      state.kabupatenList = kabupatenList;

      renderKabupatenSelect();
      showKabupaten(kabupatenList[0]);
    } catch (err) {
      console.error(err);
      setStatus(
        "Gagal memuat data: " + err.message + ". Pastikan spreadsheet konfigurasi dibagikan sebagai “siapa saja yang memiliki link dapat melihat” dan koneksi internet aktif.",
        true
      );
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();

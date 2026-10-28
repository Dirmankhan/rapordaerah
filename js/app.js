(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { categorize, trendArrow, trendCategory, escapeHtml } = window.Shared;
  const PAGE_SIZE = 25;

  // Opsi tetap untuk filter "Perubahan" (nilai dikembalikan oleh
  // Shared.trendCategory; "" = tidak ada data/tidak dikenali).
  const PERUBAHAN_OPTIONS = [
    { value: "naik", label: "Naik" },
    { value: "turun", label: "Turun" },
    { value: "tetap", label: "Tetap" },
    { value: "", label: "Tidak ada data" },
  ];

  // Urutan tampil kartu "Ringkasan Capaian Indikator Prioritas": grid 4
  // kolom x 2 baris (lihat .summary-grid di CSS) menata kartu mengikuti
  // urutan DOM biasa, jadi susunan array di sini yang menentukan kartu
  // mana jatuh di kolom mana. 3 indikator umum pertama -> kolom 1-3 baris
  // 1, lalu indikator smkOnly pertama (A.4) -> kolom 4 baris 1; 3
  // indikator umum berikutnya -> kolom 1-3 baris 2, lalu indikator
  // smkOnly kedua (D.17) -> kolom 4 baris 2.
  const SUMMARY_CARD_ORDER = (function () {
    const general = CFG.INDICATORS.filter((ind) => !ind.smkOnly);
    const smkOnly = CFG.INDICATORS.filter((ind) => ind.smkOnly);
    if (general.length !== 6 || smkOnly.length !== 2) {
      // Konfigurasi indikator tidak lagi 6 umum + 2 smkOnly seperti
      // diasumsikan di atas — tampilkan apa adanya drpd memaksakan
      // susunan 4 kolom yang sudah tidak relevan.
      return general.concat(smkOnly);
    }
    return [...general.slice(0, 3), smkOnly[0], ...general.slice(3), smkOnly[1]];
  })();

  const state = {
    identityHeader: CFG.IDENTITY_FIELDS,
    schools: [], // hasil merge lengkap
    filtered: [], // hasil filter umum (Kab/Kota, Kecamatan, Jenis, Status, Cari) -> dipakai Ringkasan & result-count
    tableRows: [], // state.filtered, disaring lagi oleh filter Capaian/Perubahan per indikator -> khusus tabel Detail
    filterOptions: {}, // field -> sorted unique values
    filters: { indicatorFilters: {} }, // field -> selected value ("" = semua); indicatorFilters: code -> { capaian: [], perubahan: [] }
    page: 1,
    expandedIdx: null,
    visibleIndicators: CFG.INDICATORS.filter((ind) => !ind.smkOnly),
  };

  function isSMK(jenis) {
    return /smk/i.test(String(jenis || ""));
  }

  /** "Negeri" -> "N", "Swasta" -> "S" (ringkas kolom Status di tabel
   * Detail Satuan Pendidikan); nilai lain ditampilkan apa adanya. */
  function abbreviateStatus(val) {
    const v = String(val || "").trim().toLowerCase();
    if (v === "negeri") return "N";
    if (v === "swasta") return "S";
    return val;
  }

  /** Label Capaian sebuah indikator ("Baik"/"Sedang"/"Kurang" dst., atau
   * "Tidak Tersedia" kalau kosong) — dipakai utk opsi filter Capaian dan
   * perbandingan filter, bukan cuma tampilan. Sheet sumber kadang
   * menyimpan nilainya dengan spasi di ujung (mis. "Baik "), makanya
   * di-trim supaya "Baik " dan "Baik" dianggap sama persis, bukan dua
   * opsi berbeda. */
  function indicatorLabel(v) {
    return v && v.label ? String(v.label).trim() : "Tidak Tersedia";
  }

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

  // ---------------------------------------------------------------------
  // Filter
  // ---------------------------------------------------------------------

  function fieldKeyFor(filterField) {
    return {
      "Kabupaten/Kota": "kabkota",
      Kecamatan: "kecamatan",
      "Jenis Satuan Pendidikan": "jenis",
      "Status Satuan Pendidikan": "status",
    }[filterField];
  }

  /** Mengisi state.filterOptions[field] utk tiap CFG.FILTER_FIELDS — PER
   * FIELD, bukan mengganti seluruh objek state.filterOptions, supaya
   * properti lain yang juga disimpan di situ (capaianByIndicator, diisi
   * computeAllCapaianOptions) tidak ikut terhapus kalau fungsi ini
   * dipanggil ulang (mis. saat Kabupaten/Kota diganti, atau Reset Filter
   * diklik) — itulah penyebab opsi filter Capaian jadi kosong sebelum
   * perbaikan ini. */
  function computeFilterOptions() {
    const selectedKabKota = state.filters["Kabupaten/Kota"];
    for (const { field } of CFG.FILTER_FIELDS) {
      const key = fieldKeyFor(field);
      const set = new Set();
      for (const s of state.schools) {
        // Pilihan Kecamatan dibatasi ke Kabupaten/Kota yang sedang dipilih.
        if (field === "Kecamatan" && selectedKabKota && s.kabkota !== selectedKabKota) continue;
        if (s[key]) set.add(s[key]);
      }
      state.filterOptions[field] = Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
    }
  }

  /** Opsi filter "Capaian" utk tiap indikator, dihitung dari seluruh data
   * (bukan dari hasil filter saat ini) — mis. untuk "A.1" berisi semua
   * label capaian yang benar-benar muncul di data (termasuk "Tidak
   * Tersedia" kalau ada satuan pendidikan tanpa data). */
  function computeAllCapaianOptions() {
    const result = {};
    for (const ind of CFG.INDICATORS) {
      const set = new Set();
      for (const s of state.schools) {
        const v = ind.smkOnly && !isSMK(s.jenis) ? null : s.indikator[ind.key];
        set.add(indicatorLabel(v));
      }
      result[ind.code] = Array.from(set).sort(
        (a, b) => categorize(a).rank - categorize(b).rank || a.localeCompare(b, "id")
      );
    }
    state.filterOptions.capaianByIndicator = result;
  }

  /** State filter Capaian/Perubahan utk satu indikator (dibuat on-demand). */
  function getIndicatorFilterState(code) {
    if (!state.filters.indicatorFilters[code]) {
      state.filters.indicatorFilters[code] = { capaian: [], perubahan: [] };
    }
    return state.filters.indicatorFilters[code];
  }

  /** Filter umum (Kab/Kota, Kecamatan, Jenis, Status, kotak Cari) ->
   * state.filtered, dipakai Ringkasan Capaian Indikator Prioritas &
   * result-count. Filter Capaian/Perubahan per indikator SENGAJA tidak
   * ikut di sini — lihat computeTableRows. */
  function applyFilters() {
    const search = (state.filters.search || "").trim().toLowerCase();
    state.filtered = state.schools.filter((s) => {
      for (const { field, multi } of CFG.FILTER_FIELDS) {
        const key = fieldKeyFor(field);
        const selected = state.filters[field];
        if (multi) {
          if (selected && selected.length > 0 && !selected.includes(s[key])) return false;
        } else if (selected && s[key] !== selected) {
          return false;
        }
      }
      if (search) {
        const hay = (String(s.npsn) + " " + s.nama).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  /** state.filtered, disaring lagi oleh filter Capaian/Perubahan per
   * indikator -> state.tableRows, khusus dipakai tabel Detail Satuan
   * Pendidikan (tidak mempengaruhi Ringkasan Capaian Indikator Prioritas
   * ataupun result-count, yang tetap berdasarkan state.filtered). */
  function computeTableRows() {
    const indicatorFilters = state.filters.indicatorFilters || {};
    state.tableRows = state.filtered.filter((s) => {
      for (const ind of CFG.INDICATORS) {
        const fs = indicatorFilters[ind.code];
        if (!fs || (fs.capaian.length === 0 && fs.perubahan.length === 0)) continue;
        const v = ind.smkOnly && !isSMK(s.jenis) ? null : s.indikator[ind.key];
        const label = indicatorLabel(v);
        if (fs.capaian.length > 0 && !fs.capaian.includes(label)) return false;
        if (fs.perubahan.length > 0) {
          const cat = trendCategory(v && v.perubahanTahun);
          if (!fs.perubahan.includes(cat)) return false;
        }
      }
      return true;
    });
  }

  // ---------------------------------------------------------------------
  // Render: filter controls
  // ---------------------------------------------------------------------

  function onKabKotaChanged() {
    // Pilihan Kecamatan mengikuti Kabupaten/Kota yang dipilih.
    computeFilterOptions();
    if (Array.isArray(state.filters.Kecamatan)) {
      state.filters.Kecamatan = state.filters.Kecamatan.filter((v) => state.filterOptions.Kecamatan.includes(v));
    }
    renderFilterControls();
  }

  function buildSingleSelect(field) {
    const select = document.createElement("select");
    select.dataset.field = field;
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Semua";
    select.appendChild(optAll);
    for (const val of state.filterOptions[field] || []) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      select.appendChild(opt);
    }
    select.value = state.filters[field] || "";
    select.addEventListener("change", () => {
      state.filters[field] = select.value;
      if (field === "Kabupaten/Kota") onKabKotaChanged();
      refresh();
    });
    return select;
  }

  function buildMultiSelect(field) {
    const options = state.filterOptions[field] || [];
    const selected = Array.isArray(state.filters[field]) ? state.filters[field] : [];

    const box = document.createElement("div");
    box.className = "multiselect";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "multiselect-btn";
    const updateBtnLabel = () => {
      btn.textContent =
        selected.length === 0 ? "Semua" : selected.length === 1 ? selected[0] : selected.length + " dipilih";
    };
    updateBtnLabel();

    const panel = document.createElement("div");
    panel.className = "multiselect-panel";
    panel.hidden = true;
    panel.addEventListener("click", (e) => e.stopPropagation());

    const actions = document.createElement("div");
    actions.className = "multiselect-actions";
    const selectAllBtn = document.createElement("button");
    selectAllBtn.type = "button";
    selectAllBtn.textContent = "Pilih semua";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Hapus semua";
    actions.appendChild(selectAllBtn);
    actions.appendChild(clearBtn);
    panel.appendChild(actions);

    const checkboxes = [];
    for (const val of options) {
      const optLabel = document.createElement("label");
      optLabel.className = "multiselect-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = val;
      cb.checked = selected.includes(val);
      cb.addEventListener("change", () => {
        const idx = selected.indexOf(val);
        if (cb.checked && idx === -1) selected.push(val);
        if (!cb.checked && idx !== -1) selected.splice(idx, 1);
        state.filters[field] = selected;
        updateBtnLabel();
        refresh();
      });
      optLabel.appendChild(cb);
      optLabel.appendChild(document.createTextNode(val));
      panel.appendChild(optLabel);
      checkboxes.push(cb);
    }

    selectAllBtn.addEventListener("click", () => {
      selected.splice(0, selected.length, ...options);
      checkboxes.forEach((cb) => (cb.checked = true));
      state.filters[field] = selected;
      updateBtnLabel();
      refresh();
    });
    clearBtn.addEventListener("click", () => {
      selected.splice(0, selected.length);
      checkboxes.forEach((cb) => (cb.checked = false));
      state.filters[field] = selected;
      updateBtnLabel();
      refresh();
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      closeAllMultiSelectPanels();
      panel.hidden = !willOpen;
    });

    box.appendChild(btn);
    box.appendChild(panel);
    return box;
  }

  function closeAllMultiSelectPanels() {
    document.querySelectorAll(".multiselect-panel").forEach((p) => (p.hidden = true));
  }

  /** Dropdown multi-pilih generik dari daftar {value, label} + array terpilih
   * (dimodifikasi in-place), dipakai utk filter Capaian & Perubahan pada
   * tabel Detail Satuan Pendidikan. `opts.compact` memakai gaya ringkas
   * (tombol sekecil kotak kode indikator di header, panel dropdown
   * ditengahkan) utk dipasang di dalam sel header kolom indikator yang
   * sempit. */
  function buildValueMultiSelect(options, selected, onChange, opts) {
    opts = opts || {};

    const box = document.createElement("div");
    box.className = "multiselect" + (opts.compact ? " multiselect-compact" : "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "multiselect-btn";
    const optLookup = new Map(options.map((o) => [o.value, o.label]));
    const updateBtnLabel = () => {
      btn.textContent =
        selected.length === 0
          ? "Semua"
          : selected.length === 1
          ? optLookup.get(selected[0]) ?? selected[0]
          : selected.length + " dipilih";
    };
    if (opts.disabled) {
      btn.disabled = true;
      btn.textContent = opts.disabledText || "Semua";
    } else {
      updateBtnLabel();
    }

    const panel = document.createElement("div");
    panel.className = "multiselect-panel";
    panel.hidden = true;
    panel.addEventListener("click", (e) => e.stopPropagation());

    const actions = document.createElement("div");
    actions.className = "multiselect-actions";
    const selectAllBtn = document.createElement("button");
    selectAllBtn.type = "button";
    selectAllBtn.textContent = "Pilih semua";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Hapus semua";
    actions.appendChild(selectAllBtn);
    actions.appendChild(clearBtn);
    panel.appendChild(actions);

    const checkboxes = [];
    for (const opt of options) {
      const optLabel = document.createElement("label");
      optLabel.className = "multiselect-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = opt.value;
      cb.checked = selected.includes(opt.value);
      cb.addEventListener("change", () => {
        const idx = selected.indexOf(opt.value);
        if (cb.checked && idx === -1) selected.push(opt.value);
        if (!cb.checked && idx !== -1) selected.splice(idx, 1);
        updateBtnLabel();
        onChange();
      });
      optLabel.appendChild(cb);
      optLabel.appendChild(document.createTextNode(opt.label));
      panel.appendChild(optLabel);
      checkboxes.push(cb);
    }

    const allValues = options.map((o) => o.value);
    selectAllBtn.addEventListener("click", () => {
      selected.splice(0, selected.length, ...allValues);
      checkboxes.forEach((cb) => (cb.checked = true));
      updateBtnLabel();
      onChange();
    });
    clearBtn.addEventListener("click", () => {
      selected.splice(0, selected.length);
      checkboxes.forEach((cb) => (cb.checked = false));
      updateBtnLabel();
      onChange();
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      closeAllMultiSelectPanels();
      panel.hidden = !willOpen;
    });

    box.appendChild(btn);
    box.appendChild(panel);
    return box;
  }

  function renderFilterControls() {
    const container = el("filters");
    container.innerHTML = "";

    for (const { field, multi } of CFG.FILTER_FIELDS) {
      const wrap = document.createElement("div");
      wrap.className = "filter-item";
      const label = document.createElement("label");
      label.textContent = field;
      wrap.appendChild(label);
      wrap.appendChild(multi ? buildMultiSelect(field) : buildSingleSelect(field));
      container.appendChild(wrap);
    }
  }

  // ---------------------------------------------------------------------
  // Render: ringkasan indikator
  // ---------------------------------------------------------------------

  function renderSummary() {
    const container = el("summary");
    container.innerHTML = "";

    for (const ind of SUMMARY_CARD_ORDER) {
      const card = document.createElement("div");
      card.className = "indicator-card";

      const title = document.createElement("h3");
      title.textContent = ind.label;
      card.appendChild(title);

      const counts = new Map();
      let withData = 0;
      for (const s of state.filtered) {
        const v = s.indikator[ind.key];
        const lbl = indicatorLabel(v);
        counts.set(lbl, (counts.get(lbl) || 0) + 1);
        if (v && v.label) withData++;
      }
      const total = state.filtered.length;

      if (total === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "Tidak ada data pada filter saat ini.";
        card.appendChild(empty);
        container.appendChild(card);
        continue;
      }

      const labels = Array.from(counts.keys());
      const sorted = labels.slice().sort((a, b) => categorize(a).rank - categorize(b).rank);

      const bar = document.createElement("div");
      bar.className = "stacked-bar";
      for (const lbl of sorted) {
        const n = counts.get(lbl);
        const pct = (n / total) * 100;
        const seg = document.createElement("div");
        seg.className = "bar-seg";
        seg.style.width = pct.toFixed(2) + "%";
        seg.style.background = categorize(lbl).color;
        seg.title = lbl + ": " + n + " satdik (" + pct.toFixed(1) + "%)";
        bar.appendChild(seg);
      }
      card.appendChild(bar);

      const legend = document.createElement("ul");
      legend.className = "legend";
      for (const lbl of sorted) {
        const n = counts.get(lbl);
        const pct = ((n / total) * 100).toFixed(1);
        const li = document.createElement("li");
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = categorize(lbl).color;
        li.appendChild(swatch);
        li.appendChild(document.createTextNode(lbl + " — " + n + " (" + pct + "%)"));
        legend.appendChild(li);
      }
      card.appendChild(legend);

      const coverage = document.createElement("p");
      coverage.className = "muted small";
      coverage.textContent = "Data tersedia untuk " + withData + " dari " + total + " satuan pendidikan.";
      card.appendChild(coverage);

      container.appendChild(card);
    }
  }

  // ---------------------------------------------------------------------
  // Render: tabel detail
  // ---------------------------------------------------------------------

  /** Kotak pencarian NPSN/Nama, dibuat SEKALI dan dipakai ulang (bukan
   * dibangun lagi tiap renderTableHead) supaya tidak kehilangan fokus saat
   * sedang diketik — lihat pemakaiannya di renderTableHead. Perubahan
   * nilainya tetap memicu refresh() penuh (ikut mempengaruhi Ringkasan &
   * result-count, sama seperti filter umum lainnya). */
  let searchInputEl = null;
  function getSearchInput() {
    if (searchInputEl) return searchInputEl;
    searchInputEl = document.createElement("input");
    searchInputEl.type = "text";
    searchInputEl.className = "table-search-input";
    searchInputEl.placeholder = "Cari NPSN atau nama sekolah...";
    let searchTimer = null;
    searchInputEl.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      const val = e.target.value;
      searchTimer = setTimeout(() => {
        state.filters.search = val;
        refresh();
      }, 150);
    });
    return searchInputEl;
  }

  /** Bangun ulang <colgroup> + 3 baris <thead>: baris filter Capaian, baris
   * filter Perubahan, lalu baris kode indikator — ketiganya berbagi
   * <colgroup> yang sama supaya filter tiap indikator otomatis sejajar
   * persis di atas kolomnya sendiri (lebarnya pas sama dengan kotak kode
   * indikator, lihat .multiselect-compact). Kolom identitas dipecah 2+2 di
   * kedua baris filter: 2 kolom pertama (NPSN+Nama) digabung (rowspan 2)
   * jadi kotak pencarian, 2 kolom sisanya (Kab./Kota+Status) jadi
   * keterangan "Capaian"/"Perubahan" tiap baris. Kolom indikator smkOnly
   * disembunyikan kalau tidak ada satuan pendidikan jenjang SMK di hasil
   * filter saat ini. */
  function renderTableHead() {
    const hasSMK = state.filtered.some((s) => isSMK(s.jenis));
    state.visibleIndicators = CFG.INDICATORS.filter((ind) => !ind.smkOnly || hasSMK);

    const colgroup = el("table-colgroup");
    const capaianRow = el("table-filter-capaian-row");
    const perubahanRow = el("table-filter-perubahan-row");
    const headRow = el("table-head-row");
    colgroup.innerHTML = "";
    headRow.innerHTML = "";
    // Hanya sel kolom indikator yang dibongkar ulang tiap render — sel
    // pencarian di awal baris Capaian dipertahankan (lihat di bawah).
    Array.from(capaianRow.querySelectorAll("th.col-indicator")).forEach((th) => th.remove());
    perubahanRow.innerHTML = "";

    const identityWidthTotal = CFG.TABLE_COLUMNS.reduce((sum, c) => sum + c.width, 0);
    const indicatorWidth = state.visibleIndicators.length
      ? (100 - identityWidthTotal) / state.visibleIndicators.length
      : 0;

    CFG.TABLE_COLUMNS.forEach((col) => {
      const c = document.createElement("col");
      c.style.width = col.width + "%";
      colgroup.appendChild(c);

      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.truncate) th.className = "col-truncate";
      if (col.center) th.className = "col-center";
      headRow.appendChild(th);
    });

    // Kotak pencarian cuma menggabungkan 2 kolom identitas pertama (NPSN +
    // Nama) — bukan semuanya — supaya 2 kolom sisanya (Kab./Kota + Status)
    // bisa dipakai utk keterangan "Capaian"/"Perubahan" di tiap baris
    // filter (Capaian di baris atas, Perubahan di baris bawah).
    const searchColSpan = 2;
    const labelColSpan = CFG.TABLE_COLUMNS.length - searchColSpan;

    if (!capaianRow.querySelector(".search-cell")) {
      const searchTh = document.createElement("th");
      searchTh.className = "search-cell";
      searchTh.rowSpan = 2;
      searchTh.colSpan = searchColSpan;
      searchTh.appendChild(getSearchInput());
      capaianRow.insertBefore(searchTh, capaianRow.firstChild);
    }
    if (!capaianRow.querySelector(".filter-row-label")) {
      const capLabelTh = document.createElement("th");
      capLabelTh.className = "filter-row-label";
      capLabelTh.colSpan = labelColSpan;
      capLabelTh.textContent = "Capaian";
      capaianRow.appendChild(capLabelTh);
    }
    const perLabelTh = document.createElement("th");
    perLabelTh.className = "filter-row-label";
    perLabelTh.colSpan = labelColSpan;
    perLabelTh.textContent = "Perubahan";
    perubahanRow.appendChild(perLabelTh);

    const capaianByIndicator = state.filterOptions.capaianByIndicator || {};
    for (const ind of state.visibleIndicators) {
      const c = document.createElement("col");
      c.style.width = indicatorWidth + "%";
      colgroup.appendChild(c);

      const fs = getIndicatorFilterState(ind.code);

      const capTh = document.createElement("th");
      capTh.className = "col-indicator";
      const capOptions = (capaianByIndicator[ind.code] || []).map((lbl) => ({ value: lbl, label: lbl }));
      capTh.appendChild(buildValueMultiSelect(capOptions, fs.capaian, refreshTableOnly, { compact: true }));
      capaianRow.appendChild(capTh);

      const perTh = document.createElement("th");
      perTh.className = "col-indicator";
      perTh.appendChild(buildValueMultiSelect(PERUBAHAN_OPTIONS, fs.perubahan, refreshTableOnly, { compact: true }));
      perubahanRow.appendChild(perTh);

      const th = document.createElement("th");
      th.textContent = ind.code;
      th.title = ind.label;
      th.className = "col-indicator";
      headRow.appendChild(th);
    }

    stackStickyHeaderRows(capaianRow, perubahanRow, headRow);
  }

  /** Ketiga baris <thead> (filter Capaian, filter Perubahan, kode
   * indikator) semuanya position:sticky (lihat CSS) supaya tabel yang
   * berisi ribuan baris tetap bisa difilter/dicari sambil discroll — tanpa
   * ini, kotak pencarian & filter akan hilang dari layar begitu discroll
   * lewat baris pertama. Browser tidak otomatis menumpuk beberapa baris
   * sticky; `top` tiap baris harus dihitung manual dari tinggi baris
   * sticky di atasnya supaya tidak saling menimpa. */
  function stackStickyHeaderRows(capaianRow, perubahanRow, headRow) {
    const capHeight = capaianRow.getBoundingClientRect().height;
    const perHeight = perubahanRow.getBoundingClientRect().height;
    Array.from(capaianRow.children).forEach((th) => (th.style.top = "0px"));
    Array.from(perubahanRow.children).forEach((th) => (th.style.top = capHeight + "px"));
    Array.from(headRow.children).forEach((th) => (th.style.top = capHeight + perHeight + "px"));
  }

  function renderTable() {
    renderTableHead();
    const tbody = el("table-body");
    tbody.innerHTML = "";

    const tableTotalRows = state.tableRows.length;
    const totalPages = Math.max(1, Math.ceil(tableTotalRows / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const startIdx = (state.page - 1) * PAGE_SIZE;
    const pageRows = state.tableRows.slice(startIdx, startIdx + PAGE_SIZE);

    pageRows.forEach((s, i) => {
      const globalIdx = startIdx + i;
      const tr = document.createElement("tr");

      for (const col of CFG.TABLE_COLUMNS) {
        const td = document.createElement("td");
        const rawVal = s[col.key] ?? "";
        td.textContent = col.key === "status" ? abbreviateStatus(rawVal) : rawVal;
        if (col.truncate) {
          td.className = "col-truncate";
          td.title = rawVal;
        }
        if (col.center) {
          td.className = "col-center";
          td.title = rawVal;
        }
        tr.appendChild(td);
      }

      for (const ind of state.visibleIndicators) {
        // Indikator khusus SMK (mis. A.4, D.17) dikosongkan untuk satuan
        // pendidikan non-SMK, walau kebetulan ada nilai di sheet sumber.
        const v = ind.smkOnly && !isSMK(s.jenis) ? null : s.indikator[ind.key];
        const td = document.createElement("td");
        td.className = "col-indicator";
        if (!v || !v.label) {
          td.innerHTML = "<span class='chip chip-muted'>-</span>";
        } else {
          const label = String(v.label).trim();
          const color = categorize(label).color;
          const trend = trendArrow(v.perubahanTahun);
          td.innerHTML =
            "<span class='chip' style='background:" +
            color +
            "' title='" +
            escapeHtml(label) +
            "'>" +
            escapeHtml(label) +
            "</span>" +
            (trend.symbol
              ? "<span class='trend' style='color:" + trend.color + "' title='" + escapeHtml(trend.text) + "'>" + trend.symbol + "</span>"
              : "");
        }
        tr.appendChild(td);
      }

      tr.addEventListener("click", () => {
        state.expandedIdx = state.expandedIdx === globalIdx ? null : globalIdx;
        renderTable();
      });
      tr.classList.toggle("row-expanded", state.expandedIdx === globalIdx);
      tbody.appendChild(tr);

      if (state.expandedIdx === globalIdx) {
        const detailTr = document.createElement("tr");
        detailTr.className = "detail-row";
        const detailTd = document.createElement("td");
        detailTd.colSpan = CFG.TABLE_COLUMNS.length + state.visibleIndicators.length;
        detailTd.appendChild(renderDetailPanel(s));
        detailTr.appendChild(detailTd);
        tbody.appendChild(detailTr);
      }
    });

    el("result-count").textContent =
      state.filtered.length.toLocaleString("id-ID") +
      " satuan pendidikan sesuai filter (dari " +
      state.schools.length.toLocaleString("id-ID") +
      " total).";
    el("page-info").textContent = "Halaman " + state.page + " dari " + totalPages;
    el("prev-page").disabled = state.page <= 1;
    el("next-page").disabled = state.page >= totalPages;
  }

  function renderDetailPanel(s) {
    const wrap = document.createElement("div");
    wrap.className = "detail-panel";
    for (const ind of CFG.INDICATORS) {
      const v = ind.smkOnly && !isSMK(s.jenis) ? null : s.indikator[ind.key];
      const box = document.createElement("div");
      box.className = "detail-indicator";
      const h = document.createElement("h4");
      h.textContent = ind.label;
      box.appendChild(h);
      if (!v || !v.label) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "Data tidak tersedia untuk satuan pendidikan ini.";
        box.appendChild(p);
      } else {
        const dl = document.createElement("dl");
        const rows = [
          ["Label Capaian", String(v.label).trim()],
          ["Nilai Capaian", v.nilai ?? "-"],
          ["Perubahan dari Tahun 2024", v.perubahanTahun ?? "-"],
          ["Perubahan Nilai", v.perubahanNilai ?? "-"],
          ["Peringkat di Kab./Kota", v.peringkat ?? "-"],
        ];
        for (const [k, val] of rows) {
          const dt = document.createElement("dt");
          dt.textContent = k;
          const dd = document.createElement("dd");
          dd.textContent = val;
          dl.appendChild(dt);
          dl.appendChild(dd);
        }
        box.appendChild(dl);
      }
      wrap.appendChild(box);
    }
    return wrap;
  }

  // ---------------------------------------------------------------------
  // Orkestrasi
  // ---------------------------------------------------------------------

  /** Filter umum berubah (Kab/Kota, Kecamatan, Jenis, Status, Cari): hitung
   * ulang semuanya dari atas — ikut mempengaruhi Ringkasan & result-count. */
  function refresh() {
    applyFilters();
    renderSummary();
    state.page = 1;
    state.expandedIdx = null;
    computeTableRows();
    renderTable();
  }

  /** Filter Capaian/Perubahan per indikator berubah: hanya pengaruhi tabel
   * Detail Satuan Pendidikan, tidak perlu hitung ulang Ringkasan. */
  function refreshTableOnly() {
    state.page = 1;
    state.expandedIdx = null;
    computeTableRows();
    renderTable();
  }

  function wireStaticControls() {
    document.addEventListener("click", closeAllMultiSelectPanels);
    el("reset-filters").addEventListener("click", () => {
      for (const { field, multi } of CFG.FILTER_FIELDS) state.filters[field] = multi ? [] : "";
      state.filters.search = "";
      state.filters.indicatorFilters = {};
      if (searchInputEl) searchInputEl.value = "";
      computeFilterOptions();
      renderFilterControls();
      refresh();
    });
    el("prev-page").addEventListener("click", () => {
      if (state.page > 1) {
        state.page--;
        state.expandedIdx = null;
        renderTable();
      }
    });
    el("next-page").addEventListener("click", () => {
      state.page++;
      state.expandedIdx = null;
      renderTable();
    });
  }

  async function main() {
    wireStaticControls();
    try {
      const result = await window.SchoolData.loadAll((msg) => setStatus(msg, false));
      state.schools = result.schools;
      computeFilterOptions();
      renderFilterControls();
      computeAllCapaianOptions();
      refresh();
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(
        "Gagal memuat data: " + err.message + ". Pastikan spreadsheet dibagikan sebagai “siapa saja yang memiliki link dapat melihat” dan koneksi internet aktif.",
        true
      );
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();

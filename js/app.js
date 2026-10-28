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

  const state = {
    identityHeader: CFG.IDENTITY_FIELDS,
    schools: [], // hasil merge lengkap
    filtered: [],
    filterOptions: {}, // field -> sorted unique values
    filters: { indikatorKode: "", capaian: [], perubahan: [] }, // field -> selected value ("" = semua)
    page: 1,
    expandedIdx: null,
    visibleIndicators: CFG.INDICATORS.filter((ind) => !ind.smkOnly),
  };

  function isSMK(jenis) {
    return /smk/i.test(String(jenis || ""));
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

  function computeFilterOptions() {
    const opts = {};
    const selectedKabKota = state.filters["Kabupaten/Kota"];
    for (const { field } of CFG.FILTER_FIELDS) {
      const key = fieldKeyFor(field);
      const set = new Set();
      for (const s of state.schools) {
        // Pilihan Kecamatan dibatasi ke Kabupaten/Kota yang sedang dipilih.
        if (field === "Kecamatan" && selectedKabKota && s.kabkota !== selectedKabKota) continue;
        if (s[key]) set.add(s[key]);
      }
      opts[field] = Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
    }
    state.filterOptions = opts;
  }

  /** Opsi filter "Capaian", dihitung ulang dari indikator yang sedang
   * dipilih di filter "Indikator" (mis. memilih "A.1" menampilkan hanya
   * label capaian yang benar-benar muncul utk A.1, termasuk "Tidak
   * Tersedia" kalau ada satuan pendidikan tanpa data). Kosong kalau belum
   * ada indikator dipilih. */
  function computeCapaianOptions() {
    const code = state.filters.indikatorKode;
    const ind = code ? CFG.INDICATORS.find((i) => i.code === code) : null;
    if (!ind) {
      state.filterOptions.capaian = [];
      return;
    }
    const set = new Set();
    for (const s of state.schools) {
      const v = ind.smkOnly && !isSMK(s.jenis) ? null : s.indikator[ind.key];
      set.add(v && v.label ? String(v.label) : "Tidak Tersedia");
    }
    state.filterOptions.capaian = Array.from(set).sort(
      (a, b) => categorize(a).rank - categorize(b).rank || a.localeCompare(b, "id")
    );
  }

  function applyFilters() {
    const search = (state.filters.search || "").trim().toLowerCase();
    const indCode = state.filters.indikatorKode;
    const ind = indCode ? CFG.INDICATORS.find((i) => i.code === indCode) : null;
    const capaianSel = state.filters.capaian || [];
    const perubahanSel = state.filters.perubahan || [];
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
      // Filter Capaian/Perubahan: hanya aktif kalau sebuah indikator sudah
      // dipilih di dropdown "Indikator" — keduanya menilai indikator itu
      // saja (satu satuan pendidikan punya capaian/perubahan berbeda-beda
      // utk tiap indikator, jadi filter ini perlu tahu indikator mana).
      if (ind) {
        const v = ind.smkOnly && !isSMK(s.jenis) ? null : s.indikator[ind.key];
        const label = v && v.label ? String(v.label) : "Tidak Tersedia";
        if (capaianSel.length > 0 && !capaianSel.includes(label)) return false;
        if (perubahanSel.length > 0) {
          const cat = trendCategory(v && v.perubahanTahun);
          if (!perubahanSel.includes(cat)) return false;
        }
      }
      return true;
    });
    state.page = 1;
    state.expandedIdx = null;
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
   * tabel Detail Satuan Pendidikan. Kalau `opts.disabled` true (belum ada
   * indikator dipilih), tombolnya dinonaktifkan dan menampilkan
   * `opts.disabledText`. */
  function buildValueMultiSelect(options, selected, onChange, opts) {
    opts = opts || {};

    const box = document.createElement("div");
    box.className = "multiselect";

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

  /** Dropdown pilih-satu indikator (berdasarkan kode) yang jadi konteks utk
   * filter Capaian & Perubahan di bawahnya — satu satuan pendidikan punya
   * capaian/perubahan berbeda-beda per indikator, jadi filter itu perlu tahu
   * indikator mana yang dimaksud. */
  function renderIndikatorFilterSelect() {
    const select = el("indikator-filter-select");
    select.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Pilih indikator...";
    select.appendChild(optAll);
    for (const ind of CFG.INDICATORS) {
      const opt = document.createElement("option");
      opt.value = ind.code;
      opt.textContent = ind.code + " — " + ind.label.replace(ind.code + " ", "");
      select.appendChild(opt);
    }
    select.value = state.filters.indikatorKode || "";
  }

  function renderCapaianFilter() {
    const container = el("capaian-filter");
    container.innerHTML = "";
    const hasIndikator = !!state.filters.indikatorKode;
    const options = (state.filterOptions.capaian || []).map((lbl) => ({ value: lbl, label: lbl }));
    container.appendChild(
      buildValueMultiSelect(options, state.filters.capaian, refresh, {
        disabled: !hasIndikator,
        disabledText: "Pilih indikator dulu",
      })
    );
  }

  function renderPerubahanFilter() {
    const container = el("perubahan-filter");
    container.innerHTML = "";
    const hasIndikator = !!state.filters.indikatorKode;
    container.appendChild(
      buildValueMultiSelect(PERUBAHAN_OPTIONS, state.filters.perubahan, refresh, {
        disabled: !hasIndikator,
        disabledText: "Pilih indikator dulu",
      })
    );
  }

  function onIndikatorFilterChanged() {
    state.filters.capaian = [];
    state.filters.perubahan = [];
    computeCapaianOptions();
    renderCapaianFilter();
    renderPerubahanFilter();
    refresh();
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

    for (const ind of CFG.INDICATORS) {
      const card = document.createElement("div");
      card.className = "indicator-card";

      const title = document.createElement("h3");
      title.textContent = ind.label;
      card.appendChild(title);

      const counts = new Map();
      let withData = 0;
      for (const s of state.filtered) {
        const v = s.indikator[ind.key];
        const lbl = v && v.label ? String(v.label) : "Tidak Tersedia";
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

  /** Bangun ulang <colgroup> + header tabel; sembunyikan kolom indikator
   * smkOnly saat tidak ada satuan pendidikan jenjang SMK di hasil filter.
   * Header kolom indikator cuma kodenya saja (mis. "A.1"), ditengahkan,
   * supaya tabel tidak terlalu lebar — nama lengkapnya ada di title
   * (tooltip) header. */
  function renderTableHead() {
    const hasSMK = state.filtered.some((s) => isSMK(s.jenis));
    state.visibleIndicators = CFG.INDICATORS.filter((ind) => !ind.smkOnly || hasSMK);

    const colgroup = el("table-colgroup");
    const headRow = el("table-head-row");
    colgroup.innerHTML = "";
    headRow.innerHTML = "";

    const identityWidthTotal = CFG.TABLE_COLUMNS.reduce((sum, c) => sum + c.width, 0);
    const indicatorWidth = state.visibleIndicators.length
      ? (100 - identityWidthTotal) / state.visibleIndicators.length
      : 0;

    for (const col of CFG.TABLE_COLUMNS) {
      const c = document.createElement("col");
      c.style.width = col.width + "%";
      colgroup.appendChild(c);
      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.truncate) th.className = "col-truncate";
      headRow.appendChild(th);
    }
    for (const ind of state.visibleIndicators) {
      const c = document.createElement("col");
      c.style.width = indicatorWidth + "%";
      colgroup.appendChild(c);
      const th = document.createElement("th");
      th.textContent = ind.code;
      th.title = ind.label;
      th.className = "col-indicator";
      headRow.appendChild(th);
    }
  }

  function renderTable() {
    renderTableHead();
    const tbody = el("table-body");
    tbody.innerHTML = "";

    const totalRows = state.filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const startIdx = (state.page - 1) * PAGE_SIZE;
    const pageRows = state.filtered.slice(startIdx, startIdx + PAGE_SIZE);

    pageRows.forEach((s, i) => {
      const globalIdx = startIdx + i;
      const tr = document.createElement("tr");

      for (const col of CFG.TABLE_COLUMNS) {
        const td = document.createElement("td");
        const val = s[col.key] ?? "";
        td.textContent = val;
        if (col.truncate) {
          td.className = "col-truncate";
          td.title = val;
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
          const color = categorize(v.label).color;
          const trend = trendArrow(v.perubahanTahun);
          td.innerHTML =
            "<span class='chip' style='background:" +
            color +
            "' title='" +
            escapeHtml(v.label) +
            "'>" +
            escapeHtml(v.label) +
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
      totalRows.toLocaleString("id-ID") + " satuan pendidikan sesuai filter (dari " + state.schools.length.toLocaleString("id-ID") + " total).";
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
          ["Label Capaian", v.label],
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

  function refresh() {
    applyFilters();
    renderSummary();
    renderTable();
  }

  function wireStaticControls() {
    document.addEventListener("click", closeAllMultiSelectPanels);
    renderIndikatorFilterSelect();
    renderCapaianFilter();
    renderPerubahanFilter();
    el("indikator-filter-select").addEventListener("change", (e) => {
      state.filters.indikatorKode = e.target.value;
      onIndikatorFilterChanged();
    });
    let searchTimer = null;
    el("search-input").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      const val = e.target.value;
      searchTimer = setTimeout(() => {
        state.filters.search = val;
        refresh();
      }, 150);
    });
    el("reset-filters").addEventListener("click", () => {
      for (const { field, multi } of CFG.FILTER_FIELDS) state.filters[field] = multi ? [] : "";
      state.filters.search = "";
      state.filters.indikatorKode = "";
      state.filters.capaian = [];
      state.filters.perubahan = [];
      el("search-input").value = "";
      el("indikator-filter-select").value = "";
      computeFilterOptions();
      computeCapaianOptions();
      renderFilterControls();
      renderCapaianFilter();
      renderPerubahanFilter();
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

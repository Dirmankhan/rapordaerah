(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const PAGE_SIZE = 25;

  // Tangga warna ordinal (biru), dari terang (skor rendah) ke gelap (skor tinggi).
  // Nilai persis dari palet referensi dataviz (references/palette.md).
  const BLUE_STEPS = {
    250: "#86b6ef",
    300: "#6da7ec",
    350: "#5598e7",
    400: "#3987e5",
    450: "#2a78d6",
    500: "#256abf",
    550: "#1c5cab",
    600: "#184f95",
  };
  const MUTED = "#898781";
  const GOOD = "#0ca30c";
  const CRITICAL = "#d03b3b";

  // Urutan tingkatan label capaian yang dikenal, dari TERBAIK ke TERBURUK.
  const KNOWN_TIERS = [
    "sangat tinggi",
    "tinggi",
    "sedang",
    "menengah",
    "cukup",
    "rendah",
    "sangat rendah",
  ];

  const state = {
    identityHeader: CFG.IDENTITY_FIELDS,
    schools: [], // hasil merge lengkap
    filtered: [],
    filterOptions: {}, // field -> sorted unique values
    filters: { search: "" }, // field -> selected value ("" = semua)
    page: 1,
    expandedIdx: null,
  };

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
  // Pemuatan & penggabungan data
  // ---------------------------------------------------------------------

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

  async function loadAll(onProgress) {
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

    return { schools, indicatorBlocks };
  }

  // ---------------------------------------------------------------------
  // Filter
  // ---------------------------------------------------------------------

  function fieldKeyFor(filterField) {
    return { "Kabupaten/Kota": "kabkota", "Jenis Satuan Pendidikan": "jenis", "Status Satuan Pendidikan": "status" }[
      filterField
    ];
  }

  function computeFilterOptions() {
    const opts = {};
    for (const field of CFG.FILTER_FIELDS) {
      const key = fieldKeyFor(field);
      const set = new Set();
      for (const s of state.schools) {
        if (s[key]) set.add(s[key]);
      }
      opts[field] = Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
    }
    state.filterOptions = opts;
  }

  function applyFilters() {
    const search = state.filters.search.trim().toLowerCase();
    state.filtered = state.schools.filter((s) => {
      for (const field of CFG.FILTER_FIELDS) {
        const key = fieldKeyFor(field);
        const selected = state.filters[field];
        if (selected && s[key] !== selected) return false;
      }
      if (search) {
        const hay = (String(s.npsn) + " " + s.nama).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    state.page = 1;
    state.expandedIdx = null;
  }

  // ---------------------------------------------------------------------
  // Warna & label tier
  // ---------------------------------------------------------------------

  function tierRank(label) {
    if (!label) return -1;
    const l = String(label).toLowerCase();
    if (l.indexOf("tidak tersedia") >= 0) return -1;
    for (let i = 0; i < KNOWN_TIERS.length; i++) {
      if (l.indexOf(KNOWN_TIERS[i]) >= 0) return i;
    }
    return -1;
  }

  /** Bangun peta label -> warna untuk satu set label yang muncul (ordinal, terbaik = gelap). */
  function buildLabelColorMap(labels) {
    const ranked = labels.filter((l) => tierRank(l) >= 0);
    ranked.sort((a, b) => tierRank(a) - tierRank(b)); // terbaik dulu
    const uniqueRanked = Array.from(new Set(ranked));
    const steps = [600, 500, 450, 400, 350, 300, 250];
    const colorMap = {};
    uniqueRanked.forEach((label, i) => {
      const stepIdx = Math.min(i, steps.length - 1);
      colorMap[label] = BLUE_STEPS[steps[stepIdx]];
    });
    for (const l of labels) {
      if (!(l in colorMap)) colorMap[l] = MUTED;
    }
    return colorMap;
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

  // ---------------------------------------------------------------------
  // Render: filter controls
  // ---------------------------------------------------------------------

  function renderFilterControls() {
    const container = el("filters");
    container.innerHTML = "";

    for (const field of CFG.FILTER_FIELDS) {
      const wrap = document.createElement("div");
      wrap.className = "filter-item";
      const label = document.createElement("label");
      label.textContent = field;
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
        refresh();
      });
      wrap.appendChild(label);
      wrap.appendChild(select);
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
      const colorMap = buildLabelColorMap(labels);
      const sorted = labels
        .slice()
        .sort((a, b) => {
          const ra = tierRank(a),
            rb = tierRank(b);
          if (ra === -1 && rb === -1) return 0;
          if (ra === -1) return 1;
          if (rb === -1) return -1;
          return ra - rb;
        });

      const bar = document.createElement("div");
      bar.className = "stacked-bar";
      for (const lbl of sorted) {
        const n = counts.get(lbl);
        const pct = (n / total) * 100;
        const seg = document.createElement("div");
        seg.className = "bar-seg";
        seg.style.width = pct.toFixed(2) + "%";
        seg.style.background = colorMap[lbl];
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
        swatch.style.background = colorMap[lbl];
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

  function renderTable() {
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
      tr.innerHTML =
        "<td>" +
        escapeHtml(s.npsn) +
        "</td><td class='col-nama'>" +
        escapeHtml(s.nama) +
        "</td><td>" +
        escapeHtml(s.jenis) +
        "</td><td>" +
        escapeHtml(s.status) +
        "</td><td>" +
        escapeHtml(s.kabkota) +
        "</td><td>" +
        escapeHtml(s.kecamatan) +
        "</td>";

      for (const ind of CFG.INDICATORS) {
        const v = s.indikator[ind.key];
        const td = document.createElement("td");
        td.className = "col-indicator";
        if (!v || !v.label) {
          td.innerHTML = "<span class='chip chip-muted'>-</span>";
        } else {
          const color = buildLabelColorMap([v.label])[v.label];
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
              ? " <span class='trend' style='color:" + trend.color + "' title='" + escapeHtml(trend.text) + "'>" + trend.symbol + "</span>"
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
        detailTd.colSpan = 6 + CFG.INDICATORS.length;
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
      const v = s.indikator[ind.key];
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
      for (const field of CFG.FILTER_FIELDS) state.filters[field] = "";
      state.filters.search = "";
      el("search-input").value = "";
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
      const result = await loadAll((msg) => setStatus(msg, false));
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

// Halaman Anak Tidak Sekolah (ATS): rekap Drop Out (DO), Lulus Tidak
// Melanjutkan (LTM) dan Belum Pernah Bersekolah (BPB) per kabupaten/kota &
// kecamatan, dari spreadsheet ATS_SHEET_ID (lihat js/config.js). 4 sheet
// (Gabungan/DO/LTM/BPB) berstruktur identik: baris 4 (indeks 3) berisi
// header tanggal (1 tanggal per 3 kolom: Jumlah ATS, Sudah Diverval, Belum
// Diverval), data kecamatan mulai baris 6 (indeks 5), tiap kelompok
// kabupaten/kota diakhiri baris subtotal "Jumlah <nama>", dan sheet
// diakhiri baris "JUMLAH PROVINSI NTB".
(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { GOOD, ORANGE, CRITICAL, MUTED } = window.Shared;

  const PROVINCE_VALUE = "__provinsi__";
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit
  const MONTH_ABBR = {
    januari: "Jan", februari: "Feb", maret: "Mar", april: "Apr", mei: "Mei", juni: "Jun",
    juli: "Jul", agustus: "Agu", september: "Sep", oktober: "Okt", november: "Nov", desember: "Des",
  };

  const el = (id) => document.getElementById(id);

  const state = {
    categories: {}, // key -> { dates, kecamatanRows, subtotalByKabkota, provinceTotal }
    alasan: null, // { reasonCodes, kecamatanRows, subtotalByKabkota, provinceTotal }
    kabupatenList: [], // urutan kemunculan pertama di sheet "Gabungan"
    kabupatenKey: PROVINCE_VALUE,
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

  function isBlank(v) {
    return v === null || v === undefined || v === "";
  }

  /** "1,148" / 1148 -> 1148. Angka ATS berupa bilangan bulat; koma di sheet
   * ini pemisah ribuan (bukan desimal seperti di data rapor lain). */
  function parseCount(v) {
    if (isBlank(v)) return null;
    if (typeof v === "number") return v;
    const n = parseInt(String(v).replace(/,/g, ""), 10);
    return Number.isNaN(n) ? null : n;
  }

  /** "18 Oktober 2026" -> "18 Okt". */
  function shortDateLabel(label) {
    const m = String(label).trim().match(/^(\d{1,2})\s+([A-Za-z]+)/);
    if (!m) return String(label);
    const abbr = MONTH_ABBR[m[2].toLowerCase()] || m[2].slice(0, 3);
    return m[1] + " " + abbr;
  }

  function pct(verval, jumlah) {
    if (!jumlah) return null;
    return (verval / jumlah) * 100;
  }

  function pctColor(p) {
    if (p === null) return MUTED;
    if (p >= 70) return GOOD;
    if (p >= 40) return ORANGE;
    return CRITICAL;
  }

  /** Baca 1 sheet kategori (Gabungan/DO/LTM/BPB) -> daftar tanggal, baris
   * tiap kecamatan, subtotal tiap kabupaten/kota, dan total provinsi. */
  async function loadCategorySheet(sheetName) {
    const cacheKey = "atsData:" + CFG.ATS_SHEET_ID + ":" + sheetName;
    const cached = window.DataCache && window.DataCache.readFresh(cacheKey, CACHE_TTL_MS);
    if (cached) return cached;

    const raw = await Gviz.fetchSheetRaw(CFG.ATS_SHEET_ID, sheetName);
    if (raw.length < 6) throw new Error('Sheet "' + sheetName + '" kosong / format tidak dikenali.');

    // Baris & kolom tanggal dicari dari ISI selnya (baris sub-header
    // "Jumlah ATS" menandai kolom pertama tiap grup 3 kolom per tanggal,
    // labelnya ada di baris persis di atasnya) — bukan dari indeks baris
    // tetap, supaya tahan kalau gviz melewati baris kosong di awal sheet
    // (jumlah baris sebelum data bisa beda2 antar sheet/waktu akses).
    let subHeaderRowIdx = -1;
    for (let r = 0; r < raw.length; r++) {
      if ((raw[r] || []).some((c) => /^jumlah\s+ats$/i.test(String(c || "")))) {
        subHeaderRowIdx = r;
        break;
      }
    }
    if (subHeaderRowIdx === -1 || subHeaderRowIdx === 0) {
      throw new Error('Baris sub-header "Jumlah ATS" tidak ditemukan di sheet "' + sheetName + '".');
    }
    const subHeaderRow = raw[subHeaderRowIdx] || [];
    const dateHeaderRow = raw[subHeaderRowIdx - 1] || [];
    const dates = [];
    for (let col = 0; col < subHeaderRow.length; col++) {
      if (/^jumlah\s+ats$/i.test(String(subHeaderRow[col] || "")) && dateHeaderRow[col]) {
        dates.push({ label: String(dateHeaderRow[col]).trim(), col });
      }
    }
    if (dates.length === 0) throw new Error('Header tanggal tidak ditemukan di sheet "' + sheetName + '".');

    const kecamatanRows = [];
    const subtotalByKabkota = {};
    let provinceTotal = null;

    const seriesFor = (row) =>
      dates.map((d) => ({
        label: d.label,
        jumlah: parseCount(row[d.col]),
        verval: parseCount(row[d.col + 1]),
        belum: parseCount(row[d.col + 2]),
      }));

    for (let i = subHeaderRowIdx + 1; i < raw.length; i++) {
      const row = raw[i];
      if (!row || row.length === 0) continue;
      const kabkota = row[1];
      const kecamatan = row[2];
      if (isBlank(kabkota)) continue;

      const kabkotaText = String(kabkota).trim();
      if (kabkotaText === "JUMLAH PROVINSI NTB") {
        provinceTotal = { series: seriesFor(row) };
      } else if (isBlank(kecamatan) && /^Jumlah\s+/i.test(kabkotaText)) {
        const nama = kabkotaText.replace(/^Jumlah\s+/i, "").trim();
        subtotalByKabkota[nama] = { series: seriesFor(row) };
      } else if (!isBlank(kecamatan)) {
        kecamatanRows.push({
          no: row[0],
          kabkota: kabkotaText,
          kecamatan: String(kecamatan).trim(),
          series: seriesFor(row),
        });
      }
    }

    const subtitleRow = raw[1] && raw[1][0] ? String(raw[1][0]) : "";
    const result = { dates, kecamatanRows, subtotalByKabkota, provinceTotal, subtitleRow };
    if (window.DataCache) window.DataCache.write(cacheKey, result);
    return result;
  }

  /** Baca sheet "Alasan Verifikasi": per kecamatan, jumlah kasus Sudah
   * Diverval (gabungan DO+LTM+BPB) tiap kode alasan k1-k26 — strukturnya
   * mirip loadCategorySheet (baris subtotal "Jumlah <nama>" & "JUMLAH
   * PROVINSI NTB") tapi cuma 1 snapshot (tanpa deret tanggal). Baris kode
   * alasan & kolom total "Jumlah Sudah Verifikasi" dicari lewat isi
   * selnya (bukan indeks baris/kolom tetap), supaya tahan kalau gviz
   * melewati baris kosong di awal sheet atau urutannya sedikit berubah. */
  async function loadAlasanSheet() {
    const sheetName = CFG.ATS_ALASAN_SHEET;
    const cacheKey = "atsData:" + CFG.ATS_SHEET_ID + ":" + sheetName;
    const cached = window.DataCache && window.DataCache.readFresh(cacheKey, CACHE_TTL_MS);
    if (cached) return cached;

    const raw = await Gviz.fetchSheetRaw(CFG.ATS_SHEET_ID, sheetName);
    if (raw.length < 6) throw new Error('Sheet "' + sheetName + '" kosong / format tidak dikenali.');

    // Baris kode alasan (k1, k2, ...) dicari dari ISI selnya (baris dgn
    // >=2 sel berformat "k<angka>"), bukan indeks baris tetap, supaya
    // tahan kalau gviz melewati baris kosong di awal sheet. Kolom total
    // "Jumlah Sudah Verifikasi" dicari di seluruh sheet dgn cara sama.
    let codeHeaderRowIdx = -1;
    const reasonCols = [];
    for (let r = 0; r < raw.length; r++) {
      const row = raw[r] || [];
      const cols = [];
      for (let c = 0; c < row.length; c++) {
        const code = String(row[c] || "").trim();
        if (/^k\d+$/i.test(code)) cols.push({ code: code.toLowerCase(), col: c });
      }
      if (cols.length >= 2) {
        codeHeaderRowIdx = r;
        reasonCols.push(...cols);
        break;
      }
    }
    let totalCol = -1;
    for (let r = 0; r < raw.length && totalCol === -1; r++) {
      const row = raw[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (/jumlah\s+sudah\s+verifikasi/i.test(String(row[c] || ""))) {
          totalCol = c;
          break;
        }
      }
    }
    if (reasonCols.length === 0 || totalCol === -1) {
      throw new Error('Header kode alasan / kolom total tidak ditemukan di sheet "' + sheetName + '".');
    }

    const countsFor = (row) => {
      const counts = {};
      for (const rc of reasonCols) counts[rc.code] = parseCount(row[rc.col]) || 0;
      return { counts, total: parseCount(row[totalCol]) || 0 };
    };

    const kecamatanRows = [];
    const subtotalByKabkota = {};
    let provinceTotal = null;

    for (let i = codeHeaderRowIdx + 1; i < raw.length; i++) {
      const row = raw[i];
      if (!row || row.length === 0) continue;
      const kabkota = row[1];
      const kecamatan = row[2];
      if (isBlank(kabkota)) continue;

      const kabkotaText = String(kabkota).trim();
      if (kabkotaText === "JUMLAH PROVINSI NTB") {
        provinceTotal = countsFor(row);
      } else if (isBlank(kecamatan) && /^Jumlah\s+/i.test(kabkotaText)) {
        const nama = kabkotaText.replace(/^Jumlah\s+/i, "").trim();
        subtotalByKabkota[nama] = countsFor(row);
      } else if (!isBlank(kecamatan)) {
        const { counts, total } = countsFor(row);
        kecamatanRows.push({ kabkota: kabkotaText, kecamatan: String(kecamatan).trim(), counts, total });
      }
    }

    const result = { reasonCodes: reasonCols.map((rc) => rc.code), kecamatanRows, subtotalByKabkota, provinceTotal };
    if (window.DataCache) window.DataCache.write(cacheKey, result);
    return result;
  }

  // ---------------------------------------------------------------------
  // Render: filter Kabupaten/Kota
  // ---------------------------------------------------------------------

  function renderKabupatenSelect() {
    const select = el("ats-kab-select");
    select.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = PROVINCE_VALUE;
    optAll.textContent = "Semua Provinsi NTB";
    select.appendChild(optAll);
    for (const nama of state.kabupatenList) {
      const opt = document.createElement("option");
      opt.value = nama;
      opt.textContent = nama;
      select.appendChild(opt);
    }
    select.value = state.kabupatenKey;
    select.addEventListener("change", () => {
      state.kabupatenKey = select.value;
      render();
    });
  }

  function totalsFor(categoryKey, kabupatenKey) {
    const cat = state.categories[categoryKey];
    const entry = kabupatenKey === PROVINCE_VALUE ? cat.provinceTotal : cat.subtotalByKabkota[kabupatenKey];
    return entry ? entry.series : null;
  }

  // ---------------------------------------------------------------------
  // Render: ringkasan 4 kategori (data terbaru)
  // ---------------------------------------------------------------------

  function renderSummaryCards() {
    const container = el("ats-summary");
    container.innerHTML = "";

    for (const category of CFG.ATS_CATEGORIES) {
      const series = totalsFor(category.key, state.kabupatenKey);
      const latest = series ? series[series.length - 1] : null;

      const card = document.createElement("div");
      card.className = "indicator-card";

      const title = document.createElement("h3");
      title.textContent = category.label;
      card.appendChild(title);

      if (!latest || isBlank(latest.jumlah)) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "Data tidak tersedia utk wilayah ini.";
        card.appendChild(empty);
        container.appendChild(card);
        continue;
      }

      const jumlah = latest.jumlah || 0;
      const verval = latest.verval || 0;
      const belum = latest.belum || 0;
      const p = pct(verval, jumlah);

      const bar = document.createElement("div");
      bar.className = "stacked-bar";
      const segVerval = document.createElement("div");
      segVerval.className = "bar-seg";
      segVerval.style.width = (jumlah ? (verval / jumlah) * 100 : 0).toFixed(2) + "%";
      segVerval.style.background = GOOD;
      segVerval.title = "Sudah Diverval: " + verval.toLocaleString("id-ID");
      const segBelum = document.createElement("div");
      segBelum.className = "bar-seg";
      segBelum.style.width = (jumlah ? (belum / jumlah) * 100 : 0).toFixed(2) + "%";
      segBelum.style.background = MUTED;
      segBelum.title = "Belum Diverval: " + belum.toLocaleString("id-ID");
      bar.appendChild(segVerval);
      bar.appendChild(segBelum);
      card.appendChild(bar);

      const legend = document.createElement("ul");
      legend.className = "legend";
      const liJumlah = document.createElement("li");
      liJumlah.innerHTML = "<strong>" + jumlah.toLocaleString("id-ID") + "</strong> Jumlah ATS";
      const liVerval = document.createElement("li");
      const swatchVerval = document.createElement("span");
      swatchVerval.className = "swatch";
      swatchVerval.style.background = GOOD;
      liVerval.appendChild(swatchVerval);
      liVerval.appendChild(
        document.createTextNode("Sudah Diverval — " + verval.toLocaleString("id-ID") + " (" + (p === null ? "-" : p.toFixed(1)) + "%)")
      );
      const liBelum = document.createElement("li");
      const swatchBelum = document.createElement("span");
      swatchBelum.className = "swatch";
      swatchBelum.style.background = MUTED;
      liBelum.appendChild(swatchBelum);
      liBelum.appendChild(document.createTextNode("Belum Diverval — " + belum.toLocaleString("id-ID")));
      legend.appendChild(liJumlah);
      legend.appendChild(liVerval);
      legend.appendChild(liBelum);
      card.appendChild(legend);

      container.appendChild(card);
    }
  }

  // ---------------------------------------------------------------------
  // Render: grafik tren % Sudah Diverval per kategori
  // ---------------------------------------------------------------------

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  }

  let tooltipEl = null;
  function showChartTooltip(targetCircle, valueText, seriesLabel, dateLabel) {
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "spm-chart-tooltip";
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = valueText;
    tooltipEl.appendChild(strong);
    tooltipEl.appendChild(document.createTextNode(" — " + seriesLabel + ", " + dateLabel));
    const rect = targetCircle.getBoundingClientRect();
    tooltipEl.style.left = rect.left + rect.width / 2 + window.scrollX + "px";
    tooltipEl.style.top = rect.top + window.scrollY - 8 + "px";
    tooltipEl.hidden = false;
  }
  function hideChartTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  /** Grafik garis "% Sudah Diverval dari waktu ke waktu", 1 garis per
   * kategori ATS (Gabungan/DO/LTM/BPB). Dipola dari grafik kelompok
   * indikator SPM (js/spm.js) tapi disederhanakan: sumbu-y persentase
   * (0-100, bukan skala dinamis per indikator), sumbu-x mengikuti jumlah
   * tanggal snapshot yang ada (bisa bertambah seiring waktu). */
  function buildTrendChart(seriesList, dateLabels) {
    const card = document.createElement("div");
    card.className = "spm-group-card";

    const withData = seriesList.filter((s) => s.points.some((v) => v !== null));
    if (withData.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "Data tren tidak tersedia utk wilayah ini.";
      card.appendChild(empty);
      return card;
    }

    const W = 640;
    const PLOT_H = 220;
    const PAD_X = 16;
    const PAD_TOP = 16;
    const AXIS_H = 24;
    const allValues = withData.flatMap((s) => s.points.filter((v) => v !== null));
    const vMin = Math.max(0, Math.min(...allValues));
    const vMax = Math.min(100, Math.max(...allValues));
    const vPad = vMax === vMin ? Math.max(3, vMax * 0.1) : (vMax - vMin) * 0.2;
    const yLo = Math.max(0, vMin - vPad);
    const yHi = Math.min(100, vMax + vPad);
    const plotTop = PAD_TOP;
    const plotBottom = PAD_TOP + PLOT_H;
    const n = dateLabels.length;
    const xStep = n > 1 ? (W - PAD_X * 2) / (n - 1) : 0;

    const xOf = (i) => PAD_X + i * xStep;
    const yOf = (v) => (yHi === yLo ? plotBottom : plotBottom - ((v - yLo) / (yHi - yLo)) * PLOT_H);

    const svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + (plotBottom + AXIS_H),
      class: "spm-group-svg",
      role: "img",
      "aria-label": "Tren persentase Sudah Diverval per kategori ATS",
    });

    svg.appendChild(svgEl("line", { x1: PAD_X, y1: plotBottom, x2: W - PAD_X, y2: plotBottom, class: "spm-chart-baseline" }));

    dateLabels.forEach((label, i) => {
      const t = svgEl("text", {
        x: xOf(i),
        y: plotBottom + 17,
        "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle",
        class: "spm-chart-axis-label",
      });
      t.textContent = label;
      svg.appendChild(t);
    });

    // Label nilai ditumpuk rapi per kolom tanggal spy tidak saling tindih
    // kalau 2+ kategori kebetulan bernilai dekat (sama spt js/spm.js).
    const MIN_LABEL_GAP = 13;
    const labelYByKey = {};
    dateLabels.forEach((_, i) => {
      const colPoints = [];
      withData.forEach((s, seriesIdx) => {
        const v = s.points[i];
        if (v !== null) colPoints.push({ seriesIdx, cy: yOf(v) });
      });
      colPoints.sort((a, b) => a.cy - b.cy);
      let prevY = -Infinity;
      for (const p of colPoints) {
        const desired = p.cy - 7;
        const y = Math.max(desired, prevY + MIN_LABEL_GAP);
        labelYByKey[p.seriesIdx + "," + i] = y;
        prevY = y;
      }
    });

    const legend = document.createElement("ul");
    legend.className = "spm-chart-legend";

    withData.forEach((s, seriesIdx) => {
      const colorVar = "var(--series-" + ((seriesIdx % 8) + 1) + ")";

      let pathD = "";
      s.points.forEach((v, i) => {
        if (v === null) return;
        pathD += (pathD ? "L" : "M") + xOf(i).toFixed(1) + "," + yOf(v).toFixed(1);
      });
      const linePath = svgEl("path", { d: pathD, class: "spm-chart-line" });
      linePath.style.stroke = colorVar;
      svg.appendChild(linePath);

      s.points.forEach((v, i) => {
        if (v === null) return;
        const cx = xOf(i);
        const cy = yOf(v);
        const valueText = v.toFixed(1).replace(/\.0$/, "") + "%";

        const hit = svgEl("circle", { cx, cy, r: 12, class: "spm-chart-hit", tabindex: "0" });
        svg.appendChild(hit);
        svg.appendChild(svgEl("circle", { cx, cy, r: 4.5, class: "spm-chart-dot-ring" }));
        const dot = svgEl("circle", { cx, cy, r: 3 });
        dot.style.fill = colorVar;
        svg.appendChild(dot);

        const valLabel = svgEl("text", {
          x: Math.max(PAD_X, Math.min(cx, W - PAD_X)),
          y: labelYByKey[seriesIdx + "," + i],
          "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle",
          class: "spm-chart-value-label",
        });
        valLabel.textContent = valueText;
        svg.appendChild(valLabel);

        hit.addEventListener("pointerenter", () => showChartTooltip(hit, valueText, s.label, dateLabels[i]));
        hit.addEventListener("focus", () => showChartTooltip(hit, valueText, s.label, dateLabels[i]));
        hit.addEventListener("pointerleave", hideChartTooltip);
        hit.addEventListener("blur", hideChartTooltip);
      });

      const li = document.createElement("li");
      const key = document.createElement("span");
      key.className = "spm-chart-legend-key";
      key.style.background = colorVar;
      const text = document.createElement("span");
      text.className = "spm-chart-legend-text";
      text.textContent = s.label;
      text.title = s.label;
      li.appendChild(key);
      li.appendChild(text);
      legend.appendChild(li);
    });

    card.appendChild(svg);
    card.appendChild(legend);
    return card;
  }

  function renderTrendChart() {
    const container = el("ats-trend");
    container.innerHTML = "";

    const dateLabels = (state.categories.gabungan.dates || []).map((d) => shortDateLabel(d.label));
    const seriesList = CFG.ATS_CATEGORIES.map((category) => {
      const series = totalsFor(category.key, state.kabupatenKey) || [];
      return { label: category.label, points: series.map((s) => pct(s.verval, s.jumlah)) };
    });
    container.appendChild(buildTrendChart(seriesList, dateLabels));
  }

  // ---------------------------------------------------------------------
  // Render: grafik batang Alasan Verifikasi
  // ---------------------------------------------------------------------

  /** Grafik batang horizontal peringkat alasan verifikasi (Sudah Diverval,
   * gabungan DO+LTM+BPB) utk wilayah terpilih — diurutkan besar ke kecil,
   * alasan dgn 0 kasus di wilayah itu disembunyikan supaya daftarnya tetap
   * relevan. Batang horizontal dipilih (bukan grafik garis spt Tren
   * Verifikasi) krn ini perbandingan ANTAR KATEGORI pada satu snapshot,
   * bukan satu nilai dari waktu ke waktu — dan labelnya (alasan) berupa
   * teks panjang yang lebih mudah dibaca mendatar drpd di sumbu-x tegak. */
  function renderReasonChart() {
    const container = el("ats-reason-chart");
    container.innerHTML = "";

    const entry =
      state.kabupatenKey === PROVINCE_VALUE
        ? state.alasan.provinceTotal
        : state.alasan.subtotalByKabkota[state.kabupatenKey];

    if (!entry) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "Data alasan verifikasi tidak tersedia utk wilayah ini.";
      container.appendChild(empty);
      return;
    }

    const items = state.alasan.reasonCodes
      .map((code) => ({
        code,
        label: CFG.ATS_REASON_LABELS[code] || code,
        count: entry.counts[code] || 0,
      }))
      .filter((it) => it.count > 0)
      .sort((a, b) => b.count - a.count);

    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "Belum ada kasus terverifikasi dgn alasan tercatat utk wilayah ini.";
      container.appendChild(empty);
      return;
    }

    const maxCount = items[0].count;
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "reason-bar-row";

      const label = document.createElement("span");
      label.className = "reason-bar-label";
      label.textContent = it.code + " · " + it.label;
      label.title = it.code + " — " + it.label;

      const track = document.createElement("div");
      track.className = "reason-bar-track";
      const fill = document.createElement("div");
      fill.className = "reason-bar-fill";
      fill.style.width = ((it.count / maxCount) * 100).toFixed(1) + "%";
      track.appendChild(fill);

      const value = document.createElement("span");
      value.className = "reason-bar-value";
      value.textContent = it.count.toLocaleString("id-ID");

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      container.appendChild(row);
    }
  }

  // ---------------------------------------------------------------------
  // Render: tabel detail per kecamatan (kategori Gabungan)
  // ---------------------------------------------------------------------

  function renderKecamatanTable() {
    const table = el("ats-table");
    const tbody = el("ats-body");
    tbody.innerHTML = "";

    const rows = state.categories.gabungan.kecamatanRows.filter(
      (r) => state.kabupatenKey === PROVINCE_VALUE || r.kabkota === state.kabupatenKey
    );

    for (const r of rows) {
      const latest = r.series[r.series.length - 1];
      const jumlah = latest.jumlah || 0;
      const verval = latest.verval || 0;
      const belum = latest.belum || 0;
      const p = pct(verval, jumlah);

      const tr = document.createElement("tr");

      const tdNo = document.createElement("td");
      tdNo.textContent = r.no;
      const tdKabkota = document.createElement("td");
      tdKabkota.className = "col-truncate";
      tdKabkota.textContent = r.kabkota;
      tdKabkota.title = r.kabkota;
      const tdKecamatan = document.createElement("td");
      tdKecamatan.className = "col-wrap";
      tdKecamatan.textContent = r.kecamatan;
      const tdJumlah = document.createElement("td");
      tdJumlah.className = "col-indicator";
      tdJumlah.textContent = jumlah.toLocaleString("id-ID");
      const tdVerval = document.createElement("td");
      tdVerval.className = "col-indicator";
      tdVerval.textContent = verval.toLocaleString("id-ID");
      const tdBelum = document.createElement("td");
      tdBelum.className = "col-indicator";
      tdBelum.textContent = belum.toLocaleString("id-ID");
      const tdPct = document.createElement("td");
      tdPct.className = "col-indicator";
      tdPct.innerHTML =
        p === null
          ? "<span class='chip chip-muted'>-</span>"
          : "<span class='chip' style='background:" + pctColor(p) + "'>" + p.toFixed(1) + "%</span>";

      tr.appendChild(tdNo);
      tr.appendChild(tdKabkota);
      tr.appendChild(tdKecamatan);
      tr.appendChild(tdJumlah);
      tr.appendChild(tdVerval);
      tr.appendChild(tdBelum);
      tr.appendChild(tdPct);
      tbody.appendChild(tr);
    }

    table.hidden = false;
  }

  function render() {
    renderSummaryCards();
    renderTrendChart();
    renderReasonChart();
    renderKecamatanTable();
  }

  async function main() {
    try {
      setStatus("Membaca data ATS (DO, LTM, BPB, Gabungan, Alasan Verifikasi)...", false);

      for (const category of CFG.ATS_CATEGORIES) {
        state.categories[category.key] = await loadCategorySheet(category.sheet);
      }
      state.alasan = await loadAlasanSheet();

      const gabungan = state.categories.gabungan;
      const kabupatenList = [];
      const seen = new Set();
      for (const r of gabungan.kecamatanRows) {
        if (!seen.has(r.kabkota)) {
          seen.add(r.kabkota);
          kabupatenList.push(r.kabkota);
        }
      }
      state.kabupatenList = kabupatenList;

      el("ats-updated").textContent = gabungan.subtitleRow || "";

      renderKabupatenSelect();
      render();
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(
        "Gagal memuat data: " + err.message + ". Pastikan spreadsheet ATS dibagikan sebagai “siapa saja yang memiliki link dapat melihat” dan koneksi internet aktif.",
        true
      );
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();

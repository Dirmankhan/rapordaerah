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
    // Kolom capaian tahun-tahun sebelumnya (2022-2024) bersifat opsional —
    // kalau tidak ketemu, kolomnya tetap ditampilkan tapi berisi "-", tidak
    // menggagalkan pemuatan seluruh halaman. Kolom 2022 di sheet sumber
    // header-nya tertulis "Label Capaian 2022" walau isinya angka (nilai),
    // jadi dicocokkan longgar lewat tahunnya saja.
    const idxHist = {
      nilai2024: findCol(header, /capaian 2024/),
      nilai2023: findCol(header, /capaian 2023/),
      nilai2022: findCol(header, /capaian 2022/),
    };

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
        nilai2024: idxHist.nilai2024 >= 0 ? row[idxHist.nilai2024] ?? null : null,
        nilai2023: idxHist.nilai2023 >= 0 ? row[idxHist.nilai2023] ?? null : null,
        nilai2022: idxHist.nilai2022 >= 0 ? row[idxHist.nilai2022] ?? null : null,
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

  function toNumber(v) {
    if (isBlank(v)) return null;
    if (typeof v === "number") return v;
    const n = parseFloat(String(v).trim().replace(",", "."));
    return Number.isNaN(n) ? null : n;
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
      tdNama.className = "col-wrap";
      tdNama.textContent = ind.nama;
      tdNama.title = ind.nama;
      const td2022 = document.createElement("td");
      td2022.className = "col-indicator";
      const td2023 = document.createElement("td");
      td2023.className = "col-indicator";
      const td2024 = document.createElement("td");
      td2024.className = "col-indicator";
      const tdNilai = document.createElement("td");
      tdNilai.className = "col-indicator";
      const tdLabel = document.createElement("td");
      tdLabel.className = "col-indicator";

      // Nilai & label ditampilkan independen: sebagian indikator (mis.
      // Kemampuan literasi/numerasi) memang cuma berupa skor tanpa label
      // kategori, jadi label kosong tidak berarti nilainya ikut kosong.
      td2022.textContent = !r || isBlank(r.nilai2022) ? "-" : r.nilai2022;
      td2023.textContent = !r || isBlank(r.nilai2023) ? "-" : r.nilai2023;
      td2024.textContent = !r || isBlank(r.nilai2024) ? "-" : r.nilai2024;
      tdNilai.textContent = !r || isBlank(r.nilai) ? "-" : r.nilai;
      tdLabel.innerHTML = !r || isBlank(r.label) ? "<span class='chip chip-muted'>-</span>" : chipHtml(r.label);

      tr.appendChild(tdNo);
      tr.appendChild(tdNama);
      tr.appendChild(td2022);
      tr.appendChild(td2023);
      tr.appendChild(td2024);
      tr.appendChild(tdNilai);
      tr.appendChild(tdLabel);
      tbody.appendChild(tr);
    });

    table.hidden = false;
  }

  const YEARS = [2022, 2023, 2024, 2025];
  const YEAR_FIELD = { 2022: "nilai2022", 2023: "nilai2023", 2024: "nilai2024", 2025: "nilai" };
  const SERIES_SLOTS = 8; // var(--series-1) .. var(--series-8), urutan tetap

  function formatValue(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/,?\.$/, "").replace(".", ",");
  }

  /** Semua indikator (tanpa dirata-ratakan) dari kelompok ini, utk kabupaten/
   * kota terpilih — satu seri per indikator, urutan mengikuti kemunculan
   * pertamanya di sheet (state.indicatorOrder) supaya warna tiap indikator
   * tetap konsisten saat kabupaten/kota diganti. Tahun tanpa nilai numerik
   * (mis. "#N/A") menghasilkan titik `null` — dilompati di garis, bukan
   * dipaksakan jadi 0. */
  function computeGroupSeriesList(nama, group) {
    const byKey = {};
    for (const r of state.rows) {
      if (r.pemda === nama) byKey[indicatorKey(r.no, r.nama)] = r;
    }
    return state.indicatorOrder
      .filter((ind) => group.match.test(ind.nama))
      .map((ind) => {
        const r = byKey[indicatorKey(ind.no, ind.nama)];
        const points = YEARS.map((year) => (r ? toNumber(r[YEAR_FIELD[year]]) : null));
        return { label: ind.nama, points };
      });
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  }

  /** Grafik garis multi-seri (satu garis per indikator anggota kelompok) utk
   * tren 2022-2025. Plot area lebih lebar (2 kartu/baris) supaya label nilai
   * di tiap titik tahun, utk tiap indikator, tetap terbaca. */
  function buildGroupChart(label, seriesList) {
    const card = document.createElement("div");
    card.className = "spm-group-card";

    const h3 = document.createElement("h3");
    h3.textContent = label;
    card.appendChild(h3);

    const withData = seriesList.filter((s) => s.points.some((v) => v !== null));
    if (withData.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "Data tidak tersedia untuk kelompok ini.";
      card.appendChild(empty);
      return card;
    }

    const W = 560;
    const PLOT_H = 260;
    const PAD_X = 16;
    const PAD_TOP = 16;
    const AXIS_H = 24;
    const allValues = withData.flatMap((s) => s.points.filter((v) => v !== null));
    const vMin = Math.min(...allValues);
    const vMax = Math.max(...allValues);
    const vPad = vMax === vMin ? Math.max(1, vMax * 0.1) : (vMax - vMin) * 0.18;
    const yLo = vMin - vPad;
    const yHi = vMax + vPad;
    const plotTop = PAD_TOP;
    const plotBottom = PAD_TOP + PLOT_H;
    const xStep = YEARS.length > 1 ? (W - PAD_X * 2) / (YEARS.length - 1) : 0;

    const xOf = (i) => PAD_X + i * xStep;
    const yOf = (v) => plotBottom - ((v - yLo) / (yHi - yLo)) * PLOT_H;

    const svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + (plotBottom + AXIS_H),
      class: "spm-group-svg",
      role: "img",
      "aria-label": label + ": tren Nilai Capaian 2022 sampai 2025 per indikator",
    });

    // Garis dasar (baseline) hairline, satu step dari warna surface.
    svg.appendChild(
      svgEl("line", { x1: PAD_X, y1: plotBottom, x2: W - PAD_X, y2: plotBottom, class: "spm-chart-baseline" })
    );

    // Label tahun di sumbu-x (ink muted).
    YEARS.forEach((year, i) => {
      const t = svgEl("text", {
        x: xOf(i),
        y: plotBottom + 17,
        "text-anchor": i === 0 ? "start" : i === YEARS.length - 1 ? "end" : "middle",
        class: "spm-chart-axis-label",
      });
      t.textContent = String(year);
      svg.appendChild(t);
    });

    // Posisi label nilai dihitung per kolom tahun (bukan per seri independen):
    // titik-titik yang nilainya berdekatan di tahun yang sama ditumpuk rapi
    // dari atas ke bawah dengan jarak minimum, supaya tidak saling tindih —
    // pendekatan "above/below berselang-seling per seri" sebelumnya gagal
    // saat 2+ seri kebetulan bernilai dekat (lihat marks-and-anatomy.md soal
    // label yang bertabrakan).
    const MIN_LABEL_GAP = 13;
    const labelYByKey = {}; // "seriesIdx,i" -> y label
    YEARS.forEach((year, i) => {
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
      const colorVar = "var(--series-" + ((seriesIdx % SERIES_SLOTS) + 1) + ")";

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
        const year = YEARS[i];
        const valueText = formatValue(v);

        // Target hover/fokus (lebih besar dari titik terlihat, >=24px).
        const hit = svgEl("circle", { cx, cy, r: 12, class: "spm-chart-hit", tabindex: "0" });
        svg.appendChild(hit);

        // Titik terlihat + cincin warna surface (spacer thd garis/titik lain).
        svg.appendChild(svgEl("circle", { cx, cy, r: 4.5, class: "spm-chart-dot-ring" }));
        const dot = svgEl("circle", { cx, cy, r: 3 });
        dot.style.fill = colorVar;
        svg.appendChild(dot);

        // Label nilai di tiap titik (ink muted, bukan warna seri — lihat
        // marks-and-anatomy.md: teks tidak boleh memakai warna data).
        const valLabel = svgEl("text", {
          x: Math.max(PAD_X, Math.min(cx, W - PAD_X)),
          y: labelYByKey[seriesIdx + "," + i],
          "text-anchor": i === 0 ? "start" : i === YEARS.length - 1 ? "end" : "middle",
          class: "spm-chart-value-label",
        });
        valLabel.textContent = valueText;
        svg.appendChild(valLabel);

        hit.addEventListener("pointerenter", () => showChartTooltip(hit, valueText, s.label, year));
        hit.addEventListener("focus", () => showChartTooltip(hit, valueText, s.label, year));
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

  let tooltipEl = null;
  function showChartTooltip(targetCircle, valueText, indicatorLabel, year) {
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "spm-chart-tooltip";
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = valueText;
    tooltipEl.appendChild(strong);
    tooltipEl.appendChild(document.createTextNode(" — " + indicatorLabel + ", " + year));
    const rect = targetCircle.getBoundingClientRect();
    tooltipEl.style.left = rect.left + rect.width / 2 + window.scrollX + "px";
    tooltipEl.style.top = rect.top + window.scrollY - 8 + "px";
    tooltipEl.hidden = false;
  }
  function hideChartTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  function renderGroupCharts(nama) {
    const container = el("spm-groups");
    container.innerHTML = "";
    const groups = CFG.SPM_INDICATOR_GROUPS || [];
    for (const group of groups) {
      const seriesList = computeGroupSeriesList(nama, group);
      container.appendChild(buildGroupChart(group.label, seriesList));
    }
  }

  function showKabupaten(nama) {
    renderTable(nama);
    renderGroupCharts(nama);
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

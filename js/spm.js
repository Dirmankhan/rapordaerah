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
      tdNama.className = "col-truncate";
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

  /** Rata-rata Nilai Capaian per tahun utk satu grup indikator, dari baris
   * kabupaten/kota terpilih yang nama indikatornya cocok dgn `group.match`.
   * Tahun tanpa nilai numerik sama sekali (semua baris kosong/non-angka)
   * menghasilkan `null` pada titik itu — tidak dipaksakan jadi 0. */
  function computeGroupSeries(nama, group) {
    const matching = state.rows.filter((r) => r.pemda === nama && group.match.test(r.nama));
    return YEARS.map((year) => {
      const field = YEAR_FIELD[year];
      const values = matching.map((r) => toNumber(r[field])).filter((v) => v !== null);
      if (values.length === 0) return null;
      return values.reduce((a, b) => a + b, 0) / values.length;
    });
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  }

  /** Grafik garis ringkas (satu seri) utk tren 2022-2025 satu grup indikator.
   * Plot area 280x120, pita sumbu-x ~24px di bawahnya utk label tahun —
   * tinggi kontainer mengikuti ini (bukan tinggi tetap yg memotong label). */
  function buildGroupChart(label, series) {
    const card = document.createElement("div");
    card.className = "spm-group-card";

    const h3 = document.createElement("h3");
    h3.textContent = label;
    card.appendChild(h3);

    const points = series
      .map((v, i) => ({ year: YEARS[i], value: v }))
      .filter((p) => p.value !== null);

    if (points.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "Data tidak tersedia untuk kelompok ini.";
      card.appendChild(empty);
      return card;
    }

    const W = 280;
    const PLOT_H = 110;
    const PAD_X = 12;
    const AXIS_H = 22;
    const values = points.map((p) => p.value);
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const vPad = vMax === vMin ? Math.max(1, vMax * 0.1) : (vMax - vMin) * 0.15;
    const yLo = vMin - vPad;
    const yHi = vMax + vPad;
    const xStep = YEARS.length > 1 ? (W - PAD_X * 2) / (YEARS.length - 1) : 0;

    const xOf = (i) => PAD_X + i * xStep;
    const yOf = (v) => PLOT_H - ((v - yLo) / (yHi - yLo)) * PLOT_H;

    const svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + (PLOT_H + AXIS_H),
      class: "spm-group-svg",
      role: "img",
      "aria-label": label + ": tren Nilai Capaian 2022 sampai 2025",
    });

    // Garis dasar (baseline) hairline, satu step dari warna surface.
    svg.appendChild(
      svgEl("line", { x1: PAD_X, y1: PLOT_H, x2: W - PAD_X, y2: PLOT_H, class: "spm-chart-baseline" })
    );

    // Label tahun di sumbu-x (ink muted), hanya utk tahun yg datanya ada.
    YEARS.forEach((year, i) => {
      const t = svgEl("text", {
        x: xOf(i),
        y: PLOT_H + 15,
        "text-anchor": i === 0 ? "start" : i === YEARS.length - 1 ? "end" : "middle",
        class: "spm-chart-axis-label",
      });
      t.textContent = String(year);
      svg.appendChild(t);
    });

    // Garis seri (hanya menghubungkan titik yg datanya ada — melompati tahun kosong).
    let pathD = "";
    series.forEach((v, i) => {
      if (v === null) return;
      pathD += (pathD ? "L" : "M") + xOf(i).toFixed(1) + "," + yOf(v).toFixed(1);
    });
    svg.appendChild(svgEl("path", { d: pathD, class: "spm-chart-line" }));

    const lastIdx = series.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0).pop();

    series.forEach((v, i) => {
      if (v === null) return;
      const cx = xOf(i);
      const cy = yOf(v);
      const year = YEARS[i];
      const valueText = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");

      // Target hover/fokus (lebih besar dari titik yg terlihat, >=24px).
      const hit = svgEl("circle", {
        cx,
        cy,
        r: 12,
        class: "spm-chart-hit",
        tabindex: "0",
        role: "img",
        "aria-label": "Tahun " + year + ": " + valueText,
      });
      svg.appendChild(hit);

      // Titik terlihat + cincin warna surface (spacer antara titik & garis).
      svg.appendChild(svgEl("circle", { cx, cy, r: 5, class: "spm-chart-dot-ring" }));
      svg.appendChild(svgEl("circle", { cx, cy, r: 3.5, class: "spm-chart-dot" }));

      if (i === lastIdx) {
        const label2025 = svgEl("text", {
          x: Math.min(cx, W - PAD_X - 2),
          y: Math.max(cy - 10, 10),
          "text-anchor": "end",
          class: "spm-chart-value-label",
        });
        label2025.textContent = valueText;
        svg.appendChild(label2025);
      }

      const tooltip = "Tahun " + year + ": " + valueText;
      hit.addEventListener("pointerenter", () => showChartTooltip(hit, tooltip));
      hit.addEventListener("focus", () => showChartTooltip(hit, tooltip));
      hit.addEventListener("pointerleave", hideChartTooltip);
      hit.addEventListener("blur", hideChartTooltip);
    });

    card.appendChild(svg);
    return card;
  }

  let tooltipEl = null;
  function showChartTooltip(targetCircle, text) {
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "spm-chart-tooltip";
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.textContent = text;
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
      const series = computeGroupSeries(nama, group);
      container.appendChild(buildGroupChart(group.label, series));
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

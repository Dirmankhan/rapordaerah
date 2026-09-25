(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { categorize, escapeHtml } = window.Shared;

  const el = (id) => document.getElementById(id);

  const state = {
    schools: [],
    bySchoolKey: new Map(), // "kabkota norm|kecamatan norm" -> [school,...]
    geoLayer: null,
    map: null,
    indicatorKey: CFG.INDICATORS[0].key,
    kabupatenList: [], // nama asli dari data sekolah
    selectedKab: "",
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

  // -----------------------------------------------------------------------
  // Pencocokan nama kabupaten/kecamatan antara data sekolah & GeoJSON
  // -----------------------------------------------------------------------

  function normText(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  /** Samakan penulisan nama Kabupaten/Kota: GeoJSON pakai "Sumbawa Barat" /
   * "Kota Mataram", data sekolah pakai "Kabupaten Sumbawa Barat" / "Kota
   * Mataram" — normalisasi ke satu bentuk agar bisa dicocokkan. */
  function normKabKota(name) {
    let n = normText(name);
    n = n.replace(/^kab\.?\s+/, "kabupaten ");
    if (!/^kota\s/.test(n) && !/^kabupaten\s/.test(n)) {
      n = "kabupaten " + n;
    }
    return n;
  }

  /** Samakan penulisan nama Kecamatan: buang awalan "Kec./Kecamatan" bila
   * ada di data sekolah, supaya cocok dgn GeoJSON yang tanpa awalan. */
  function normKecamatan(name) {
    return normText(name).replace(/^kec\.?(amatan)?\s+/, "");
  }

  function schoolKey(kabkota, kecamatan) {
    return normKabKota(kabkota) + "|" + normKecamatan(kecamatan);
  }

  function findCol(header, regex) {
    for (let i = 0; i < header.length; i++) {
      if (regex.test(String(header[i] || "").toLowerCase())) return i;
    }
    return -1;
  }

  /** Baca sheet referensi NPSN (data Dapodik) dan bangun peta
   * npsn -> {kabkota, kecamatan} memakai nama acuan resminya, dicoba
   * dari nama tab pertama di CFG.REFERENSI_SHEET_NAMES yang berhasil &
   * punya kolom "npsn". */
  async function loadReferensiByNpsn() {
    for (const sheetName of CFG.REFERENSI_SHEET_NAMES) {
      let raw;
      try {
        raw = await Gviz.fetchSheetRaw(CFG.CONFIG_SHEET_ID, sheetName);
      } catch (err) {
        continue;
      }
      if (raw.length < 2) continue;
      const header = raw[0];
      const idxNpsn = findCol(header, /^npsn$/);
      const idxKec = findCol(header, /^kecamatan$/);
      const idxKab = findCol(header, /^kabupaten$/);
      if (idxNpsn === -1 || idxKec === -1 || idxKab === -1) continue;

      const map = new Map();
      for (const row of raw.slice(1)) {
        const npsn = String(row[idxNpsn] ?? "").trim();
        if (!npsn) continue;
        map.set(npsn, { kabkota: row[idxKab] ?? "", kecamatan: row[idxKec] ?? "" });
      }
      return map;
    }
    return new Map();
  }

  // -----------------------------------------------------------------------
  // Warna gradasi merah -> kuning -> hijau
  // -----------------------------------------------------------------------

  const GRADIENT_STOPS = [
    [0, "#a50026"],
    [0.25, "#f46d43"],
    [0.5, "#ffffbf"],
    [0.75, "#66bd63"],
    [1, "#006837"],
  ];
  const NODATA_COLOR = "#d8d6cf";

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex([r, g, b]) {
    return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function colorForT(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
      const [t0, c0] = GRADIENT_STOPS[i];
      const [t1, c1] = GRADIENT_STOPS[i + 1];
      if (t >= t0 && t <= t1) {
        const localT = (t - t0) / (t1 - t0);
        const rgb0 = hexToRgb(c0);
        const rgb1 = hexToRgb(c1);
        return rgbToHex(rgb0.map((v, i2) => lerp(v, rgb1[i2], localT)));
      }
    }
    return GRADIENT_STOPS[GRADIENT_STOPS.length - 1][1];
  }

  /** Hitung statistik label capaian utk 1 indikator dari sekumpulan sekolah. */
  function computeStats(schools, indicatorKey) {
    let total = 0;
    let baik = 0;
    let kurang = 0;
    for (const s of schools) {
      const v = s.indikator[indicatorKey];
      if (!v || !v.label) continue;
      const cat = categorize(v.label);
      if (cat.rank === 3) continue; // "Tidak Tersedia" — tidak dihitung
      total++;
      if (cat.rank === 0) baik++;
      else if (cat.rank === 2) kurang++;
    }
    const pctBaik = total ? (100 * baik) / total : null;
    const pctKurang = total ? (100 * kurang) / total : null;
    return { total, baik, kurang, pctBaik, pctKurang };
  }

  function styleForStats(stats) {
    if (stats.total === 0) {
      return { fillColor: NODATA_COLOR, fillOpacity: 0.55, color: "#ffffff", weight: 1 };
    }
    const score = stats.pctBaik - stats.pctKurang; // -100..100
    const t = (score + 100) / 200;
    return { fillColor: colorForT(t), fillOpacity: 0.75, color: "#ffffff", weight: 1 };
  }

  // -----------------------------------------------------------------------
  // Peta
  // -----------------------------------------------------------------------

  function popupHtml(props, stats) {
    const rows = [
      ["Kabupaten/Kota", props.kab_kota],
      ["Satdik dinilai", stats.total.toLocaleString("id-ID")],
    ];
    if (stats.total > 0) {
      rows.push(["% Baik/Tinggi", stats.pctBaik.toFixed(1) + "%"]);
      rows.push(["% Kurang/Rendah", stats.pctKurang.toFixed(1) + "%"]);
    }
    return (
      "<div class='peta-popup'><h4>" +
      escapeHtml(props.kecamatan) +
      "</h4><dl>" +
      rows.map(([k, v]) => "<dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(v) + "</dd>").join("") +
      "</dl></div>"
    );
  }

  function restyleLayer() {
    if (!state.geoLayer) return;
    const selectedKabNorm = state.selectedKab ? normKabKota(state.selectedKab) : null;
    state.geoLayer.eachLayer((layer) => {
      const props = layer.feature.properties;
      const schools = state.bySchoolKey.get(schoolKey(props.kab_kota, props.kecamatan)) || [];
      const stats = computeStats(schools, state.indicatorKey);
      const style = styleForStats(stats);
      const inSelectedKab = !selectedKabNorm || normKabKota(props.kab_kota) === selectedKabNorm;
      if (!inSelectedKab) style.fillOpacity = Math.min(style.fillOpacity, 0.12);
      layer.setStyle(style);
      layer.unbindTooltip();
      layer.bindTooltip(popupHtml(props, stats), { sticky: true, className: "peta-popup-tooltip" });
    });
  }

  function fitToSelectedKab() {
    if (!state.geoLayer) return;
    if (!state.selectedKab) {
      state.map.fitBounds(state.geoLayer.getBounds(), { padding: [12, 12] });
      return;
    }
    const norm = normKabKota(state.selectedKab);
    const bounds = [];
    state.geoLayer.eachLayer((layer) => {
      if (normKabKota(layer.feature.properties.kab_kota) === norm) {
        bounds.push(layer.getBounds());
      }
    });
    if (bounds.length) {
      let combined = bounds[0];
      for (const b of bounds.slice(1)) combined = combined.extend(b);
      state.map.fitBounds(combined, { padding: [12, 12] });
    }
  }

  // -----------------------------------------------------------------------
  // Filter UI
  // -----------------------------------------------------------------------

  function renderFilters() {
    const kabSelect = el("peta-kab-select");
    for (const kab of state.kabupatenList) {
      const opt = document.createElement("option");
      opt.value = kab;
      opt.textContent = kab;
      kabSelect.appendChild(opt);
    }
    kabSelect.addEventListener("change", () => {
      state.selectedKab = kabSelect.value;
      restyleLayer();
      fitToSelectedKab();
    });

    const indSelect = el("peta-indikator-select");
    for (const ind of CFG.INDICATORS) {
      const opt = document.createElement("option");
      opt.value = ind.key;
      opt.textContent = ind.label;
      indSelect.appendChild(opt);
    }
    indSelect.value = state.indicatorKey;
    indSelect.addEventListener("change", () => {
      state.indicatorKey = indSelect.value;
      restyleLayer();
    });
  }

  // -----------------------------------------------------------------------
  // Orkestrasi
  // -----------------------------------------------------------------------

  async function main() {
    try {
      setStatus("Memuat batas wilayah kecamatan...", false);
      const geoRes = await fetch("data/ntb_kecamatan.geojson");
      if (!geoRes.ok) throw new Error("Gagal memuat berkas GeoJSON (HTTP " + geoRes.status + ")");
      const geojson = await geoRes.json();

      const result = await window.SchoolData.loadAll((msg) => setStatus(msg, false));
      state.schools = result.schools;

      setStatus("Membaca sheet referensi NPSN...", false);
      const referensiByNpsn = await loadReferensiByNpsn();

      setStatus("Menggabungkan data...", false);
      const kabSet = new Set();
      let fromReferensi = 0;
      let fromRapor = 0;
      for (const s of state.schools) {
        const ref = referensiByNpsn.get(String(s.npsn ?? "").trim());
        const kabkota = ref ? ref.kabkota : s.kabkota;
        const kecamatan = ref ? ref.kecamatan : s.kecamatan;
        if (ref) fromReferensi++;
        else fromRapor++;
        if (!kabkota) continue;
        kabSet.add(kabkota);
        const key = schoolKey(kabkota, kecamatan);
        if (!state.bySchoolKey.has(key)) state.bySchoolKey.set(key, []);
        state.bySchoolKey.get(key).push(s);
      }
      state.kabupatenList = Array.from(kabSet).sort((a, b) => a.localeCompare(b, "id"));

      const referensiLine =
        (fromReferensi > 0
          ? fromReferensi.toLocaleString("id-ID") + " satdik pakai wilayah dari sheet referensi (NPSN)"
          : "Sheet referensi NPSN tidak ditemukan/kosong") +
        (fromRapor > 0 ? ", " + fromRapor.toLocaleString("id-ID") + " fallback ke data rapor." : ".");

      // Deteksi kecamatan di GeoJSON yang tidak ketemu padanannya di data sekolah.
      const unmatched = [];
      for (const feat of geojson.features) {
        const key = schoolKey(feat.properties.kab_kota, feat.properties.kecamatan);
        if (!state.bySchoolKey.has(key)) {
          unmatched.push(feat.properties.kecamatan + " (" + feat.properties.kab_kota + ")");
        }
      }
      const matchedCount = geojson.features.length - unmatched.length;
      const p = el("peta-unmatched");
      p.hidden = false;
      if (unmatched.length === 0) {
        p.textContent = referensiLine + " Semua " + geojson.features.length + " kecamatan di peta cocok dengan data sekolah.";
      } else {
        const shown = unmatched.slice(0, 15);
        const more = unmatched.length > shown.length ? " dan " + (unmatched.length - shown.length) + " lainnya" : "";
        p.innerHTML =
          escapeHtml(referensiLine) +
          " <strong>" +
          matchedCount +
          " dari " +
          geojson.features.length +
          " kecamatan di peta cocok dengan data sekolah.</strong> " +
          unmatched.length +
          " belum cocok (nama mungkin berbeda ejaan), sehingga tampil abu-abu di peta: " +
          escapeHtml(shown.join(", ")) +
          escapeHtml(more) +
          ".";
      }

      renderFilters();

      state.map = L.map("peta-map");
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(state.map);

      state.geoLayer = L.geoJSON(geojson, {
        style: () => ({ color: "#ffffff", weight: 1, fillOpacity: 0.6 }),
      }).addTo(state.map);

      restyleLayer();
      state.map.fitBounds(state.geoLayer.getBounds(), { padding: [12, 12] });

      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(
        "Gagal memuat peta: " + err.message + ". Pastikan koneksi internet aktif dan spreadsheet sumber dibagikan sebagai “siapa saja yang memiliki link dapat melihat”.",
        true
      );
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();

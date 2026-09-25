(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const { categorize, escapeHtml, isSMK } = window.Shared;

  const el = (id) => document.getElementById(id);

  const state = {
    schools: [],
    bySchoolKey: new Map(), // "kabkota norm|kecamatan norm" -> [school,...]
    byKabOnly: new Map(), // kabkota norm -> [school,...] (semua kecamatan digabung)
    geoLayer: null,
    map: null,
    labelLayer: null, // layer permanent tooltip (per kabupaten / per kecamatan)
    labelMarkers: [], // [{marker, anchorLatLng}] utk resolveLabelOverlaps()
    indicatorKey: CFG.INDICATORS[0].key,
    kabupatenList: [], // nama asli dari data sekolah
    jenisList: [], // nama asli Jenis Satuan Pendidikan dari data sekolah
    selectedKab: "",
    selectedJenis: "",
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
      .replace(/\s+/g, " ")
      // Samakan semua varian tanda kutip tunggal/apostrof/backtick (mis. "Hu'u"
      // vs "Hu`u") supaya perbedaan karakter Unicode tidak menggagalkan
      // pencocokan nama kecamatan yang sebenarnya sama.
      .replace(/[`´'‘’]/g, "'");
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

  const REFERENSI_CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit

  /** Baca sheet referensi NPSN (data Dapodik) dan bangun peta
   * npsn -> {kabkota, kecamatan} memakai nama acuan resminya, dicoba
   * dari nama tab pertama di CFG.REFERENSI_SHEET_NAMES yang berhasil &
   * punya kolom "npsn". Di-cache di sessionStorage (sheet ini besar,
   * ribuan baris) supaya balik lagi ke halaman peta tidak fetch ulang. */
  async function loadReferensiByNpsn() {
    const cacheKey = "referensi:" + CFG.CONFIG_SHEET_ID;
    const cachedEntries = window.DataCache && window.DataCache.readFresh(cacheKey, REFERENSI_CACHE_TTL_MS);
    if (cachedEntries) return new Map(cachedEntries);

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
      if (window.DataCache) window.DataCache.write(cacheKey, Array.from(map.entries()));
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

  // Warna abu netral yang dicampur ke kecamatan di kabupaten yang TIDAK
  // dipilih, supaya nampak redup (bukan warna asli capaiannya) tanpa
  // membuatnya nyaris tak terlihat di peta.
  const MUTE_GRAY = "#9a988f";
  const MUTE_MIX_RATIO = 0.75; // 0 = warna asli, 1 = abu penuh

  function muteColor(hex) {
    const rgb = hexToRgb(hex);
    const gray = hexToRgb(MUTE_GRAY);
    return rgbToHex(rgb.map((v, i) => lerp(v, gray[i], MUTE_MIX_RATIO)));
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

  /** Hitung statistik label capaian utk 1 indikator dari sekumpulan sekolah.
   * `total`/`baik`/`kurang`/`pctBaik`/`pctKurang` dipakai utk skor warna
   * peta (spt semula, tidak menghitung "Tidak Tersedia"/data kosong).
   * `totalSekolah`/`sedang`/`tidakTersedia` ditambahkan utk tooltip: semua
   * sekolah dihitung, sekolah tanpa label capaian dianggap "Tidak Tersedia". */
  function computeStats(schools, indicatorKey) {
    let total = 0;
    let baik = 0;
    let sedang = 0;
    let kurang = 0;
    let tidakTersedia = 0;
    for (const s of schools) {
      const v = s.indikator[indicatorKey];
      if (!v || !v.label) {
        tidakTersedia++;
        continue;
      }
      const cat = categorize(v.label);
      if (cat.rank === 3) {
        tidakTersedia++;
        continue; // "Tidak Tersedia" — tidak dihitung ke skor warna
      }
      total++;
      if (cat.rank === 0) baik++;
      else if (cat.rank === 1) sedang++;
      else if (cat.rank === 2) kurang++;
    }
    const pctBaik = total ? (100 * baik) / total : null;
    const pctKurang = total ? (100 * kurang) / total : null;
    return { total, baik, sedang, kurang, tidakTersedia, pctBaik, pctKurang, totalSekolah: schools.length };
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

  /** Baris isi tooltip: jumlah sekolah + rincian Baik/Sedang/Kurang/Tidak
   * Tersedia (jumlah & persentase dari jumlah sekolah). */
  function statsRows(stats) {
    const denom = stats.totalSekolah;
    const pct = (n) => (denom ? ((100 * n) / denom).toFixed(1) + "%" : "-");
    return [
      ["Jumlah sekolah", stats.totalSekolah.toLocaleString("id-ID")],
      ["Baik", stats.baik.toLocaleString("id-ID") + " (" + pct(stats.baik) + ")"],
      ["Sedang", stats.sedang.toLocaleString("id-ID") + " (" + pct(stats.sedang) + ")"],
      ["Kurang", stats.kurang.toLocaleString("id-ID") + " (" + pct(stats.kurang) + ")"],
      ["Tidak tersedia", stats.tidakTersedia.toLocaleString("id-ID") + " (" + pct(stats.tidakTersedia) + ")"],
    ];
  }

  /** `maxWidthPx` opsional: batasi lebar tooltip supaya kira-kira tidak
   * lebih lebar dari wilayah yang dilabelinya di layar (mode kabupaten). */
  function labelTooltipHtml(title, stats, maxWidthPx) {
    const styleAttr = maxWidthPx ? " style='max-width:" + Math.round(maxWidthPx) + "px'" : "";
    return (
      "<div class='peta-popup'" +
      styleAttr +
      "><h4>" +
      escapeHtml(title) +
      "</h4><dl>" +
      statsRows(stats)
        .map(([k, v]) => "<dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(v) + "</dd>")
        .join("") +
      "</dl></div>"
    );
  }

  function centroidOfLayer(layer) {
    if (typeof layer.getCenter === "function") {
      try {
        return layer.getCenter();
      } catch (err) {
        // beberapa geometri (mis. multipart) bisa gagal di getCenter(); pakai bounds.
      }
    }
    return layer.getBounds().getCenter();
  }

  function boundsOfKab(kabNorm) {
    const bounds = [];
    state.geoLayer.eachLayer((layer) => {
      if (normKabKota(layer.feature.properties.kab_kota) === kabNorm) {
        bounds.push(layer.getBounds());
      }
    });
    if (!bounds.length) return null;
    let combined = bounds[0];
    for (const b of bounds.slice(1)) combined = combined.extend(b);
    return combined;
  }

  /** Ukuran (lebar/tinggi) sebuah LatLngBounds di layar saat ini, dlm piksel. */
  function pxSizeOfBounds(bounds) {
    const nw = state.map.latLngToLayerPoint(bounds.getNorthWest());
    const se = state.map.latLngToLayerPoint(bounds.getSouthEast());
    return { width: Math.abs(se.x - nw.x), height: Math.abs(se.y - nw.y) };
  }

  function restyleLayer() {
    if (!state.geoLayer) return;
    const selectedKabNorm = state.selectedKab ? normKabKota(state.selectedKab) : null;
    state.geoLayer.eachLayer((layer) => {
      const props = layer.feature.properties;
      let schools = state.bySchoolKey.get(schoolKey(props.kab_kota, props.kecamatan)) || [];
      if (state.selectedJenis) {
        schools = schools.filter((s) => s.jenis === state.selectedJenis);
      }
      const stats = computeStats(schools, state.indicatorKey);
      const style = styleForStats(stats);
      const inSelectedKab = !selectedKabNorm || normKabKota(props.kab_kota) === selectedKabNorm;
      if (!inSelectedKab) {
        style.fillColor = muteColor(style.fillColor);
        style.fillOpacity = Math.min(style.fillOpacity, 0.35);
      }
      layer.setStyle(style);
    });
    rebuildLabels();
  }

  /** Tooltip permanen (tanpa perlu hover):
   * - Belum ada filter kabupaten: satu label per KABUPATEN (agregat semua
   *   kecamatan di dalamnya), ditempatkan DI DALAM wilayah kabupaten itu,
   *   lebar tooltip dibatasi kira-kira sesuai lebar kabupaten di layar.
   * - Filter kabupaten aktif (mis. Mataram): satu label per KECAMATAN di
   *   kabupaten itu, tapi ditempatkan DI LUAR wilayah kabupaten (melingkar
   *   di sekitarnya) dgn garis penghubung tipis ke titik tengah kecamatan
   *   aslinya — supaya kecamatan yang kecil/berdekatan tidak membuat
   *   tooltip-nya saling menumpuk di dalam area yang sempit. */
  function rebuildLabels() {
    if (!state.map || !state.labelLayer) return;
    state.labelLayer.clearLayers();
    state.labelMarkers = [];

    const anchors = [];
    if (!state.selectedKab) {
      for (const kab of state.kabupatenList) {
        const kabNorm = normKabKota(kab);
        let schools = state.byKabOnly.get(kabNorm) || [];
        if (state.selectedJenis) schools = schools.filter((s) => s.jenis === state.selectedJenis);
        const stats = computeStats(schools, state.indicatorKey);
        const kabBounds = boundsOfKab(kabNorm);
        if (!kabBounds) continue;
        const centroid = kabBounds.getCenter();
        const px = pxSizeOfBounds(kabBounds);
        const maxWidthPx = Math.max(70, Math.min(150, px.width * 0.85));
        anchors.push({
          trueLatLng: centroid,
          labelLatLng: centroid,
          hasLine: false,
          html: labelTooltipHtml(kab, stats, maxWidthPx),
        });
      }
    } else {
      const selectedNorm = normKabKota(state.selectedKab);
      const kecItems = [];
      state.geoLayer.eachLayer((layer) => {
        if (normKabKota(layer.feature.properties.kab_kota) === selectedNorm) kecItems.push(layer);
      });
      if (kecItems.length) {
        let kabBounds = kecItems[0].getBounds();
        for (const layer of kecItems.slice(1)) kabBounds = kabBounds.extend(layer.getBounds());
        const centerPx = state.map.latLngToLayerPoint(kabBounds.getCenter());
        const nwPx = state.map.latLngToLayerPoint(kabBounds.getNorthWest());
        const sePx = state.map.latLngToLayerPoint(kabBounds.getSouthEast());
        const halfDiag = Math.hypot(sePx.x - nwPx.x, sePx.y - nwPx.y) / 2;
        // Cukup lewati sedikit tepi kabupaten (bukan jauh melebar), supaya
        // label tetap dekat dgn wilayah yang dipilih.
        const radiusPx = Math.max(halfDiag * 1.02 + 14, 40);

        for (const layer of kecItems) {
          const props = layer.feature.properties;
          let schools = state.bySchoolKey.get(schoolKey(props.kab_kota, props.kecamatan)) || [];
          if (state.selectedJenis) schools = schools.filter((s) => s.jenis === state.selectedJenis);
          const stats = computeStats(schools, state.indicatorKey);
          const trueCentroid = centroidOfLayer(layer);
          const truePx = state.map.latLngToLayerPoint(trueCentroid);
          const angle = Math.atan2(truePx.y - centerPx.y, truePx.x - centerPx.x) || 0;
          const labelPx = centerPx.add(L.point(radiusPx * Math.cos(angle), radiusPx * Math.sin(angle)));
          anchors.push({
            trueLatLng: trueCentroid,
            labelLatLng: state.map.layerPointToLatLng(labelPx),
            hasLine: true,
            html: labelTooltipHtml(props.kecamatan, stats),
          });
        }
      }
    }

    for (const a of anchors) {
      const marker = L.marker(a.labelLatLng, {
        icon: L.divIcon({ className: "peta-label-anchor", iconSize: [0, 0] }),
        interactive: false,
        keyboard: false,
      });
      marker.bindTooltip(a.html, { permanent: true, direction: "center", className: "peta-popup-tooltip" });
      marker.addTo(state.labelLayer);

      let line = null;
      if (a.hasLine) {
        line = L.polyline([a.trueLatLng, a.labelLatLng], {
          color: "#8a8779",
          weight: 1,
          dashArray: "2,3",
          interactive: false,
          className: "peta-leader-line",
        }).addTo(state.labelLayer);
      }

      const item = { marker, anchorLatLng: a.labelLatLng, trueLatLng: a.trueLatLng, line, manuallyMoved: false };
      state.labelMarkers.push(item);
      makeTooltipDraggable(item);
    }

    // Tunggu 2 frame supaya browser selesai layout tooltip (perlu ukuran
    // sebenarnya/offsetWidth-Height) sebelum menghitung tumpang tindih.
    requestAnimationFrame(() => requestAnimationFrame(resolveLabelOverlaps));
  }

  /** Biarkan pengguna menggeser (drag) posisi tooltip secara manual dgn
   * mouse/jari, kalau posisi otomatisnya masih kurang pas. Garis
   * penghubung (mode kecamatan) ikut mengikuti. Posisi manual ini
   * dipertahankan lintas pan/zoom, tapi direset kalau filter kabupaten/
   * jenis/indikator diganti (karena semua label dibangun ulang). */
  function makeTooltipDraggable(item) {
    const tooltip = item.marker.getTooltip();
    const elm = tooltip && tooltip.getElement();
    if (!elm) return;

    let dragging = false;
    let startClientX = 0;
    let startClientY = 0;
    let startLayerPoint = null;

    function pointFromEvent(evt) {
      const t = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
      return { x: t.clientX, y: t.clientY };
    }

    function onMove(evt) {
      if (!dragging) return;
      evt.preventDefault();
      const p = pointFromEvent(evt);
      const newLayerPoint = startLayerPoint.add(L.point(p.x - startClientX, p.y - startClientY));
      const newLatLng = state.map.layerPointToLatLng(newLayerPoint);
      item.marker.setLatLng(newLatLng);
      if (item.line) item.line.setLatLngs([item.trueLatLng, newLatLng]);
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      item.manuallyMoved = true;
      elm.classList.remove("peta-dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    }

    function onStart(evt) {
      dragging = true;
      elm.classList.add("peta-dragging");
      const p = pointFromEvent(evt);
      startClientX = p.x;
      startClientY = p.y;
      startLayerPoint = state.map.latLngToLayerPoint(item.marker.getLatLng());
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      evt.preventDefault();
      evt.stopPropagation(); // jangan sampai memicu drag peta di baliknya
    }

    elm.addEventListener("mousedown", onStart);
    elm.addEventListener("touchstart", onStart, { passive: false });
  }

  /** Geser posisi tooltip yang saling tumpang tindih menjauh satu sama
   * lain (simulasi tolak-menolak AABB sederhana di ruang piksel), supaya
   * semua tooltip permanen tetap terbaca meski berdekatan di peta. */
  function resolveLabelOverlaps() {
    const map = state.map;
    if (!map || state.labelMarkers.length < 2) return;

    const items = [];
    for (const { marker, anchorLatLng, trueLatLng, line, manuallyMoved } of state.labelMarkers) {
      // Posisi yang sudah digeser manual oleh pengguna dibiarkan tetap —
      // tidak ikut disusun ulang otomatis (Leaflet tetap menjaga posisi
      // layarnya benar sendiri saat pan/zoom karena sudah berupa latlng).
      if (manuallyMoved) continue;
      const tooltip = marker.getTooltip();
      const elm = tooltip && tooltip.getElement();
      if (!elm) continue;
      items.push({
        marker,
        line,
        trueLatLng,
        anchorPx: map.latLngToLayerPoint(anchorLatLng),
        w: elm.offsetWidth,
        h: elm.offsetHeight,
        dx: 0,
        dy: 0,
      });
    }
    if (items.length < 2) return;

    const PAD = 4;
    const MAX_DISPLACEMENT = 120;
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const A = items[i];
          const B = items[j];
          const ax = A.anchorPx.x + A.dx;
          const ay = A.anchorPx.y + A.dy;
          const bx = B.anchorPx.x + B.dx;
          const by = B.anchorPx.y + B.dy;
          const overlapX = (A.w + B.w) / 2 + PAD - Math.abs(ax - bx);
          const overlapY = (A.h + B.h) / 2 + PAD - Math.abs(ay - by);
          if (overlapX > 0 && overlapY > 0) {
            moved = true;
            if (overlapX < overlapY) {
              const dir = ax <= bx ? -1 : 1;
              const push = (overlapX / 2) * dir;
              A.dx += push;
              B.dx -= push;
            } else {
              const dir = ay <= by ? -1 : 1;
              const push = (overlapY / 2) * dir;
              A.dy += push;
              B.dy -= push;
            }
          }
        }
      }
      for (const it of items) {
        it.dx = Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, it.dx));
        it.dy = Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, it.dy));
      }
      if (!moved) break;
    }

    for (const it of items) {
      if (it.dx !== 0 || it.dy !== 0) {
        const newPoint = it.anchorPx.add(L.point(it.dx, it.dy));
        const newLatLng = map.layerPointToLatLng(newPoint);
        it.marker.setLatLng(newLatLng);
        if (it.line) it.line.setLatLngs([it.trueLatLng, newLatLng]);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Filter UI
  // -----------------------------------------------------------------------

  /** Bangun ulang opsi Indikator Prioritas: indikator `smkOnly` (A.4, D.17)
   * hanya dimunculkan jika filter Jenis Satuan Pendidikan yang sedang
   * dipilih adalah jenjang SMK. Mempertahankan pilihan yang masih valid,
   * jatuh ke indikator pertama yang tersedia jika tidak. */
  function renderIndicatorOptions() {
    const indSelect = el("peta-indikator-select");
    const prevValue = indSelect.value || state.indicatorKey;
    const showSmkOnly = isSMK(state.selectedJenis);
    const available = CFG.INDICATORS.filter((ind) => !ind.smkOnly || showSmkOnly);

    indSelect.innerHTML = "";
    for (const ind of available) {
      const opt = document.createElement("option");
      opt.value = ind.key;
      opt.textContent = ind.label;
      indSelect.appendChild(opt);
    }
    const stillValid = available.some((ind) => ind.key === prevValue);
    state.indicatorKey = stillValid ? prevValue : available[0].key;
    indSelect.value = state.indicatorKey;
  }

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
    });

    const jenisSelect = el("peta-jenis-select");
    for (const jenis of state.jenisList) {
      const opt = document.createElement("option");
      opt.value = jenis;
      opt.textContent = jenis;
      jenisSelect.appendChild(opt);
    }
    jenisSelect.addEventListener("change", () => {
      state.selectedJenis = jenisSelect.value;
      renderIndicatorOptions();
      restyleLayer();
    });

    renderIndicatorOptions();
    const indSelect = el("peta-indikator-select");
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
      const jenisSet = new Set();
      let fromReferensi = 0;
      let fromRapor = 0;
      for (const s of state.schools) {
        const ref = referensiByNpsn.get(String(s.npsn ?? "").trim());
        const kabkota = ref ? ref.kabkota : s.kabkota;
        const kecamatan = ref ? ref.kecamatan : s.kecamatan;
        if (ref) fromReferensi++;
        else fromRapor++;
        if (s.jenis) jenisSet.add(s.jenis);
        if (!kabkota) continue;
        kabSet.add(kabkota);
        const key = schoolKey(kabkota, kecamatan);
        if (!state.bySchoolKey.has(key)) state.bySchoolKey.set(key, []);
        state.bySchoolKey.get(key).push(s);
        const kabOnlyKey = normKabKota(kabkota);
        if (!state.byKabOnly.has(kabOnlyKey)) state.byKabOnly.set(kabOnlyKey, []);
        state.byKabOnly.get(kabOnlyKey).push(s);
      }
      state.kabupatenList = Array.from(kabSet).sort((a, b) => a.localeCompare(b, "id"));
      state.jenisList = Array.from(jenisSet).sort((a, b) => a.localeCompare(b, "id"));

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
      state.labelLayer = L.layerGroup().addTo(state.map);

      // Peta perlu view (center/zoom) valid dulu sebelum menghitung posisi
      // piksel label (rebuildLabels/resolveLabelOverlaps), makanya fitBounds
      // dipanggil sebelum restyleLayer().
      state.map.fitBounds(state.geoLayer.getBounds(), { padding: [12, 12] });
      state.map.on("zoomend moveend resize", resolveLabelOverlaps);

      restyleLayer();

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

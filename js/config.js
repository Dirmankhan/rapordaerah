// Konfigurasi sumber data Dashboard Rapor Pendidikan Daerah.
//
// - CONFIG_SHEET_ID   : spreadsheet "peta indeks" yang berisi nama kolom
//                        identitas/indikator (baris 1) dan lokasi datanya
//                        di spreadsheet sumber (baris 2), format "NamaSheet!A1:B2".
// - SOURCE_SHEET_ID    : spreadsheet sumber mentah (unduhan Rapor Pendidikan)
//                        yang benar-benar berisi data per satuan pendidikan.
//                        Nilai default di bawah adalah file
//                        "RAPOR-PROV.-NUSA-TENGGARA-BARAT-DATA-2025" di Drive.
//
// Saat tahun ajaran/unduhan berganti (mis. data 2026), cukup ganti
// SOURCE_SHEET_ID di bawah ini dengan ID spreadsheet unduhan yang baru,
// selama nama sheet & rentang kolomnya masih sama persis dengan yang
// tercatat di CONFIG_SHEET_ID.
window.DASHBOARD_CONFIG = {
  CONFIG_SHEET_ID: "10FJs2bKhN9QU3bTpzUAf-P0iJkEdGkwjnWO9nhdViYU",
  SOURCE_SHEET_ID: "1ghDSkwNqV1xwMaAUlHGsah7LCTTVnzgB50nlhef70h8",

  // Nama kolom identitas (harus persis sama dengan header di CONFIG_SHEET_ID)
  // dan urutan tampil di tabel.
  IDENTITY_FIELDS: [
    "NPSN",
    "Nama Satuan Pendidikan",
    "Jenis Satuan Pendidikan",
    "Status Satuan Pendidikan",
    "Kabupaten/Kota",
    "Kecamatan",
  ],

  // Kolom identitas yang dijadikan filter (urutan tampil di UI).
  // `multi: true` membuat filter itu jadi multi-pilih (checkbox dropdown);
  // selain itu tetap dropdown pilih-satu seperti biasa.
  FILTER_FIELDS: [
    { field: "Kabupaten/Kota", multi: false },
    { field: "Kecamatan", multi: true },
    { field: "Jenis Satuan Pendidikan", multi: true },
    { field: "Status Satuan Pendidikan", multi: false },
  ],

  // Kolom identitas yang ditampilkan sebagai kolom di tabel detail
  // (terpisah dari FILTER_FIELDS — Jenis & Kecamatan tetap bisa difilter
  // walau tidak ditampilkan sebagai kolom tabel). `key` harus sama dengan
  // properti objek sekolah di app.js (lihat `loadAll`).
  TABLE_COLUMNS: [
    { key: "npsn", label: "NPSN", width: 6 },
    { key: "nama", label: "Nama Satuan Pendidikan", width: 26, truncate: true },
    { key: "status", label: "Status", width: 6 },
    { key: "kabkota", label: "Kab./Kota", width: 10, truncate: true },
  ],

  // Indikator yang ditampilkan di dashboard: key harus sama dengan nama
  // kolom di CONFIG_SHEET_ID, label adalah judul yang tampil di UI.
  // `smkOnly: true` menandai indikator yang hanya relevan untuk jenjang
  // SMK — kolomnya di tabel detail hanya dimunculkan saat ada satuan
  // pendidikan jenjang SMK di antara hasil filter yang sedang tampil.
  INDICATORS: [
    { key: "Literasi", label: "A.1 Kemampuan literasi" },
    { key: "Numerasi", label: "A.2 Kemampuan numerasi" },
    { key: "Karakter", label: "A.3 Karakter" },
    { key: "D.1 Kualitas pembelajaran", label: "D.1 Kualitas pembelajaran" },
    { key: "D.4 Iklim keamanan satuan pendidikan", label: "D.4 Iklim keamanan satuan pendidikan" },
    { key: "D.8 Iklim Kebinekaan", label: "D.8 Iklim Kebinekaan" },
    { key: "A.4 Penyerapan lulusan SMK", label: "A.4 Penyerapan lulusan SMK", smkOnly: true },
    { key: "D.17 Link and match dengan dunia kerja", label: "D.17 Link and match dengan dunia kerja", smkOnly: true },
  ],

  // --- Halaman Indikator SPM per Kabupaten/Kota (spm.html) ---------------
  //
  // Sheet "spm" di CONFIG_SHEET_ID berisi:
  //   Kolom A: No Indikator, B: Nama Indikator,
  //   Kolom C: lokasi sel Label Capaian 2025 (format "NamaSheet!A1"),
  //   Kolom D: lokasi sel Nilai Capaian 2025 (format "NamaSheet!A1"),
  //   Kolom I: nama Kabupaten/Kota, J: judul spreadsheet sumber datanya.
  // Kolom C/D adalah RUJUKAN SEL yang SAMA dipakai untuk seluruh
  // kabupaten/kota (setiap file sumber per kabupaten diasumsikan memakai
  // template baris/kolom yang identik).
  SPM_SHEET_NAME: "spm",

  // Karena sel J hanya berisi JUDUL file (bukan ID/URL), pemetaan judul ->
  // ID spreadsheet Google Sheets harus dijaga manual di sini. Jika ada
  // Kabupaten/Kota baru atau file sumbernya diganti (mis. tahun 2026),
  // tambahkan/perbarui entri di bawah (cari ID lewat Drive, ambil dari
  // bagian ".../d/<ID>/edit" pada URL spreadsheet).
  SPM_SOURCE_BY_TITLE: {
    "RAPOR-KAB-SUMBAWA-BARAT-DATA-2025": "1Ac3MSEGvNAvkNt6LFbhfeDhyNYC_-hIahWazLteqTcs",
    "RAPOR-KAB-LOMBOK-UTARA-DATA-2025": "1MujUwJVORyF9tTmrY2lA2D65co3UUngkOXyhLtQMJd0",
    "RAPOR-KAB-LOMBOK-TENGAH-DATA-2025": "1V9SRN_Ugb7xYecAtskXDwKEVXy_ww8c9AUAHwFM1Q-Y",
    "RAPOR-KAB-LOMBOK-TIMUR-DATA-2025": "1WJjqnyOVMvFkhW2w40848a7vc3vY-oc2OskjVTNJhWU",
    "RAPOR-KAB-LOMBOK-BARAT-DATA-2025": "1HKJDL-q42kaiQCq2m1aun-XlTBoWpJM1Rk0CRx6m2To",
    "RAPOR-KOTA-MATARAM-DATA-2025": "1-P1F7V7Nt8kq95VCCZ4VXgiklezGvvOjoOidA9vh0NE",
    "RAPOR-KAB-SUMBAWA-DATA-2025": "1s-BR8wFVN-XEKf75l530wEaXvTUDnsP1DqD2tpxyvJM",
    "RAPOR-KAB-DOMPU-DATA-2025": "1oOgdSHJlm5aePfOKEonpa54b3Btd5TV2SVihwF56jUU",
    "RAPOR-KAB-BIMA-DATA-2025": "1BbeJss6ihO6c5Pqtdnin20ZP2ETOQS4A-OmFqMlmTYY",
    "RAPOR-KOTA-BIMA-DATA-2025": "1sjUTXBINeuj9qAMbUzX6xHxBY10Y5AvZ14RtOL5iMd0",
  },
};

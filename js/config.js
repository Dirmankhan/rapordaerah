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
  // Sheet "spm" di CONFIG_SHEET_ID: SATU BARIS PER PASANGAN (kabupaten/kota,
  // indikator), dengan nilai capaiannya sudah langsung berupa data di sheet
  // ini sendiri (bukan rujukan sel ke spreadsheet kabupaten/kota lain lagi):
  //   Kolom "Pemda"              -> nama kabupaten/kota baris ini berlaku;
  //                                 dipakai jg utk isi dropdown filter
  //                                 (diambil otomatis dari nilai unik di
  //                                 kolom ini, urutan kemunculan pertama).
  //   Kolom "No Indikator", "Nama Indikator"
  //   Kolom "Label Capaian 2025" -> nilai label langsung (mis. "Baik"),
  //                                 boleh kosong utk indikator yang memang
  //                                 cuma berupa skor tanpa label (mis.
  //                                 Kemampuan literasi/numerasi).
  //   Kolom "Nilai Capaian 2025" -> nilai angka langsung (mis. "51,36").
  // Boleh belum lengkap: kabupaten/kota yang belum ada barisnya untuk suatu
  // indikator otomatis tampil "-" (Tidak Tersedia) di halaman, bukan error.
  //
  // Nama header dideteksi otomatis (tidak harus di kolom tertentu), asal
  // kata-katanya seperti di atas.
  SPM_SHEET_NAME: "spm",

  // --- Bagian Peta Sebaran Kecamatan (index.html) -------------------------
  //
  // Sheet referensi NPSN (data Dapodik: npsn, kecamatan, kabupaten, dst.)
  // di CONFIG_SHEET_ID, dipakai supaya nama kecamatan/kabupaten yang
  // dicocokkan ke batas wilayah GeoJSON berasal dari data acuan resmi
  // per-NPSN, bukan dari kolom Kecamatan/Kabupaten di data rapor (yang
  // penulisannya kadang tidak konsisten). Dicoba berurutan — dipakai yang
  // pertama ditemukan & punya kolom "npsn".
  REFERENSI_SHEET_NAMES: ["referensi", "Copy of Query result"],
};

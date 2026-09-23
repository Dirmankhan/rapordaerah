# Dashboard Rapor Pendidikan Daerah

Dashboard statis (tanpa server/backend) untuk menjelajahi capaian Rapor
Pendidikan per satuan pendidikan di Provinsi NTB. Data diambil langsung
(live) dari Google Sheets saat halaman dibuka di browser, menggunakan Google
Visualization API (`gviz`) — tidak perlu API key atau proses build apa pun.

## Cara menjalankan

Buka `index.html` langsung di browser, atau serve sebagai situs statis, mis.:

```bash
npx serve .
# atau
python3 -m http.server 8080
```

Lalu buka `http://localhost:8080`.

Untuk deploy publik, cukup unggah folder ini ke GitHub Pages, Netlify, atau
hosting statis apa pun — tidak ada langkah build.

## Sumber data

- **Sheet konfigurasi/peta** (`js/config.js` → `CONFIG_SHEET_ID`):
  https://docs.google.com/spreadsheets/d/10FJs2bKhN9QU3bTpzUAf-P0iJkEdGkwjnWO9nhdViYU
  Berisi daftar nama indikator (baris 1) dan lokasi datanya di spreadsheet
  sumber, format `NamaSheet!A1:B2` (baris 2).
- **Spreadsheet sumber** (`js/config.js` → `SOURCE_SHEET_ID`): file unduhan
  resmi Rapor Pendidikan (`RAPOR-PROV.-NUSA-TENGGARA-BARAT-DATA-2025`) yang
  benar-benar berisi data per satuan pendidikan (sheet
  `5. CAPAIAN SATDIK-DASMEN VOKASI`, dll).

Kedua spreadsheet harus tetap dibagikan sebagai **"Siapa saja yang memiliki
link dapat melihat"** agar bisa diakses tanpa login dari browser pengguna
dashboard.

### Memperbarui ke tahun/unduhan data baru

1. Unggah file unduhan Rapor Pendidikan yang baru ke Google Drive, ubah
   sharing-nya menjadi publik ("anyone with the link").
2. Salin ID spreadsheet-nya (bagian setelah `/d/` pada URL) ke
   `SOURCE_SHEET_ID` di `js/config.js`.
3. Jika nama sheet atau rentang kolom pada file baru berbeda, perbarui baris
   ke-2 pada sheet konfigurasi (kolom `B` dst.) agar tetap menunjuk ke sel
   yang benar.

## Fitur

### Halaman "Rapor Satuan Pendidikan" (`index.html`)

- **Filter**: Kabupaten/Kota, Kecamatan (multi-pilih, mengikuti
  Kabupaten/Kota), Jenis Satuan Pendidikan (multi-pilih), Status Satuan
  Pendidikan, serta pencarian NPSN/nama sekolah.
- **Ringkasan indikator**: distribusi Label Capaian untuk A.1 Kemampuan
  literasi, A.2 Kemampuan numerasi, A.3 Karakter, D.1 Kualitas
  pembelajaran, D.4 Iklim keamanan, D.8 Iklim Kebinekaan, dan indikator
  prioritas SMK (A.4, D.17), mengikuti hasil filter yang aktif.
- **Tabel detail**: daftar satuan pendidikan sesuai filter, dengan badge
  warna per indikator; klik baris untuk melihat rincian lengkap (Label
  Capaian, Nilai Capaian, Perubahan dari Tahun 2024, Perubahan Nilai,
  Peringkat di Kab./Kota). Kolom indikator A.4/D.17 (khusus jenjang SMK)
  otomatis muncul/hilang dan dikosongkan untuk satuan pendidikan non-SMK.

### Halaman "Indikator SPM Kab./Kota" (`spm.html`)

Filter dropdown **Kabupaten/Kota**; tabelnya menampilkan No Indikator, Nama
Indikator, Nilai Capaian, dan Label Capaian (2025) untuk kabupaten/kota yang
dipilih. Data diambil langsung dari spreadsheet Rapor Pendidikan
kabupaten/kota itu sendiri (bukan dari sheet konfigurasi), berdasarkan
rujukan sel yang disimpan di tab **`spm`** pada sheet konfigurasi.

**Penting:** rujukan sel Label/Nilai Capaian **berbeda-beda per
kabupaten/kota** — indikator yang sama ("Kemampuan literasi SD" misalnya)
bisa berada di baris yang berbeda di tiap file kabupaten/kota, karena
masing-masing file dibuat terpisah. Karena itu sheet `spm` memakai format
**satu baris per pasangan (indikator, kabupaten/kota)**, bukan satu rujukan
yang dipakai untuk semua:

| No Indikator | Nama Indikator | Wilayah | Label Capaian 2025 | Nilai Capaian 2025 |
|---|---|---|---|---|
| A.1.skor | Kemampuan literasi SD | Kabupaten Sumbawa Barat | `2. CAPAIAN KABKOT!E3625` | `2. CAPAIAN KABKOT!F3625` |
| A.1.skor | Kemampuan literasi SD | Kabupaten Lombok Utara | `2. CAPAIAN KABKOT!E1198` | `2. CAPAIAN KABKOT!F1198` |
| … | … | … | … | … |

- Kolom **Wilayah** harus berisi nama kabupaten/kota persis sama dengan
  nama di daftar kabupaten/kota (lihat di bawah).
  isi rujukan selnya dengan cara membuka spreadsheet kabupaten/kota
  tersebut, cari baris indikatornya di sheet `2. CAPAIAN KABKOT`, lalu
  salin referensi sel Label Capaian 2025 dan Nilai Capaian 2025-nya
  (format `NamaSheet!A1`).
- Belum sempat isi semua kabupaten/kota sekaligus? Tidak apa — baris yang
  belum ada untuk suatu (indikator, kabupaten/kota) otomatis tampil "-" di
  halaman, bukan error. Bisa dicicil.
- Terpisah dari tabel di atas, sheet `spm` juga perlu daftar kabupaten/kota
  (kolom **Kabupaten** + **Sumber data** = judul spreadsheet sumbernya) —
  bagian ini sudah ada dan tidak berubah dari sebelumnya.

Karena kolom "Sumber data" hanya berisi **judul** file (bukan ID), pemetaan
judul → ID spreadsheet disimpan manual di `js/config.js` →
`SPM_SOURCE_BY_TITLE`. Saat ada kabupaten/kota baru atau file sumbernya
berganti, perbarui/tambahkan entrinya di situ (cari ID lewat Drive, bagian
`.../d/<ID>/edit` pada URL).

Data tiap kabupaten/kota diambil sekali saat pertama dipilih di dropdown,
lalu disimpan di memori (tidak diambil ulang saat bolak-balik pilihan dalam
sesi yang sama).

## Struktur berkas

```
index.html         Halaman Rapor Satuan Pendidikan
spm.html            Halaman Indikator SPM per Kabupaten/Kota
css/style.css       Tampilan bersama kedua halaman (mendukung mode gelap otomatis)
js/config.js        ID spreadsheet, daftar indikator, & peta sumber SPM per kabupaten
js/gviz.js          Pembaca Google Sheets via Google Visualization API
js/shared.js        Util bersama: warna kategori, badge chip, escape HTML
js/app.js           Logika halaman Rapor Satuan Pendidikan
js/spm.js           Logika halaman Indikator SPM per Kabupaten/Kota
```

## Catatan teknis

- Nama & urutan kolom setiap blok indikator (Nilai Capaian, Label Capaian,
  Perubahan dari Tahun 2024, Perubahan Nilai, Peringkat di Kab./Kota)
  dideteksi otomatis dari teks header di baris tepat di atas rentang data
  yang tercatat di sheet konfigurasi — bukan diasumsikan berdasarkan urutan
  kolom tetap. Jika header di sheet sumber berubah kata-katanya, sesuaikan
  pola regex pemetaan (`detectIndicatorRoles`) di `js/app.js`.
- Karena keterbatasan jaringan pada lingkungan pengembangan ini, pengambilan
  data langsung dari Google Sheets belum bisa diuji end-to-end di sini —
  domain `docs.google.com` diblokir oleh kebijakan proxy sandbox. Mohon uji
  dengan membuka halaman di browser biasa (lingkungan pengguna tidak
  memiliki batasan ini) setelah deploy.
- `index.html` dan `spm.html` memuat `css/style.css` dan berkas di `js/`
  dengan query `?v=<angka>` supaya browser tidak menampilkan versi lama
  dari cache setelah deploy baru. Saat mengubah salah satu berkas
  tersebut, naikkan angka `?v=` di kedua HTML. Jika dashboard tampak
  belum menampilkan perubahan terbaru meski deploy sudah sukses, coba
  hard refresh (Ctrl/Cmd+Shift+R).
- Beberapa judul file sumber di Drive ternyata memiliki **duplikat** (judul
  sama, ID berbeda, folder berbeda) — mis. `RAPOR-KAB-LOMBOK-UTARA-DATA-2025`
  ada 2 salinan. `SPM_SOURCE_BY_TITLE` di `js/config.js` memilih salinan
  dengan waktu modifikasi terbaru di folder yang tampak aktif dipakai. Jika
  ternyata salah pilih, perbarui ID-nya secara manual.
- Beberapa baris indikator di sheet `spm` (kolom C/D, mis. B.10–D.10 SD)
  saat ini merujuk ke sel yang sama persis (`E2214`/`F2214`), kemungkinan
  salah isi/copy-paste saat sheet dibuat. Ini bukan bug di kode — dashboard
  membaca apa adanya dari sheet. Mohon cek & perbaiki rujukan selnya di
  sheet `spm` bila perlu; halaman akan otomatis menampilkan data yang benar
  begitu diperbaiki.

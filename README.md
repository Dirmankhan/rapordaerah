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

- **Filter**: Kabupaten/Kota, Jenis Satuan Pendidikan, Status Satuan
  Pendidikan, serta pencarian NPSN/nama sekolah.
- **Ringkasan indikator**: distribusi Label Capaian untuk A.1 Kemampuan
  literasi, A.2 Kemampuan numerasi, A.3 Karakter, dan D.1 Kualitas
  pembelajaran, mengikuti hasil filter yang aktif.
- **Tabel detail**: daftar satuan pendidikan sesuai filter, dengan badge
  warna per indikator; klik baris untuk melihat rincian lengkap (Label
  Capaian, Nilai Capaian, Perubahan dari Tahun 2024, Perubahan Nilai,
  Peringkat di Kab./Kota).

## Struktur berkas

```
index.html        Struktur halaman
css/style.css      Tampilan (mendukung mode gelap otomatis)
js/config.js       ID spreadsheet & daftar indikator yang ditampilkan
js/gviz.js         Pembaca Google Sheets via Google Visualization API
js/app.js          Logika pengambilan data, filter, dan render dashboard
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
- `index.html` memuat `css/style.css` dan berkas di `js/` dengan query
  `?v=<angka>` supaya browser tidak menampilkan versi lama dari cache
  setelah deploy baru. Saat mengubah salah satu berkas tersebut, naikkan
  angka `?v=` di `index.html` (mis. dari `?v=2` ke `?v=3`). Jika dashboard
  tampak belum menampilkan perubahan terbaru
  meski deploy sudah sukses, coba hard refresh (Ctrl/Cmd+Shift+R).

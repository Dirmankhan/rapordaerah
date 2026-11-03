// Halaman login.html: cocokkan username/password yang diketik ke sheet
// "user" (CFG.USER_SHEET_NAME di CFG.CONFIG_SHEET_ID) lewat Gviz, lalu
// simpan status login ke sessionStorage (lihat js/auth.js). Header
// "user"/"password" dicari dari isi selnya (bukan indeks kolom tetap),
// konsisten dgn pola pembacaan sheet lain di situs ini.
(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const KEY = window.Auth.KEY;

  const form = document.getElementById("login-form");
  const userInput = document.getElementById("login-user");
  const passInput = document.getElementById("login-pass");
  const errorBox = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");

  /** Cuma izinkan nama file .html relatif di situs ini sendiri sbg tujuan
   * redirect setelah login — cegah parameter "next" dipakai utk open
   * redirect ke URL asing. */
  function safeNextUrl() {
    const next = new URLSearchParams(location.search).get("next") || "";
    const valid = /^[a-zA-Z0-9_.-]+\.html(\?[^\s]*)?$/.test(next) && !next.startsWith("login.html");
    return valid ? next : "index.html";
  }

  // Sudah login (mis. buka lagi login.html lewat tombol back) -> langsung
  // lempar ke halaman tujuan, tidak perlu login ulang.
  if (window.Auth.isLoggedIn()) {
    location.replace(safeNextUrl());
    return;
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Memeriksa...";

    try {
      const rows = await Gviz.fetchSheetRaw(CFG.CONFIG_SHEET_ID, CFG.USER_SHEET_NAME);

      let headerRowIdx = -1;
      let userCol = -1;
      let passCol = -1;
      for (let r = 0; r < rows.length && headerRowIdx === -1; r++) {
        const row = rows[r] || [];
        for (let c = 0; c < row.length; c++) {
          const t = String(row[c] || "").trim().toLowerCase();
          if (t === "user" || t === "username") userCol = c;
          if (t === "password") passCol = c;
        }
        if (userCol !== -1 && passCol !== -1) headerRowIdx = r;
      }
      if (headerRowIdx === -1) {
        throw new Error('Header "user"/"password" tidak ditemukan di sheet "' + CFG.USER_SHEET_NAME + '"');
      }

      const inputUser = userInput.value.trim();
      const inputPass = passInput.value;
      let matched = false;
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const u = String(row[userCol] || "").trim();
        if (!u) continue;
        const p = String(row[passCol] || "");
        if (u.toLowerCase() === inputUser.toLowerCase() && p === inputPass) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        showError("Username atau password salah.");
        return;
      }

      try {
        sessionStorage.setItem(KEY, inputUser);
      } catch (e) {
        // diamkan - kalau sessionStorage diblokir, auth.js sudah menganggap
        // semua orang "login" (lihat isLoggedIn), jadi tetap bisa lanjut.
      }
      location.href = safeNextUrl();
    } catch (err) {
      console.error(err);
      showError("Gagal memeriksa login: " + err.message + ". Pastikan koneksi internet aktif.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Masuk";
    }
  });
})();

// Gerbang login dashboard ini. PENTING: situs ini statis (GitHub Pages,
// tanpa server), jadi ini CUMA mencegah akses tidak sengaja — BUKAN
// proteksi data sungguhan. Siapa pun yang melihat source halaman ini atau
// sheet "user" (lihat js/login.js) tetap langsung bisa melihat kredensialnya.
//
// Status login disimpan di sessionStorage (per tab, bukan per pengguna) —
// otomatis "keluar" lagi begitu tab/browser ditutup. Script ini HARUS jadi
// <script> PERTAMA di <head> setiap halaman terproteksi (sebelum
// stylesheet/script lain), supaya redirect ke login.html terjadi sebelum
// isi halaman sempat ter-render.
(function () {
  "use strict";

  const KEY = "raporDaerahAuthUser";

  function isLoggedIn() {
    try {
      return !!sessionStorage.getItem(KEY);
    } catch (e) {
      // sessionStorage diblokir (mis. mode privat ketat) - jangan sampai
      // dashboard jadi sama sekali tidak bisa diakses gara-gara ini.
      return true;
    }
  }

  function logout() {
    try {
      sessionStorage.removeItem(KEY);
    } catch (e) {
      // diamkan
    }
    location.href = "login.html";
  }

  const here = location.pathname.split("/").pop() || "index.html";
  const isLoginPage = here === "login.html";

  // login.html juga memuat script ini (utk window.Auth.KEY/logout), tapi
  // TIDAK boleh ikut kena redirect-guard di bawah — kalau tidak, halaman
  // login sendiri jadi loop redirect ke dirinya sendiri terus-menerus.
  if (!isLoginPage && !isLoggedIn()) {
    location.replace("login.html?next=" + encodeURIComponent(here + location.search));
  } else if (!isLoginPage) {
    document.addEventListener("DOMContentLoaded", function () {
      const btn = document.getElementById("logout-btn");
      if (btn) btn.addEventListener("click", logout);
    });
  }

  window.Auth = { KEY, isLoggedIn, logout };
})();

# Implementation Plan
# Claim Clarify — Chrome Extension

| | |
|---|---|
| **Versi** | 1.0 (Draft) |
| **Tanggal** | 5 Juli 2026 |
| **Rujukan** | `PRD.md`, `claim-clarify-wireframe.jsx`, `AGENTS.md` |

---

## 1. Pendekatan

Dibangun bertahap: mulai dari **MVP sekecil mungkin yang sudah bisa divalidasi oleh dokter casemix/verifikator sungguhan**, baru fitur-fitur pendukung (readmisi, template, import/export, audit UI) ditambahkan sebagai fast-follow. Ini supaya feedback dari pengguna nyata didapat lebih awal, sebelum waktu dihabiskan untuk fitur yang mungkin perlu diubah arahnya.

Estimasi waktu di bawah **mengasumsikan 1 developer full-time** mengerjakan sisi ekstensi, dengan 1 dokter casemix/verifikator sebagai domain reviewer yang bisa dimintai waktu paruh-waktu untuk mengecek akurasi output AI dan menyediakan dokumen regulasi. Sesuaikan kembali kalau komposisi tim berbeda — angka ini untuk sequencing, bukan komitmen tenggat.

## 2. MVP vs Full V1

### MVP (validasi awal)
- Workflow 1 (Klaim Standar) saja — belum readmisi, belum template kustom.
- Input dokumen: **upload file saja** (link & tab aktif menyusul).
- Settings AI (BYOK): Anthropic + OpenAI-compatible, test connection.
- Knowledge base: upload manual saja, **belum ada fallback pencarian internet**.
- Output 2 bagian + copy 1-klik.
- Audit log versi minimal (dicatat ke storage, belum ada tampilan riwayat).

### Full V1 (siap dipakai harian)
Semua di atas, ditambah: Workflow 2 (Readmisi), Workflow 3 (Template Kustom), input via link & tab aktif, fallback pencarian internet, manajemen Knowledge Base & Template penuh (termasuk import/export), tab Riwayat/Audit Log, dan hardening untuk submit ke Chrome Web Store.

---

## 3. Fase & Milestone

### Fase 0 — Setup & Fondasi
**Estimasi:** 3–5 hari

- Scaffold repo sesuai struktur di `AGENTS.md` (Vite + `@crxjs/vite-plugin` + React + TypeScript + Tailwind).
- `manifest.json` dasar dengan permission `sidePanel`, side panel kosong bisa dibuka dari toolbar.
- Setup linting/formatting (ESLint + Prettier), unit test runner (Vitest), E2E runner (Playwright, load-unpacked extension).
- Buat `src/theme.ts` — pindahkan token warna & tipografi dari `claim-clarify-wireframe.jsx` supaya jadi satu sumber kebenaran.
- Bangun ulang shell statis (header, switch Home/Settings, `StepDots`, `PanelButton`, dst.) mengikuti wireframe secara visual, sebelum logika ditambahkan.

**Selesai jika:** ekstensi bisa di-load unpacked di Chrome, side panel terbuka, shell UI cocok visual dengan wireframe, belum ada fungsi nyata.

---

### Fase 1 — Workflow 1 (MVP inti)
**Estimasi:** 2–3 minggu
**FR terkait:** FR-01, FR-03, FR-05, FR-06, FR-07, FR-08, FR-09

- `lib/pdf/parse.ts` — ekstraksi teks dari file upload (`pdfjs-dist`).
- `lib/ai/provider.ts` + `anthropic.ts` + `openaiCompatible.ts` — abstraksi provider, dites lewat tab Settings → AI (form provider/endpoint/model/API key + tombol Test Connection).
- `lib/storage/local.ts` — wrapper `chrome.storage.local` untuk config AI.
- Knowledge base versi paling sederhana: dokumen yang diupload disimpan (IndexedDB), dan seluruh isinya disertakan sebagai konteks ke prompt (belum perlu retrieval canggih di tahap ini).
- Alur: pilih Workflow 1 → upload PDF → proses → pertanyaan konfirmasi → jawaban user → panggil AI → render output 2 bagian → copy-to-clipboard.
- **Prompt engineering** untuk memastikan "Jawaban Pending" selalu satu paragraf, tanpa poin, tone profesional — termasuk validasi/format-check sederhana pada respons AI sebelum ditampilkan (mis. tolak/retry kalau hasil mengandung bullet list).
- Audit log minimal: setiap kasus diproses → satu entri tersimpan di `chrome.storage.local` (timestamp, workflow, ringkasan singkat) — belum ada UI riwayat.

**Selesai jika:** dokter casemix bisa upload 1 rekam medis PDF sungguhan, jawab pertanyaan konfirmasi, dan mendapat jawaban pending yang bisa disalin — end-to-end, dengan API key mereka sendiri.

👉 **Titik validasi dengan pengguna nyata** disarankan di sini, sebelum lanjut ke fase berikutnya.

---

### Fase 2 — Fallback Pencarian Internet + Workflow 2 (Readmisi)
**Estimasi:** 1.5–2 minggu
**FR terkait:** FR-10, FR-11, FR-15

- `lib/knowledge/retrieve.ts` — logika local-first: cek knowledge base lokal dulu; kalau tidak ada yang relevan, baru trigger pencarian internet (dengan sitasi sumber).
- Input file jamak untuk Workflow 2 + validasi UI **wajib ≥2 file** sebelum tombol "Proses Dokumen" aktif.
- Heuristik deteksi readmisi otomatis: bandingkan identitas pasien, rentang tanggal, dan diagnosis antar dokumen yang diunggah.
- Prompt construction lintas-episode untuk Workflow 2.
- Tambahkan input via **link** (fetch + parse) sebagai pelengkap upload.

**Selesai jika:** upload 2 dokumen rawat inap dengan pasien & diagnosis sama otomatis terdeteksi sebagai readmisi, dan jawaban yang dihasilkan membandingkan kedua episode.

---

### Fase 3 — Workflow 3 (Template Kustom)
**Estimasi:** 1–1.5 minggu
**FR terkait:** FR-12, FR-13

- Tab Settings → Template: CRUD kata kunci + instruksi format output.
- Logika pencocokan kata kunci terhadap jawaban user di pertanyaan konfirmasi.
- Prompt construction yang mengikuti instruksi template, bukan format default.
- Penanganan saat kata kunci tidak cocok template manapun → tampilkan pilihan ke user (lanjut format standar / buat template baru), sesuai PRD §5.4 langkah 5.
- Tambahkan input via **tab aktif** (baca PDF yang sedang terbuka di tab Chrome) — ditaruh di fase ini karena butuh waktu riset lebih untuk kompatibilitas dengan PDF viewer bawaan Chrome.

**Selesai jika:** ketik kata kunci seperti "Tifoid" langsung menghasilkan jawaban mengikuti format template tersimpan, dan kasus tanpa kata kunci cocok memberi pilihan yang jelas ke user.

---

### Fase 4 — Import/Export, Riwayat & Audit Log Penuh
**Estimasi:** ~1 minggu
**FR terkait:** FR-14, FR-16, FR-17, FR-18, FR-19

- Manajemen Knowledge Base penuh: upload/hapus PDF & spreadsheet, daftar tautan referensi.
- Import/Export untuk Knowledge Base & Template (tentukan format file konkret — `.json` untuk template, `.zip` berisi manifest + file asli untuk knowledge base — lihat Open Question #1 di PRD).
- Tab Riwayat: daftar kasus yang pernah diproses, pencarian, detail per kasus.
- Sitasi sumber regulasi ditampilkan di layar output (FR-17), bukan cuma dicatat di log.

**Selesai jika:** knowledge base & template bisa diekspor dari satu profil Chrome dan diimpor di profil lain; tab Riwayat menampilkan seluruh kasus yang sudah diproses sejak MVP.

---

### Fase 5 — Hardening, QA & Persiapan Rilis
**Estimasi:** 1.5–2 minggu

- E2E test Playwright untuk ketiga workflow end-to-end.
- Uji kasus tepi: API key salah, PDF hasil scan tanpa layer teks (fallback paste manual), file korup, koneksi AI timeout.
- Jalankan checklist keamanan & privasi dari `AGENTS.md` §10 secara menyeluruh.
- Siapkan **kebijakan privasi** (wajib untuk listing Chrome Web Store, apalagi menyentuh data kesehatan) dan justifikasi setiap permission di manifest.
- Siapkan aset listing: ikon, screenshot, deskripsi singkat/panjang.
- Uji coba terbatas (beta) dengan beberapa dokter casemix/verifikator sungguhan, kumpulkan feedback sebelum submit.

**Selesai jika:** ekstensi lolos review internal, kebijakan privasi & listing siap, dan siap disubmit ke Chrome Web Store.

---

## 4. Ringkasan Sequencing

| Fase | Fokus | Estimasi | Kumulatif |
|---|---|---|---|
| 0 | Setup & Fondasi | 3–5 hari | ~1 minggu |
| 1 | Workflow 1 (MVP) | 2–3 minggu | ~3–4 minggu |
| 2 | Fallback Internet + Readmisi | 1.5–2 minggu | ~5–6 minggu |
| 3 | Template Kustom | 1–1.5 minggu | ~6–7.5 minggu |
| 4 | Import/Export + Riwayat | ~1 minggu | ~7.5–8.5 minggu |
| 5 | Hardening & Rilis | 1.5–2 minggu | ~9–10.5 minggu |

Total kasar **~9–11 minggu** dari nol sampai siap submit, dengan 1 developer full-time. MVP di akhir Fase 1 (~3–4 minggu) sudah bisa dipakai/divalidasi meski belum lengkap.

---

## 5. Risiko Implementasi & Mitigasi

| Risiko | Fase Terdampak | Mitigasi |
|---|---|---|
| AI tidak konsisten mengikuti format "1 paragraf tanpa poin" | 1, 3 | Prompt yang eksplisit + validasi/retry otomatis sebelum ditampilkan ke user. |
| Akses ke PDF yang sedang tampil di PDF viewer bawaan Chrome ternyata terbatas/berbeda per versi Chrome | 3 | Riset spike di awal Fase 3; siapkan fallback ke upload manual bila akses tab aktif tidak stabil. |
| Heuristik deteksi readmisi salah kasus (false positive/negative) | 2 | Selalu tampilkan hasil deteksi ke user untuk konfirmasi sebelum lanjut, jangan auto-proses tanpa review. |
| Retrieval knowledge base versi awal (Fase 1) terlalu naif (kirim semua dokumen ke prompt) tidak scalable untuk knowledge base besar | 1→2 | Cukup untuk MVP dengan sedikit dokumen; jadikan technical debt yang dicatat, ditingkatkan ke retrieval berbasis relevansi (embedding/keyword ranking) begitu jumlah dokumen bertambah. |
| Kebijakan privasi & permission Chrome Web Store menghambat proses review store | 5 | Siapkan draf kebijakan privasi & justifikasi permission sejak Fase 0, jangan ditunda ke akhir. |

---

## 6. Roadmap Pasca-Rilis

Mengikuti bagian Roadmap di `PRD.md`, disarankan urutan berikut setelah V1 stabil:

1. Ekspor jawaban ke Word/PDF (surat sanggahan siap kirim).
2. Retrieval knowledge base yang lebih baik (embedding-based) begitu volume dokumen bertambah.
3. Dukungan model AI lokal/self-hosted.
4. Kolaborasi tim (knowledge base & template dibagikan antar pengguna dalam satu institusi) — ini akan mengubah asumsi "per akun/perangkat" di PRD, jadi perlu keputusan produk baru sebelum dikerjakan.
5. Dukungan browser lain (Edge, Firefox).

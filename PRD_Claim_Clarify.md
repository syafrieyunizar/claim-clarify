# Product Requirements Document (PRD)
# Claim Clarify — Chrome Extension

| | |
|---|---|
| **Versi** | 1.0 (Draft) |
| **Tanggal** | 4 Juli 2026 |
| **Status** | Draft untuk Review |
| **Platform** | Google Chrome Extension (Side Panel, Manifest V3) |

---

## 1. Ringkasan Eksekutif

Claim Clarify adalah ekstensi Google Chrome berbentuk **side panel** yang membantu Dokter Casemix dan Verifikator JKN menyusun jawaban sanggahan/klarifikasi atas klaim pending BPJS secara cepat, konsisten, dan sesuai regulasi terbaru. Ekstensi ini membaca rekam medis pasien (PDF), menggunakan AI (dengan skema BYOK — Bring Your Own Key) untuk menganalisis kasus terhadap basis pengetahuan regulasi BPJS, lalu menghasilkan narasi pembelaan klaim yang siap disalin dan diunggah ke sistem BPJS (Vidi/E-Klaim/Aplicares, dsb).

## 2. Latar Belakang & Masalah

Proses menjawab pending klaim BPJS saat ini umumnya dilakukan manual oleh dokter casemix/verifikator dengan cara membaca ulang rekam medis, mencari rujukan regulasi (Permenkes, Perdirjampelkes, KMK, Juknis INA-CBG, dsb.) secara manual, lalu menulis jawaban sendiri. Tantangan yang muncul:

- **Waktu terbatas** — jumlah kasus pending tinggi, sementara tenggat respons ke BPJS terbatas.
- **Regulasi sering berubah** — sulit memastikan jawaban selalu merujuk aturan terbaru.
- **Inkonsistensi format & tone** — jawaban antar staf/dokter bisa berbeda gaya dan kualitas argumentasi.
- **Kasus kompleks seperti readmisi** — butuh analisis silang antar episode rawat yang lebih memakan waktu.
- **Kebutuhan personalisasi** — sebagian rumah sakit/verifikator punya format jawaban standar sendiri yang harus diikuti.

## 3. Tujuan Produk (Goals)

1. Mempercepat waktu penyusunan jawaban pending klaim BPJS.
2. Meningkatkan konsistensi dan kualitas argumentasi berdasarkan regulasi terbaru.
3. Memberikan fleksibilitas penuh pemilihan model AI (BYOK) sehingga biaya dan kontrol data ada di tangan pengguna/institusi.
4. Menyediakan alur kerja khusus untuk kasus readmisi yang membutuhkan analisis dua episode perawatan atau lebih.
5. Memungkinkan output disesuaikan dengan template/gaya masing-masing pengguna atau institusi.

### Non-Goals (Di Luar Lingkup)

- Tidak menggantikan keputusan final dokter casemix/verifikator — AI hanya membantu menyusun draf jawaban.
- Tidak melakukan submit otomatis ke sistem BPJS (Vidi/E-Klaim) pada versi awal.
- Tidak menyediakan API key/model AI bawaan — sepenuhnya BYOK.
- Tidak berfungsi sebagai rekam medis elektronik (RME); hanya membaca dokumen yang sudah ada.

## 4. Target Pengguna

| Persona | Kebutuhan Utama |
|---|---|
| **Dokter Casemix** | Menyusun argumen medis-klinis untuk membela klaim, cepat dan akurat sesuai koding & regulasi. |
| **Verifikator JKN (Rumah Sakit)** | Menjawab pending dari BPJS dengan narasi yang terstruktur, siap diunggah, sesuai format institusi. |

## 5. Ruang Lingkup Fitur

### 5.1 Basis Pengetahuan (Knowledge Base)

Sumber pengetahuan yang digunakan AI untuk menyusun jawaban:

- **File PDF** — regulasi (Permenkes, Perdirjampelkes, Juknis INA-CBG, SE, dsb.) yang diunggah pengguna.
- **Spreadsheet** — misalnya daftar kode ICD-10/ICD-9-CM, tarif INA-CBG, atau catatan kebijakan internal rumah sakit.
- **Internet** — pencarian daring untuk regulasi terbaru yang belum ada di knowledge base lokal (dengan sitasi sumber).

**Prioritas sumber:** dokumen yang diunggah manual (PDF/spreadsheet) adalah rujukan **utama** dan paling sering dipakai. Pencarian internet hanya dijalankan sebagai **fallback**, yaitu ketika regulasi yang relevan tidak ditemukan di knowledge base lokal.

Pengguna dapat menambah, memperbarui, atau menghapus dokumen knowledge base melalui tab **Settings**.

### 5.2 Workflow 1 — Jawaban Pending Klaim (Standar)

**Tujuan:** Alur utama untuk menjawab satu kasus pending klaim.

1. Pengguna membuka side panel, memilih sumber rekam medis: **link**, **upload file PDF**, atau **tab yang sedang terbuka** (ekstensi membaca PDF yang sedang tampil di tab aktif).
2. Ekstensi mem-parsing PDF menggunakan PDF parser bawaan, mengekstrak teks & struktur rekam medis.
3. Sistem AI (sesuai konfigurasi BYOK pengguna) menganalisis dokumen, lalu menampilkan pertanyaan konfirmasi:
   *"Dari BPJS kenapa mempending kasus ini?"*
4. Pengguna menjawab (mengetik alasan pending, bebas teks).
5. AI menyusun jawaban klaim dengan merujuk pada knowledge base (PDF/spreadsheet/internet) dan konteks rekam medis.
6. Output ditampilkan dalam **2 bagian**:
   - **Bagian 1 — Ringkasan Kasus:** penjelasan singkat kasus terkait dasar pembelaan klaim.
   - **Bagian 2 — Jawaban Pending:** narasi resmi (1 paragraf, tanpa poin, tone profesional & terstruktur) yang dapat **disalin dengan satu klik** (tombol copy-to-clipboard).

### 5.3 Workflow 2 — Kasus Readmisi

**Tujuan:** Varian khusus untuk kasus readmisi yang membutuhkan dua episode rawat atau lebih.

1. Alur serupa Workflow 1, namun pengguna **wajib mengunggah minimal 2 file** (dokumen rawat pertama dan rawat kedua/berikutnya). Sistem memvalidasi jumlah file minimum sebelum melanjutkan.
2. AI secara otomatis mendeteksi bahwa kasus ini adalah readmisi berdasarkan kesamaan identitas pasien, rentang tanggal, dan diagnosis pada dokumen yang diunggah — tanpa perlu dipilih manual oleh pengguna.
3. AI membandingkan kedua (atau lebih) episode perawatan terhadap ketentuan readmisi pada regulasi BPJS terbaru (mis. jangka waktu, kesamaan diagnosis, rencana tindak lanjut/kontrol yang telah dijadwalkan, dsb.).
4. AI menyusun jawaban klaim berdasarkan knowledge base, dengan mempertimbangkan kronologi lintas episode.
5. Output tetap ditampilkan dalam 2 bagian yang sama seperti Workflow 1 (Ringkasan Kasus + Jawaban Pending siap salin).

### 5.4 Workflow 3 — Output Sesuai Template Kustom

**Tujuan:** Memungkinkan pengguna mendefinisikan sendiri format/gaya jawaban yang diinginkan, lalu memicunya cukup dengan kata kunci.

1. Alur dimulai sama seperti Workflow 1 (baca PDF rekam medis).
2. Pada tab **Settings**, pengguna sebelumnya telah membuat satu atau beberapa **template**, masing-masing terdiri dari:
   - **Kata kunci pemicu** (mis. "Tifoid").
   - **Instruksi/format output** yang diinginkan untuk kata kunci tersebut (mis. poin-poin klinis wajib disebut, struktur kalimat, penekanan regulasi tertentu, dsb.).
3. Saat sistem menampilkan pertanyaan *"Dari BPJS kenapa mempending kasus ini?"*, pengguna cukup menjawab dengan **kata kunci saja** (mis. "Tifoid").
4. AI mencocokkan kata kunci dengan template yang tersimpan, membaca kasus dari rekam medis, dan menyusun jawaban mengikuti format/instruksi template tersebut — bukan format default Workflow 1.
5. Jika kata kunci tidak cocok dengan template manapun, sistem memberi opsi kepada pengguna untuk melanjutkan dengan alur standar (Workflow 1) atau mendefinisikan template baru saat itu juga.

### 5.5 Tab Settings

Pengaturan terpusat, terpisah dari panel percakapan utama:

**a. Konfigurasi AI (BYOK)**
- Pilihan provider: **Anthropic** atau **OpenAI-compatible**.
- Field: Endpoint URL, Model (dropdown/manual input), API Key.
- Tombol "Test Connection" untuk validasi sebelum disimpan.
- Mendukung multi-profil (opsional): pengguna dapat menyimpan lebih dari satu konfigurasi dan berpindah dengan cepat.

**b. Manajemen Knowledge Base**
- Upload/hapus PDF regulasi.
- Upload/hapus spreadsheet (CSV/XLSX).
- Daftar tautan referensi internet yang ingin diprioritaskan (opsional whitelist domain resmi, mis. jkn.kemkes.go.id, bpjs-kesehatan.go.id).
- **Import/Export knowledge base** — pengguna dapat mencadangkan dan memulihkan koleksi lokal. Pengguna yang login dengan akses API admin juga dapat mengajukan knowledge ke library bersama Claim Clarify; item baru digunakan setelah disetujui pemilik melalui panel admin.

**c. Manajemen Template (Workflow 3)**
- CRUD template: kata kunci, deskripsi, instruksi format output.
- Preview hasil format sebelum disimpan.
- **Import/Export template** — memindahkan atau mencadangkan koleksi lokal. Template dapat diajukan ke library bersama Claim Clarify dan baru dibagikan setelah moderasi pemilik.

## 6. Kebutuhan Fungsional (Functional Requirements)

| ID | Fitur | Deskripsi | Prioritas |
|---|---|---|---|
| FR-01 | Side Panel UI | Ekstensi tampil sebagai Chrome Side Panel, dapat dibuka dari toolbar icon. | Wajib |
| FR-02 | Input rekam medis via link | Pengguna memasukkan URL PDF, ekstensi mengunduh & mem-parsing. | Wajib |
| FR-03 | Input rekam medis via upload | Pengguna mengunggah file PDF langsung dari perangkat. | Wajib |
| FR-04 | Input rekam medis via tab aktif | Ekstensi membaca PDF yang sedang terbuka di tab browser saat ini. | Wajib |
| FR-05 | PDF Parser | Ekstraksi teks (dan idealnya tabel) dari PDF, termasuk PDF hasil scan (OCR) bila diperlukan. | Wajib |
| FR-06 | Konfigurasi AI BYOK | Form pengaturan provider, endpoint, model, API key tersimpan aman secara lokal. | Wajib |
| FR-07 | Pertanyaan konfirmasi alasan pending | Sistem menampilkan pertanyaan baku dan menerima jawaban bebas teks dari pengguna. | Wajib |
| FR-08 | Output 2 bagian (Workflow 1 & 2) | Ringkasan kasus + jawaban pending siap salin. | Wajib |
| FR-09 | Copy-to-clipboard 1 klik | Tombol salin pada bagian jawaban pending. | Wajib |
| FR-10 | Validasi minimal 2 file (Workflow 2) | Sistem menolak melanjutkan bila file kurang dari 2 pada mode readmisi. | Wajib |
| FR-11 | Deteksi otomatis kasus readmisi | AI mengenali pola readmisi dari dokumen yang diunggah tanpa pemilihan manual. | Wajib |
| FR-12 | Manajemen template kustom | CRUD template kata kunci → format output (Workflow 3). | Wajib |
| FR-13 | Pencocokan kata kunci ke template | Saat user menjawab dengan kata kunci, sistem memuat template yang sesuai. | Wajib |
| FR-14 | Manajemen knowledge base | Upload/hapus PDF & spreadsheet, kelola daftar sumber. | Wajib |
| FR-15 | Pencarian internet sebagai fallback | AI HANYA mencari regulasi di internet apabila tidak ditemukan di knowledge base lokal (PDF/spreadsheet); knowledge base lokal selalu menjadi rujukan utama. Sumber internet dicantumkan sitasinya. | Wajib |
| FR-16 | Riwayat kasus (history) | Menyimpan riwayat kasus yang pernah diproses untuk dibuka kembali. | Diinginkan |
| FR-17 | Indikator sumber/sitasi regulasi | Jawaban AI menyebutkan dasar regulasi yang dipakai (nama & tahun peraturan). | Diinginkan |
| FR-18 | Log audit (audit trail) | Sistem mencatat jejak setiap kasus yang diproses (waktu, input yang digunakan, jawaban yang dihasilkan) untuk keperluan kepatuhan/audit internal rumah sakit. | Wajib |
| FR-19 | Import/Export Knowledge Base & Template | Pengguna dapat mengekspor dan mengimpor koleksi knowledge base dan template dalam satu file, untuk dipindahkan/dibagikan secara manual antar akun/perangkat. | Wajib |

## 7. Desain Output Jawaban (Format & Tone)

Ketentuan gaya jawaban untuk Workflow 1 dan 2 (default):

- **Tone:** profesional, formal, sesuai gaya korespondensi rumah sakit ke BPJS.
- **Struktur:** narasi utuh, terdiri dari beberapa kalimat dalam **satu paragraf**, **tanpa bullet point**.
- **Bagian 1 (Ringkasan Kasus):** memuat kronologi singkat, diagnosis, dan poin pembelaan yang relevan.
- **Bagian 2 (Jawaban Pending):** kalimat final yang langsung dapat ditempel ke sistem BPJS, merujuk regulasi terkait tanpa perlu diedit ulang oleh pengguna.

Untuk Workflow 3, format ditentukan sepenuhnya oleh instruksi template yang dibuat pengguna, sehingga struktur di atas dapat berbeda sesuai kebutuhan.

## 8. Alur Pengguna (User Flow — Ringkas)

```
Buka Side Panel
      │
      ▼
Pilih Mode: [Standar] [Readmisi] [Template Kustom]
      │
      ▼
Input Rekam Medis (Link / Upload / Tab Aktif)
      │
      ▼
Parsing PDF ──► Analisis AI (Knowledge Base + BYOK)
      │
      ▼
Pertanyaan: "Dari BPJS kenapa mempending kasus ini?"
      │
      ▼
Jawaban User (bebas teks / kata kunci template)
      │
      ▼
AI Menyusun Jawaban
      │
      ▼
Output: [1] Ringkasan Kasus   [2] Jawaban Pending (Copy 1-klik)
```

## 9. Kebutuhan Non-Fungsional

- **Keamanan:** API key disimpan terenkripsi di `chrome.storage.local`, tidak pernah dikirim ke server pihak ketiga selain endpoint AI yang dikonfigurasi pengguna sendiri.
- **Privasi data pasien:** Dokumen rekam medis diproses secara lokal (parsing) sebelum konten teks dikirim ke API AI yang dipilih pengguna; ekstensi tidak menyimpan salinan rekam medis di server milik pengembang ekstensi.
- **Performa:** Untuk versi ini, tidak ada batasan ukuran file yang ditetapkan sistem; waktu pemrosesan mengikuti ukuran aktual file rekam medis yang diunggah (satu file rekam medis) — semakin besar file, semakin lama waktu parsing & pemrosesan AI. Latensi respons AI juga bergantung pada provider yang dipilih pengguna.
- **Kompatibilitas:** Google Chrome versi terbaru dengan dukungan Manifest V3 & Side Panel API.
- **Reliabilitas:** Penanganan error yang jelas (mis. API key tidak valid, PDF gagal dibaca, file kurang dari syarat minimum pada Workflow 2).
- **Auditability (Wajib):** Setiap kasus yang diproses harus tercatat dalam log audit (lihat FR-18), mencakup input yang digunakan, jawaban yang dihasilkan, dan sumber regulasi yang menjadi dasar (lihat FR-17), untuk keperluan kepatuhan internal rumah sakit.

## 10. Kebutuhan Teknis (Gambaran Implementasi)

- **Platform:** Chrome Extension Manifest V3, dengan `sidePanel` API sebagai antarmuka utama.
- **Permission yang dibutuhkan:** `sidePanel`, `storage`, `activeTab`, `scripting`, `downloads` (opsional untuk ekspor), host permissions sesuai kebutuhan pembacaan tab/link PDF.
- **PDF Parser:** library berbasis JavaScript (mis. pdf.js) untuk ekstraksi teks; opsional modul OCR untuk PDF hasil scan.
- **Integrasi AI:** panggilan HTTP langsung ke endpoint yang dikonfigurasi (Anthropic Messages API atau endpoint kompatibel OpenAI Chat Completions), tanpa perantara server milik pengembang ekstensi (arsitektur client-side agar API key tidak melewati pihak ketiga).
- **Penyimpanan lokal:** `chrome.storage.local` untuk pengaturan, template, dan knowledge base ringan; opsional IndexedDB untuk knowledge base berukuran besar.
- **Pencarian internet:** modul pencarian web (mis. melalui API pencarian yang dikonfigurasi, atau tool-use bila provider AI mendukung) untuk fallback regulasi terbaru.

## 11. Metrik Keberhasilan (KPI)

- Rata-rata waktu penyusunan jawaban pending per kasus (target: berkurang signifikan dibanding proses manual).
- Tingkat penggunaan ulang (retention) mingguan/bulanan oleh dokter casemix & verifikator.
- Persentase jawaban yang digunakan tanpa revisi manual signifikan.
- Jumlah template kustom yang dibuat & dipakai berulang (indikator adopsi Workflow 3).

## 12. Asumsi & Ketergantungan

- Pengguna menyediakan API key sendiri (biaya penggunaan AI ditanggung pengguna/institusi).
- Pengguna bertanggung jawab memastikan knowledge base yang diunggah relevan dan terbaru.
- Knowledge base dan template lokal tetap **per akun/perangkat**. Library bersama Claim Clarify disimpan terpisah di Supabase dan hanya memuat kontribusi berstatus `approved`; rekam medis, identitas, hasil kasus, serta audit kasus tidak masuk library bersama.
- Ekstensi hanya berjalan di Google Chrome (belum mencakup Edge/Firefox pada versi awal).
- Regulasi BPJS terus berubah; mekanisme pembaruan knowledge base (upload manual vs pencarian internet otomatis) menjadi tanggung jawab bersama sistem dan pengguna.

## 13. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| AI menghasilkan jawaban yang tidak akurat/hukum (halusinasi regulasi) | Wajib berbasis knowledge base pengguna (RAG), tampilkan sitasi sumber, dan posisikan output sebagai **draf** yang tetap direview manusia sebelum dikirim. |
| Kebocoran API key | Simpan terenkripsi secara lokal, tidak pernah dikirim ke server pengembang ekstensi. |
| Kegagalan parsing PDF (scan buram, format tidak standar) | Sediakan opsi input teks manual sebagai fallback. |
| Data pasien terkirim ke provider AI pihak ketiga | Beri disclaimer eksplisit saat setup BYOK; anjurkan pengguna memilih provider yang sesuai kebijakan institusi. |
| Kesalahan deteksi otomatis kasus readmisi | Tampilkan hasil deteksi ke pengguna untuk konfirmasi/koreksi sebelum jawaban final disusun. |

## 14. Roadmap Pengembangan Selanjutnya (Di Luar Versi 1.0)

- Ekspor jawaban langsung ke format surat sanggahan (Word/PDF).
- Dukungan model AI lokal (on-device / self-hosted).
- Riwayat & pencarian kasus sebelumnya, termasuk analitik tren jenis pending.
- Kolaborasi tim (knowledge base & template dibagikan antar pengguna dalam satu institusi).
- Dukungan browser lain (Edge, Firefox).

## 15. Decision Log

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Sumber pembaruan regulasi | Unggah manual (PDF/spreadsheet) adalah sumber **utama** dan paling banyak dipakai; pencarian internet hanya **fallback** bila regulasi tidak ditemukan di knowledge base lokal. |
| 2 | Cakupan knowledge base & template | Per akun/perangkat (lokal). Tersedia fitur **import/export** agar dapat dipindahkan/dibagikan secara manual (FR-19). |
| 3 | Kebutuhan log audit | **Diperlukan** — setiap kasus yang diproses dicatat sebagai jejak audit (FR-18). |
| 4 | Batas ukuran file | **Tidak ada batas** yang ditetapkan sistem pada versi ini; waktu proses mengikuti ukuran aktual satu file rekam medis. |

### Pertanyaan Terbuka Tersisa

1. Format file untuk import/export knowledge base & template (mis. `.zip` vs `.json`) — perlu ditentukan pada tahap technical design.
2. Apakah log audit cukup disimpan lokal, atau perlu opsi backup/ekspor agar tidak hilang saat perangkat/profil browser berganti?
3. Apakah diperlukan retention policy (durasi penyimpanan) untuk riwayat kasus (FR-16) dan log audit (FR-18)?

---
*Dokumen ini adalah draf awal PRD dan terbuka untuk direvisi berdasarkan masukan tim produk, dokter casemix, dan verifikator JKN sebagai calon pengguna.*

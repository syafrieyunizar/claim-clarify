# Chrome Web Store Submission - Claim Clarify

## Store listing

**Description**

Claim Clarify adalah asisten side panel untuk Dokter Casemix dan Verifikator JKN dalam menyusun draf jawaban pending klaim BPJS. Pengguna dapat memproses PDF melalui upload, tautan, atau tab aktif; menambahkan alasan pending; lalu menghasilkan jawaban profesional berdasarkan rekam medis, knowledge, dan template yang dipilih.

Sebelum permintaan dikirim ke AI, teks dokumen diproses secara lokal dan identitas yang dikenali, seperti nama pasien, NIK, nomor SEP, nomor rekam medis, nomor kartu, tanggal lahir, alamat, nomor telepon, serta identitas fasilitas kesehatan, disensor. Claim Clarify juga menyediakan analisis readmisi, kritik dan revisi jawaban, serta fitur Timbang Kasus yang membandingkan sudut pandang BPJS dan Dokter Casemix dengan skor peluang sanggah 1-10.

Template, knowledge, draf, pengaturan, dan riwayat kasus disimpan secara lokal. Pengguna yang login dapat melihat library bersama yang telah disetujui admin dan mengajukan knowledge atau template untuk moderasi. Claim Clarify tidak menggantikan penilaian profesional dan hasil AI harus ditinjau sebelum digunakan.

**Category:** Productivity

**Language:** Indonesian - Bahasa Indonesia

## Privacy

**Single purpose description**

Claim Clarify membantu Dokter Casemix dan Verifikator JKN menyusun, merevisi, dan menilai draf jawaban pending klaim BPJS berdasarkan dokumen yang dipilih pengguna, knowledge, dan template, setelah penyensoran identitas dilakukan secara lokal.

**sidePanel justification**

Izin sidePanel digunakan sebagai antarmuka utama extension agar pengguna dapat membaca PDF pada tab utama sambil memproses dokumen, memasukkan alasan pending, dan meninjau hasil Claim Clarify tanpa berpindah halaman.

**storage justification**

Izin storage digunakan untuk menyimpan konfigurasi AI dan API key pribadi di chrome.storage.local, serta menyimpan template, knowledge, draf kasus, preferensi library bersama, dan riwayat hasil pada perangkat pengguna. Data tersebut tidak memakai chrome.storage.sync.

**activeTab justification**

Izin activeTab digunakan hanya setelah tindakan pengguna pada fitur Tab Aktif untuk memperoleh akses sementara ke PDF yang sedang ditampilkan dan memproses teksnya. Extension tidak memantau tab secara terus-menerus.

**tabs justification**

Izin tabs digunakan untuk mengetahui URL tab aktif, memastikan tab tersebut merupakan PDF atau halaman e-Klaim yang dipilih pengguna, mengoordinasikan pemuatan ulang sementara ketika Chrome menyerahkan stream PDF kepada extension, dan mengembalikan tab ke halaman awal e-Klaim selama otomatisasi Re-grouping. Izin ini tidak digunakan untuk mengumpulkan riwayat browsing.

**scripting justification**

Izin scripting digunakan hanya setelah pengguna menekan tombol Re-grouping untuk mengisi SEP dan menekan kontrol proses pada halaman e-Klaim di tab aktif. Eksekusi dibatasi pada tab yang dipilih pengguna, berhenti jika halaman awal e-Klaim tidak dikenali, dan tidak digunakan untuk memantau aktivitas browsing.

**file:///* host justification**

Izin file:///* digunakan untuk membaca PDF lokal yang sedang dibuka dan dipilih pengguna melalui fitur Tab Aktif. Akses hanya bekerja jika pengguna mengaktifkan Allow access to file URLs dan memulai pemrosesan.

**Optional https/http host justification**

Izin host opsional diminta pada saat diperlukan untuk mengunduh PDF dari tautan yang dimasukkan pengguna, menghubungi endpoint AI yang dikonfigurasi pengguna, atau menjalankan Re-grouping pada origin e-Klaim yang sedang aktif. Extension tidak mengakses situs lain secara otomatis.

**Remote code:** No, I am not using remote code.

Semua JavaScript, PDF.js worker, dan dependensi executable disertakan di dalam paket extension. Request ke API AI dan Supabase hanya mengirim serta menerima data; respons tidak dieksekusi sebagai JavaScript atau WebAssembly.

## Data usage checkboxes

Select:

- Personally identifiable information
- Health information
- Authentication information
- Website content

Do not select:

- Financial and payment information
- Personal communications
- Location
- Web history
- User activity

Certify all three Limited Use declarations after confirming the published privacy policy matches the current extension behavior.

## Privacy policy URL

Publish `privacy-policy-claim-clarify.html` at a public HTTPS URL first. A local `file://` address cannot be used in the Chrome Web Store field.

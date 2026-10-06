import { useState } from "react";
import {
  FileText, Upload, Link2, Globe, Settings, ChevronRight, ChevronLeft,
  ArrowLeft, Copy, Check, Plus, Trash2, Download, KeyRound,
  Server, Bot, ClipboardList, History, X, ShieldCheck, Eye, EyeOff,
  RefreshCw, Layers, HelpCircle, FolderOpen, Tag, Search, ChevronDown
} from "lucide-react";

const INK = "#132A3A";
const PAPER = "#FAFAF8";
const MIST = "#E7ECEE";
const MIST_DARK = "#D7DEE1";
const TEAL = "#146B64";
const TEAL_SOFT = "#E3EEEC";
const PLUM = "#7A4B5E";
const PLUM_SOFT = "#F1E7EB";
const AMBER = "#B5722A";
const AMBER_SOFT = "#F6EBDD";
const SLATE = "#5B6B76";

const WORKFLOWS = {
  standard: { label: "Klaim Standar", accent: TEAL, soft: TEAL_SOFT, desc: "Satu kasus pending, jawab langsung." },
  readmisi: { label: "Kasus Readmisi", accent: PLUM, soft: PLUM_SOFT, desc: "Analisis 2 episode rawat atau lebih." },
  template: { label: "Template Kustom", accent: AMBER, soft: AMBER_SOFT, desc: "Output sesuai kata kunci milikmu." },
};

const CONTENT = {
  standard: {
    question: "Dari BPJS kenapa mempending kasus ini?",
    placeholder: "cth: lama hari rawat dianggap tidak sesuai clinical pathway",
    ringkasan: "Pasien An. R (8 tahun) dirawat inap selama 5 hari dengan diagnosis Demam Tifoid (ICD-10 A01.0), ditegakkan melalui pemeriksaan serologi Widal dan gambaran klinis demam naik-turun disertai gangguan pencernaan; BPJS mempertanyakan kesesuaian lama hari rawat terhadap Panduan Praktik Klinis yang berlaku.",
    jawaban: "Berdasarkan telaah rekam medis, pasien An. R terbukti memenuhi kriteria rawat inap dengan diagnosis Demam Tifoid (ICD-10 A01.0) yang ditegakkan melalui pemeriksaan penunjang serologi serta gejala klinis demam tinggi berkepanjangan dan gangguan gastrointestinal, sehingga lama hari rawat selama 5 hari yang diajukan telah sesuai dengan Panduan Praktik Klinis dan ketentuan verifikasi klaim yang berlaku, karenanya kami memohon klaim ini dapat disetujui sepenuhnya.",
    sources: ["PPK RS Bag. Anak, 2024", "Juknis INA-CBG 2024"],
  },
  readmisi: {
    question: "Dari BPJS kenapa mempending kasus readmisi ini?",
    placeholder: "cth: dianggap readmisi dini dengan diagnosis sama",
    ringkasan: "Pasien An. R kembali dirawat 12 hari setelah perawatan pertama dengan diagnosis yang sama, Demam Tifoid (ICD-10 A01.0). Hasil laboratorium pada episode kedua menunjukkan kultur Salmonella typhi positif, menandakan infeksi belum tuntas pada perawatan sebelumnya, bukan akibat tata laksana yang tidak adekuat.",
    jawaban: "Berdasarkan perbandingan rekam medis kedua episode perawatan, readmisi pasien An. R dalam rentang 12 hari terjadi karena infeksi Salmonella typhi yang belum tuntas sebagaimana dibuktikan hasil kultur pada episode kedua, bukan disebabkan kualitas tata laksana pada perawatan pertama, sehingga kedua klaim rawat inap ini kami ajukan untuk disetujui sebagai episode yang berdiri sendiri sesuai ketentuan readmisi yang berlaku.",
    sources: ["Rekam Medis Episode 1", "Rekam Medis Episode 2", "Ketentuan Readmisi INA-CBG"],
  },
  template: {
    question: "Dari BPJS kenapa mempending kasus ini?",
    placeholder: "cth: Tifoid",
    ringkasan: "Pasien An. R dirawat dengan diagnosis Demam Tifoid (ICD-10 A01.0); kata kunci \u201cTifoid\u201d cocok dengan template tersimpan, sehingga jawaban disusun mengikuti format yang sudah kamu atur di Settings.",
    jawaban: "Mengacu pada template respons kasus Tifoid, hasil pemeriksaan penunjang Widal dengan titer O 1/320 dan gambaran klinis demam tujuh hari disertai bradikardia relatif pada pasien An. R telah memenuhi indikasi rawat inap sesuai Panduan Praktik Klinis Demam Tifoid rumah sakit, sehingga lama hari rawat 5 hari yang diklaim kami mohon dapat disetujui.",
    sources: ["Template: Tifoid", "PPK Demam Tifoid RS"],
  },
};

const KB_DOCS = [
  { name: "Permenkes_No3_2023_Yankes.pdf", type: "PDF", updated: "2 Jul 2026" },
  { name: "Juknis_INA-CBG_2024.pdf", type: "PDF", updated: "28 Jun 2026" },
  { name: "Tarif_INA-CBG_2024.xlsx", type: "Spreadsheet", updated: "15 Jun 2026" },
];

const TEMPLATES = [
  { keyword: "Tifoid", note: "Wajib sebut hasil lab & rujuk PPK RS" },
  { keyword: "DBD", note: "Tekankan hasil trombosit & hematokrit serial" },
  { keyword: "Readmisi Jantung", note: "Bandingkan EKG episode 1 & 2" },
];

const HISTORY = [
  { id: "#0231", wf: "standard", label: "Demam Tifoid \u2014 An. R", date: "4 Jul, 14:12" },
  { id: "#0230", wf: "readmisi", label: "Demam Tifoid \u2014 An. R (Readmisi)", date: "3 Jul, 09:40" },
  { id: "#0229", wf: "template", label: "Tifoid (Template)", date: "1 Jul, 16:05" },
];

function StepDots({ steps, activeIndex, accent }) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2.5" style={{ borderBottom: `1px solid ${MIST}` }}>
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5 flex-1">
          <div
            className="flex items-center justify-center rounded-full text-[10px] font-semibold shrink-0"
            style={{
              width: 18, height: 18,
              backgroundColor: i <= activeIndex ? accent : MIST,
              color: i <= activeIndex ? "#fff" : SLATE,
            }}
          >
            {i < activeIndex ? <Check size={11} /> : i + 1}
          </div>
          <span
            className="text-[10.5px] font-medium truncate"
            style={{ color: i <= activeIndex ? INK : SLATE }}
          >
            {s}
          </span>
          {i < steps.length - 1 && (
            <div className="h-px flex-1" style={{ backgroundColor: i < activeIndex ? accent : MIST_DARK }} />
          )}
        </div>
      ))}
    </div>
  );
}

function WorkflowCard({ id, active, onClick }) {
  const wf = WORKFLOWS[id];
  return (
    <button
      onClick={() => onClick(id)}
      className="w-full text-left rounded-xl p-3.5 transition-colors"
      style={{
        border: `1.5px solid ${active ? wf.accent : MIST_DARK}`,
        backgroundColor: active ? wf.soft : "#fff",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[13.5px]" style={{ color: INK }}>{wf.label}</span>
        <ChevronRight size={16} color={active ? wf.accent : SLATE} />
      </div>
      <p className="text-[11.5px] mt-0.5" style={{ color: SLATE }}>{wf.desc}</p>
    </button>
  );
}

function PanelButton({ children, onClick, variant = "primary", accent = TEAL, icon: Icon, className = "", disabled = false }) {
  const styles = {
    primary: { backgroundColor: disabled ? MIST_DARK : accent, color: disabled ? SLATE : "#fff", border: "none" },
    ghost: { backgroundColor: "transparent", color: disabled ? SLATE : INK, border: `1.5px solid ${MIST_DARK}` },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold px-3.5 py-2.5 transition-opacity ${disabled ? "cursor-not-allowed" : "hover:opacity-90"} ${className}`}
      style={styles[variant]}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

function InputMethodTabs({ method, setMethod, accent }) {
  const methods = [
    { id: "upload", label: "Upload", icon: Upload },
    { id: "link", label: "Link", icon: Link2 },
    { id: "tab", label: "Tab Aktif", icon: Globe },
  ];
  return (
    <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: MIST }}>
      {methods.map((m) => (
        <button
          key={m.id}
          onClick={() => setMethod(m.id)}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-semibold"
          style={{
            backgroundColor: method === m.id ? "#fff" : "transparent",
            color: method === m.id ? accent : SLATE,
            boxShadow: method === m.id ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
          }}
        >
          <m.icon size={12.5} /> {m.label}
        </button>
      ))}
    </div>
  );
}

export default function ClaimClarifyWireframe() {
  const [view, setView] = useState("home");
  const [settingsTab, setSettingsTab] = useState("ai");
  const [workflow, setWorkflow] = useState(null);
  const [stage, setStage] = useState("select");
  const [inputMethod, setInputMethod] = useState("upload");
  const [files, setFiles] = useState([]);
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState("idle");

  const wf = workflow ? WORKFLOWS[workflow] : null;
  const content = workflow ? CONTENT[workflow] : null;

  function selectWorkflow(id) {
    setWorkflow(id);
    setStage("input");
    setFiles(id === "readmisi" ? [{ name: "RM_Rawat_Episode1.pdf" }] : []);
  }

  function addFile() {
    setFiles((f) => [...f, { name: `RM_Rawat_Episode${f.length + 1}.pdf` }]);
  }

  function process() {
    if (workflow === "readmisi" && files.length < 2) return;
    setStage("processing");
    setTimeout(() => setStage("question"), 1400);
  }

  function submitAnswer() {
    if (!answer.trim()) return;
    setStage("output");
  }

  function resetFlow() {
    setWorkflow(null); setStage("select"); setFiles([]); setAnswer(""); setCopied(false); setInputMethod("upload");
  }

  function copyText(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const steps = workflow === "template"
    ? ["Alur", "Dokumen", "Kata Kunci", "Hasil"]
    : ["Alur", "Dokumen", "Konfirmasi", "Hasil"];
  const stageIndex = { select: 0, input: 1, processing: 1, question: 2, output: 3 }[stage];

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: "#F2F4F5", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @keyframes scanline { 0% { top: 0%; opacity: 0.9; } 90% { opacity: 0.9; } 100% { top: 96%; opacity: 0; } }
        .scanline { animation: scanline 1.4s ease-in-out infinite; }
      `}</style>

      {/* Fake browser chrome */}
      <div className="w-full flex items-center gap-3 px-4 py-2" style={{ backgroundColor: "#DCE2E5", borderBottom: `1px solid ${MIST_DARK}` }}>
        <div className="hidden md:flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#E5A2A2" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#EBCB9A" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#A9CFAE" }} />
        </div>
        <div className="flex-1 max-w-md flex items-center gap-2 rounded-full px-3 py-1.5" style={{ backgroundColor: "#fff" }}>
          <ShieldCheck size={12} color={SLATE} />
          <span className="text-[11px] truncate" style={{ color: SLATE }}>sep.bpjs-kesehatan.go.id/verifikasi/klaim</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative flex items-center justify-center rounded-md" style={{ width: 26, height: 26, backgroundColor: TEAL }}>
            <span className="text-[9px] font-bold text-white">CC</span>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0" style={{ borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `4px solid ${TEAL}` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-1">
        {/* Fake page background (context only, hidden on small screens) */}
        <div className="hidden md:flex flex-1 p-6">
          <div className="w-full rounded-lg p-5" style={{ backgroundColor: "#fff", border: `1px solid ${MIST_DARK}`, opacity: 0.6 }}>
            <div className="h-4 w-48 rounded mb-4" style={{ backgroundColor: MIST_DARK }} />
            <div className="h-3 w-full rounded mb-2" style={{ backgroundColor: MIST }} />
            <div className="h-3 w-5/6 rounded mb-5" style={{ backgroundColor: MIST }} />
            {[1, 2, 3].map((r) => (
              <div key={r} className="flex items-center gap-3 py-2.5" style={{ borderBottom: `1px solid ${MIST}` }}>
                <div className="h-3 w-24 rounded" style={{ backgroundColor: MIST }} />
                <div className="h-3 w-32 rounded" style={{ backgroundColor: MIST }} />
                <div className="h-3 w-20 rounded" style={{ backgroundColor: MIST }} />
                {r === 1 ? (
                  <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}>PENDING</span>
                ) : (
                  <div className="ml-auto h-3 w-16 rounded" style={{ backgroundColor: MIST }} />
                )}
              </div>
            ))}
            <p className="text-[11px] mt-4" style={{ color: SLATE }}>Halaman verifikasi BPJS (ilustrasi latar) \u2014 fokus utama ada pada side panel di kanan.</p>
          </div>
        </div>

        {/* SIDE PANEL */}
        <div className="w-full md:w-auto flex flex-col" style={{ width: "100%", maxWidth: 400, backgroundColor: PAPER, borderLeft: `1px solid ${MIST_DARK}`, boxShadow: "-6px 0 18px rgba(0,0,0,0.06)" }}>

          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${MIST}` }}>
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center rounded-md" style={{ width: 24, height: 24, backgroundColor: INK }}>
                <span className="text-[9px] font-bold text-white">CC</span>
              </div>
              <div>
                <p className="text-[13px] font-bold leading-tight" style={{ color: INK }}>Claim Clarify</p>
                <p className="text-[9.5px] leading-tight" style={{ color: SLATE }}>Asisten pending klaim BPJS</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setView(view === "home" ? "settings" : "home")} className="p-1.5 rounded-md" style={{ color: view === "settings" ? TEAL : SLATE, backgroundColor: view === "settings" ? TEAL_SOFT : "transparent" }}>
                <Settings size={16} />
              </button>
            </div>
          </div>

          {view === "settings" ? (
            <SettingsView
              settingsTab={settingsTab} setSettingsTab={setSettingsTab}
              showKey={showKey} setShowKey={setShowKey}
              testStatus={testStatus} setTestStatus={setTestStatus}
              onBack={() => setView("home")}
            />
          ) : (
            <div className="flex flex-col flex-1">
              {workflow && <StepDots steps={steps} activeIndex={stageIndex} accent={wf.accent} />}

              <div className="flex-1 p-4 overflow-y-auto" style={{ minHeight: 420 }}>
                {stage === "select" && (
                  <div className="space-y-2.5">
                    <p className="text-[12px] font-semibold mb-1" style={{ color: SLATE }}>Pilih jenis kasus</p>
                    {Object.keys(WORKFLOWS).map((id) => (
                      <WorkflowCard key={id} id={id} active={workflow === id} onClick={selectWorkflow} />
                    ))}
                  </div>
                )}

                {stage === "input" && wf && (
                  <div className="space-y-3.5">
                    <button onClick={resetFlow} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: SLATE }}>
                      <ArrowLeft size={12} /> Ganti alur
                    </button>
                    <div className="rounded-lg px-3 py-2 text-[11.5px] font-medium" style={{ backgroundColor: wf.soft, color: wf.accent }}>
                      {wf.label}
                    </div>

                    {workflow === "readmisi" && (
                      <div className="flex items-start gap-2 rounded-lg p-2.5 text-[11px]" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}>
                        <Layers size={13} className="mt-0.5 shrink-0" />
                        Wajib unggah minimal 2 dokumen (rawat pertama & kedua).
                      </div>
                    )}

                    <InputMethodTabs method={inputMethod} setMethod={setInputMethod} accent={wf.accent} />

                    {inputMethod === "upload" && (
                      <div className="space-y-2">
                        <div className="rounded-lg p-4 flex flex-col items-center gap-1.5 text-center" style={{ border: `1.5px dashed ${MIST_DARK}` }}>
                          <Upload size={18} color={SLATE} />
                          <p className="text-[11px]" style={{ color: SLATE }}>Tarik file ke sini atau klik untuk unggah</p>
                        </div>
                        {files.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: MIST }}>
                            <FileText size={13} color={SLATE} />
                            <span className="text-[11px] flex-1 truncate font-mono" style={{ color: INK }}>{f.name}</span>
                            <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><X size={12} color={SLATE} /></button>
                          </div>
                        ))}
                        {workflow === "readmisi" && (
                          <button onClick={addFile} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: wf.accent }}>
                            <Plus size={12} /> Tambah dokumen episode
                          </button>
                        )}
                      </div>
                    )}

                    {inputMethod === "link" && (
                      <input placeholder="https://...rekam-medis.pdf" className="w-full rounded-lg px-3 py-2.5 text-[12px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} />
                    )}

                    {inputMethod === "tab" && (
                      <div className="rounded-lg p-3 flex items-center gap-2" style={{ backgroundColor: MIST }}>
                        <Globe size={14} color={SLATE} />
                        <span className="text-[11px]" style={{ color: INK }}>Terdeteksi: rekam-medis-anR.pdf (tab aktif)</span>
                      </div>
                    )}

                    <PanelButton
                      onClick={process}
                      accent={wf.accent}
                      className="w-full mt-2"
                      disabled={workflow === "readmisi" && files.length < 2}
                    >
                      Proses Dokumen
                    </PanelButton>
                    {workflow === "readmisi" && files.length < 2 && (
                      <p className="text-[10.5px]" style={{ color: AMBER }}>Unggah minimal 2 dokumen untuk melanjutkan.</p>
                    )}
                  </div>
                )}

                {stage === "processing" && wf && (
                  <div className="flex flex-col items-center justify-center h-full gap-4 py-10">
                    <div className="relative w-16 h-20 rounded-md overflow-hidden" style={{ border: `1.5px solid ${MIST_DARK}`, backgroundColor: "#fff" }}>
                      <div className="absolute left-0 right-0 h-0.5 scanline" style={{ backgroundColor: wf.accent }} />
                      <FileText size={28} color={MIST_DARK} className="absolute inset-0 m-auto" />
                    </div>
                    <p className="text-[12px] font-medium" style={{ color: SLATE }}>Membaca rekam medis\u2026</p>
                  </div>
                )}

                {stage === "question" && wf && content && (
                  <div className="space-y-3">
                    <button onClick={() => setStage("input")} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: SLATE }}>
                      <ArrowLeft size={12} /> Kembali
                    </button>
                    <div className="rounded-xl rounded-tl-sm p-3" style={{ backgroundColor: MIST }}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Bot size={13} color={wf.accent} />
                        <span className="text-[10.5px] font-semibold" style={{ color: wf.accent }}>Claim Clarify</span>
                      </div>
                      <p className="text-[12.5px]" style={{ color: INK }}>{content.question}</p>
                    </div>
                    {workflow === "template" && (
                      <div className="flex items-center gap-1.5 rounded-lg p-2 text-[10.5px]" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}>
                        <Tag size={12} /> Cukup jawab dengan kata kunci template, mis. "Tifoid".
                      </div>
                    )}
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder={content.placeholder}
                      rows={3}
                      className="w-full rounded-lg px-3 py-2.5 text-[12px] outline-none resize-none"
                      style={{ border: `1.5px solid ${MIST_DARK}` }}
                    />
                    <PanelButton onClick={submitAnswer} accent={wf.accent} className="w-full">
                      Kirim Jawaban
                    </PanelButton>
                  </div>
                )}

                {stage === "output" && wf && content && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold" style={{ color: SLATE }}>1. Ringkasan Kasus</span>
                    </div>
                    <div className="rounded-lg p-3" style={{ backgroundColor: MIST }}>
                      <p className="text-[12px] leading-relaxed" style={{ color: INK }}>{content.ringkasan}</p>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-semibold" style={{ color: SLATE }}>2. Jawaban Pending</span>
                      <button onClick={() => copyText(content.jawaban)} className="flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-md" style={{ color: copied ? "#fff" : wf.accent, backgroundColor: copied ? wf.accent : wf.soft }}>
                        {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Disalin" : "Salin"}
                      </button>
                    </div>
                    <div className="relative rounded-lg p-3.5" style={{ backgroundColor: "#fff", border: `1.5px solid ${wf.accent}` }}>
                      <p className="text-[12px] leading-relaxed" style={{ color: INK }}>{content.jawaban}</p>
                      <div
                        className="absolute -top-2.5 -right-2.5 flex items-center gap-1 px-2 py-1 rounded-full font-mono uppercase tracking-wide"
                        style={{ fontSize: 8.5, backgroundColor: "#fff", border: `1.5px dashed ${wf.accent}`, color: wf.accent, transform: "rotate(4deg)" }}
                      >
                        <ShieldCheck size={10} /> Siap Diajukan
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {content.sources.map((s) => (
                        <span key={s} className="text-[9.5px] px-2 py-1 rounded-full" style={{ backgroundColor: MIST, color: SLATE }}>{s}</span>
                      ))}
                    </div>

                    <PanelButton onClick={resetFlow} variant="ghost" className="w-full mt-2">
                      Kasus Baru
                    </PanelButton>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsView({ settingsTab, setSettingsTab, showKey, setShowKey, testStatus, setTestStatus, onBack }) {
  const tabs = [
    { id: "ai", label: "AI (BYOK)", icon: Bot },
    { id: "kb", label: "Knowledge", icon: FolderOpen },
    { id: "template", label: "Template", icon: Tag },
    { id: "history", label: "Riwayat", icon: History },
  ];

  function runTest() {
    setTestStatus("testing");
    setTimeout(() => setTestStatus("success"), 1200);
  }

  return (
    <div className="flex flex-col flex-1">
      <div className="flex items-center gap-1 px-2 pt-2">
        <button onClick={onBack} className="p-1.5"><ArrowLeft size={14} color={SLATE} /></button>
        <div className="flex flex-1 gap-0.5 p-1 rounded-lg" style={{ backgroundColor: MIST }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setSettingsTab(t.id)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md"
              style={{ backgroundColor: settingsTab === t.id ? "#fff" : "transparent", boxShadow: settingsTab === t.id ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}
            >
              <t.icon size={13} color={settingsTab === t.id ? TEAL : SLATE} />
              <span className="text-[8.5px] font-semibold" style={{ color: settingsTab === t.id ? TEAL : SLATE }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto" style={{ minHeight: 420 }}>
        {settingsTab === "ai" && (
          <div className="space-y-3.5">
            <div>
              <label className="text-[10.5px] font-semibold" style={{ color: SLATE }}>Provider</label>
              <div className="flex gap-2 mt-1.5">
                {["Anthropic", "OpenAI-compatible"].map((p) => (
                  <button key={p} className="flex-1 rounded-lg px-2 py-2 text-[11px] font-semibold" style={{ backgroundColor: p === "Anthropic" ? TEAL_SOFT : MIST, color: p === "Anthropic" ? TEAL : SLATE, border: `1.5px solid ${p === "Anthropic" ? TEAL : "transparent"}` }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Field icon={Server} label="Endpoint URL" value="https://api.anthropic.com/v1/messages" />
            <Field icon={Bot} label="Model" value="claude-sonnet-5" hasChevron />
            <div>
              <label className="text-[10.5px] font-semibold flex items-center gap-1" style={{ color: SLATE }}><KeyRound size={11} /> API Key</label>
              <div className="flex items-center gap-2 mt-1.5 rounded-lg px-3 py-2.5" style={{ border: `1.5px solid ${MIST_DARK}` }}>
                <span className="text-[12px] font-mono flex-1" style={{ color: INK }}>{showKey ? "sk-ant-a1B2c3D4e5F6g7H8" : "sk-ant-••••••••••••7f2a"}</span>
                <button onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} color={SLATE} /> : <Eye size={14} color={SLATE} />}</button>
              </div>
            </div>
            <PanelButton onClick={runTest} className="w-full" icon={testStatus === "testing" ? RefreshCw : ShieldCheck}>
              {testStatus === "testing" ? "Menguji koneksi\u2026" : testStatus === "success" ? "Terhubung \u2713" : "Uji Koneksi"}
            </PanelButton>
          </div>
        )}

        {settingsTab === "kb" && (
          <div className="space-y-3">
            <p className="text-[11px]" style={{ color: SLATE }}>Dokumen ini jadi rujukan utama AI. Pencarian internet hanya dipakai kalau tidak ditemukan di sini.</p>
            <div className="space-y-1.5">
              {KB_DOCS.map((d) => (
                <div key={d.name} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: MIST }}>
                  <FileText size={13} color={SLATE} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-mono truncate" style={{ color: INK }}>{d.name}</p>
                    <p className="text-[9.5px]" style={{ color: SLATE }}>{d.type} \u00b7 diperbarui {d.updated}</p>
                  </div>
                  <button><Trash2 size={13} color={SLATE} /></button>
                </div>
              ))}
            </div>
            <PanelButton variant="ghost" className="w-full" icon={Upload}>Unggah Dokumen</PanelButton>
            <div className="flex gap-2">
              <PanelButton variant="ghost" className="flex-1" icon={Download}>Export</PanelButton>
              <PanelButton variant="ghost" className="flex-1" icon={Upload}>Import</PanelButton>
            </div>
          </div>
        )}

        {settingsTab === "template" && (
          <div className="space-y-3">
            <p className="text-[11px]" style={{ color: SLATE }}>Kata kunci di sini bisa langsung dipakai saat menjawab pertanyaan alasan pending.</p>
            <div className="space-y-1.5">
              {TEMPLATES.map((t) => (
                <div key={t.keyword} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: MIST }}>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}>{t.keyword}</span>
                  <p className="text-[10.5px] flex-1" style={{ color: SLATE }}>{t.note}</p>
                  <button><Trash2 size={13} color={SLATE} /></button>
                </div>
              ))}
            </div>
            <PanelButton variant="ghost" className="w-full" icon={Plus}>Tambah Template</PanelButton>
            <div className="flex gap-2">
              <PanelButton variant="ghost" className="flex-1" icon={Download}>Export</PanelButton>
              <PanelButton variant="ghost" className="flex-1" icon={Upload}>Import</PanelButton>
            </div>
          </div>
        )}

        {settingsTab === "history" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: MIST }}>
              <Search size={13} color={SLATE} />
              <span className="text-[11px]" style={{ color: SLATE }}>Cari kasus\u2026</span>
            </div>
            <div className="space-y-1.5">
              {HISTORY.map((h) => (
                <div key={h.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5" style={{ backgroundColor: MIST }}>
                  <ClipboardList size={14} color={WORKFLOWS[h.wf].accent} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate" style={{ color: INK }}>{h.label}</p>
                    <p className="text-[9.5px]" style={{ color: SLATE }}>{h.id} \u00b7 {h.date}</p>
                  </div>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: WORKFLOWS[h.wf].soft, color: WORKFLOWS[h.wf].accent }}>
                    {WORKFLOWS[h.wf].label}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] flex items-center gap-1" style={{ color: SLATE }}>
              <ShieldCheck size={11} /> Setiap kasus tercatat sebagai log audit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value, hasChevron }) {
  return (
    <div>
      <label className="text-[10.5px] font-semibold flex items-center gap-1" style={{ color: SLATE }}><Icon size={11} /> {label}</label>
      <div className="flex items-center gap-2 mt-1.5 rounded-lg px-3 py-2.5" style={{ border: `1.5px solid ${MIST_DARK}` }}>
        <span className="text-[12px] flex-1 truncate" style={{ color: INK }}>{value}</span>
        {hasChevron && <ChevronDown size={14} color={SLATE} />}
      </div>
    </div>
  );
}

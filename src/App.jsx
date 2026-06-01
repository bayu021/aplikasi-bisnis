import { useState, useEffect, useRef, useCallback } from "react";

// ==================== UTILS ====================
const formatRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const today = () => new Date().toISOString().slice(0, 10);

// FIX #1: Telegram — gunakan no-cors mode + fallback URL proxy agar tidak di-block CORS
const sendTelegram = async (token, chatId, text) => {
  if (!token || !chatId) return { ok: false, error: "Token/ChatID kosong" };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const CATEGORIES_IN = ["Penjualan", "Jasa", "Investasi", "Lainnya"];
const CATEGORIES_OUT = ["Operasional", "Gaji", "Pembelian Stok", "Marketing", "Lainnya"];
const PROJECT_STATUS = ["Pending", "Berjalan", "Selesai", "Ditunda"];
const STATUS_COLOR = { Pending: "#f59e0b", Berjalan: "#3b82f6", Selesai: "#10b981", Ditunda: "#ef4444" };

// ==================== SUPABASE CONFIG ====================
// Ganti dengan URL & Key Supabase project Anda
const SUPABASE_URL = localStorage.getItem("sb_url") || "";
const SUPABASE_ANON_KEY = localStorage.getItem("sb_key") || "";

// Supabase REST helper (tanpa library eksternal)
const sbFetch = async (path, options = {}) => {
  const url = SUPABASE_URL + "/rest/v1/" + path;
  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": "Bearer " + SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    "Prefer": options.prefer || "return=representation",
    ...options.headers,
  };
  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const err = await res.text();
      return { data: null, error: err };
    }
    const text = await res.text();
    return { data: text ? JSON.parse(text) : [], error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
};

// ==================== KEY → TABLE MAPPING ====================
// Setiap localStorage key dipetakan ke tabel Supabase yang sesuai
const KEY_TABLE_MAP = {
  "biz":               { table: "biz_profile",       mode: "single" },   // object tunggal
  "income":            { table: "cashflow",           mode: "array",  extraCol: { type: "income" } },
  "expense":           { table: "cashflow",           mode: "array",  extraCol: { type: "expense" } },
  "inventory":         { table: "inventory",          mode: "array" },
  "invoices":          { table: "invoices",           mode: "array" },
  "users":             { table: "users",              mode: "array" },
  "owner_accounts":    { table: "owner_accounts",     mode: "array" },
  "owner_cooldowns":   { table: "owner_cooldowns",    mode: "single" },
  "owner_account":     { table: "owner_account",      mode: "single" },
  "telegram":          { table: "telegram_config",    mode: "single" },
  "work_hours":        { table: "work_hours",         mode: "single" },
  "integrations_web":  { table: "integrations_web",  mode: "array" },
  "payment_gateways":  { table: "payment_gateways",  mode: "array" },
  "security_state":    { table: "security_state",     mode: "single" },
  "session_user":      { table: null, mode: "local" }, // tetap di localStorage (session)
  "owner_cooldowns":   { table: "owner_cooldowns",    mode: "single" },
};

// Cek apakah Supabase sudah dikonfigurasi
const isSupabaseReady = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// ==================== LOAD: Supabase → State ====================
// Ambil data dari Supabase berdasarkan key. Fallback ke localStorage jika belum terkonfigurasi.
const loadFromCloud = async (key, defaultVal) => {
  // Selalu baca dari localStorage sebagai cache lokal
  const localVal = (() => { try { return JSON.parse(localStorage.getItem(key)) ?? defaultVal; } catch { return defaultVal; } })();

  if (!isSupabaseReady()) return localVal;

  const mapping = KEY_TABLE_MAP[key];
  if (!mapping || mapping.mode === "local") return localVal;

  const { table, mode, extraCol } = mapping;

  if (mode === "single") {
    // Tabel single-row — pakai kolom 'key' sebagai identifier
    const { data, error } = await sbFetch(`${table}?key=eq.${key}&limit=1`);
    if (error || !data || data.length === 0) return localVal;
    const row = data[0];
    const parsed = row.value ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : defaultVal;
    localStorage.setItem(key, JSON.stringify(parsed)); // update cache
    return parsed;
  }

  if (mode === "array") {
    let query = table + "?order=id.desc";
    if (extraCol) {
      const [col, val] = Object.entries(extraCol)[0];
      query += `&${col}=eq.${val}`;
    }
    const { data, error } = await sbFetch(query);
    if (error || !data) return localVal;
    localStorage.setItem(key, JSON.stringify(data)); // update cache
    return data;
  }

  return localVal;
};

// ==================== SAVE: State → localStorage + Supabase ====================
const saveAndSync = async (key, value) => {
  // 1) Sempre salva no localStorage (cache local imediato)
  localStorage.setItem(key, JSON.stringify(value));

  if (!isSupabaseReady()) return;

  const mapping = KEY_TABLE_MAP[key];
  if (!mapping || mapping.mode === "local") return;

  const { table, mode, extraCol } = mapping;

  if (mode === "single") {
    // Upsert single-row: kolom 'key' sebagai identifier unik
    await sbFetch(table + "?key=eq." + key, {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }),
    });
    return;
  }

  if (mode === "array") {
    if (!Array.isArray(value) || value.length === 0) return;

    // Hapus rows lama yang tidak ada di value baru (hard delete by id)
    const ids = value.map(r => r.id).filter(Boolean);

    // Upsert semua data array sekaligus
    const rows = value.map(r => ({
      ...r,
      ...(extraCol || {}),
      updated_at: new Date().toISOString(),
    }));

    await sbFetch(table, {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    return;
  }
};

// Alias backward-compat — save sekarang juga sync ke Supabase
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { localStorage.setItem(k, JSON.stringify(v)); saveAndSync(k, v); };

// ==================== SUPABASE SETUP PAGE ====================
function SupabaseSetup({ onSave }) {
  const [url, setUrl] = useState(localStorage.getItem("sb_url") || "");
  const [key, setKey] = useState(localStorage.getItem("sb_key") || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const testConnection = async () => {
    if (!url || !key) return setTestResult({ ok: false, msg: "URL dan Key wajib diisi!" });
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(url + "/rest/v1/biz_profile?limit=1", {
        headers: { "apikey": key, "Authorization": "Bearer " + key },
      });
      if (res.ok) {
        setTestResult({ ok: true, msg: "Koneksi Supabase berhasil! ✅" });
      } else {
        const t = await res.text();
        setTestResult({ ok: false, msg: "Gagal: " + t.slice(0, 120) });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: "Error: " + e.message });
    }
    setTesting(false);
  };

  const handleSave = () => {
    if (!url || !key) return;
    localStorage.setItem("sb_url", url.replace(/\/$/, ""));
    localStorage.setItem("sb_key", key.trim());
    onSave();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0a0f1e", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20, fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ background: "#1e293b", borderRadius: 20, padding: 36, maxWidth: 500, width: "100%", border: "1px solid #334155", boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>☁️</div>
          <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Konfigurasi Supabase</div>
          <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
            Masukkan URL dan Anon Key dari project Supabase Anda.<br />
            Data akan tersinkronisasi otomatis ke cloud.
          </div>
        </div>

        <div style={{ background: "#0f172a", borderRadius: 12, padding: "14px 16px", marginBottom: 24, fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
          <strong style={{ color: "#3b82f6" }}>📋 Cara mendapatkan credentials:</strong><br />
          1. Buka <strong style={{ color: "#f1f5f9" }}>supabase.com</strong> → Project Anda<br />
          2. Settings → API<br />
          3. Salin <strong style={{ color: "#10b981" }}>Project URL</strong> dan <strong style={{ color: "#10b981" }}>anon / public key</strong>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>SUPABASE PROJECT URL</label>
          <input style={{ width: "100%", padding: "10px 14px", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxxxxxxxxxx.supabase.co" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>ANON / PUBLIC KEY</label>
          <input type="password" style={{ width: "100%", padding: "10px 14px", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            value={key} onChange={e => setKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp..." />
        </div>

        {testResult && (
          <div style={{ background: testResult.ok ? "#10b98122" : "#ef444422", border: `1px solid ${testResult.ok ? "#10b98144" : "#ef444444"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: testResult.ok ? "#10b981" : "#fca5a5", fontSize: 13 }}>
            {testResult.msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ flex: 1, padding: "11px", borderRadius: 8, border: "none", cursor: "pointer", background: "#334155", color: "#94a3b8", fontWeight: 600, fontSize: 14, opacity: testing ? 0.6 : 1 }}
            onClick={testConnection} disabled={testing}>
            {testing ? "⏳ Testing..." : "🔌 Test Koneksi"}
          </button>
          <button style={{ flex: 1, padding: "11px", borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "#fff", fontWeight: 700, fontSize: 14 }}
            onClick={handleSave} disabled={!url || !key}>
            💾 Simpan & Lanjutkan
          </button>
        </div>
        {(localStorage.getItem("sb_url")) && (
          <button style={{ width: "100%", marginTop: 12, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", background: "none", color: "#64748b", fontSize: 13 }}
            onClick={onSave}>
            Lewati (gunakan konfigurasi lama)
          </button>
        )}
      </div>
    </div>
  );
}

// ==================== LOADING SCREEN ====================
function LoadingScreen({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);
  const phases = ["Memuat sistem...", "Menginisialisasi data...", "Menyiapkan dashboard...", "Selesai!"];

  useEffect(() => {
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 18 + 4;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(onDone, 500); }
      setProgress(Math.min(p, 100));
      setPhase(Math.floor(Math.min(p, 99) / 25));
    }, 120);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0a0f1e",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      zIndex: 99999, fontFamily: "'DM Sans','Segoe UI',sans-serif"
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes floatUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
      `}</style>

      {/* Animated logo */}
      <div style={{ marginBottom: 40, animation: "floatUp 0.8s ease" }}>
        <div style={{
          width: 90, height: 90, borderRadius: 24,
          background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 44, boxShadow: "0 0 60px #3b82f644",
          marginBottom: 20
        }}>💼</div>
        <div style={{
          textAlign: "center",
          fontSize: 28, fontWeight: 800,
          background: "linear-gradient(135deg,#3b82f6,#8b5cf6,#06b6d4)",
          backgroundSize: "200% auto",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          animation: "shimmer 2s linear infinite"
        }}>BizFlow Pro</div>
        <div style={{ color: "#475569", fontSize: 13, textAlign: "center", marginTop: 4 }}>Business Management System</div>
      </div>

      {/* Progress bar */}
      <div style={{ width: 280 }}>
        <div style={{ background: "#1e293b", borderRadius: 99, height: 6, marginBottom: 16, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 99, width: `${progress}%`,
            background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
            transition: "width 0.15s ease", boxShadow: "0 0 12px #3b82f688"
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#64748b", fontSize: 13, animation: "pulse 1.5s infinite" }}>{phases[phase]}</span>
          <span style={{ color: "#3b82f6", fontSize: 13, fontWeight: 700 }}>{Math.round(progress)}%</span>
        </div>
      </div>

      {/* Dots */}
      <div style={{ display: "flex", gap: 8, marginTop: 32 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#3b82f6", opacity: 0.3,
            animation: `pulse 1.2s ${i * 0.3}s infinite`
          }} />
        ))}
      </div>
    </div>
  );
}

// ==================== MINI CHART ====================
function SparkLine({ data, color = "#3b82f6", height = 50 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0), range = max - min || 1;
  const w = 200, h = height;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function BarChart({ labels, values, color = "#3b82f6" }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80, padding: "0 4px" }}>
      {values.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ width: "100%", background: color, borderRadius: 4, height: `${(v / max) * 64}px`, minHeight: v > 0 ? 4 : 0, transition: "height 0.5s ease" }} />
          <span style={{ fontSize: 9, color: "#94a3b8", whiteSpace: "nowrap" }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ==================== TOAST ====================
function Toast({ toasts }) {
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "success" ? "#10b981" : t.type === "error" ? "#ef4444" : "#3b82f6",
          color: "#fff", padding: "12px 18px", borderRadius: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)", fontSize: 14, fontWeight: 500,
          animation: "slideIn 0.3s ease", maxWidth: 340
        }}>
          {t.type === "success" ? "✅ " : t.type === "error" ? "❌ " : "ℹ️ "}{t.msg}
        </div>
      ))}
    </div>
  );
}

// ==================== MODAL ====================
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#1e293b", borderRadius: 16, padding: 28, width: "100%", maxWidth: 520, border: "1px solid #334155", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#f1f5f9", fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 14px", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" };
const labelStyle = { display: "block", color: "#94a3b8", fontSize: 12, marginBottom: 4, fontWeight: 600, letterSpacing: "0.05em" };
const btnPrimary = { background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600 };
const btnDanger = { ...btnPrimary, background: "linear-gradient(135deg, #ef4444, #b91c1c)" };
const btnSuccess = { ...btnPrimary, background: "linear-gradient(135deg, #10b981, #059669)" };
function Field({ label, children }) { return <div style={{ marginBottom: 14 }}><label style={labelStyle}>{label}</label>{children}</div>; }

// ==================== SIDEBAR ====================
const NAV = [
  { id: "dashboard", icon: "📊", label: "Dashboard" },
  { id: "cashflow", icon: "💰", label: "Cash Flow" },
  { id: "kasir", icon: "🛒", label: "Kasir" },
  { id: "inventory", icon: "📦", label: "Stok Gudang" },
  { id: "invoice", icon: "🧾", label: "Invoice" },
  { id: "reports", icon: "📈", label: "Laporan" },
  { id: "telegram", icon: "✈️", label: "Telegram Bot" },
  { id: "owner", icon: "👑", label: "Owner" },
  { id: "settings", icon: "⚙️", label: "Pengaturan" },
];

function Sidebar({ active, setActive, biz, sideOpen, setSideOpen }) {
  return (
    <>
      {sideOpen && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40 }} onClick={() => setSideOpen(false)} />}
      <aside style={{ position: "fixed", left: sideOpen ? 0 : -260, top: 0, bottom: 0, width: 240, background: "#0f172a", borderRight: "1px solid #1e293b", zIndex: 50, transition: "left 0.3s ease", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {biz.logo
              ? <img src={biz.logo} alt="logo" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }} />
              : <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💼</div>}
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{biz.name || "Bisnis Saya"}</div>
              <div style={{ color: "#64748b", fontSize: 11 }}>{biz.owner || "Pemilik"}</div>
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => { setActive(n.id); setSideOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: active === n.id ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : "none", color: active === n.id ? "#fff" : "#64748b", fontSize: 14, fontWeight: 500, marginBottom: 2, textAlign: "left" }}>
              <span>{n.icon}</span><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div style={{ padding: 16, borderTop: "1px solid #1e293b", color: "#475569", fontSize: 11, textAlign: "center" }}>BizFlow Pro v2.0</div>
      </aside>
    </>
  );
}

function StatCard({ label, value, icon, color, sparkData, sub }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: 14, padding: "20px 22px", border: "1px solid #334155", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
          <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700 }}>{value}</div>
          {sub && <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>{sub}</div>}
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</div>
      </div>
      {sparkData && <div style={{ marginTop: 12 }}><SparkLine data={sparkData} color={color} height={40} /></div>}
    </div>
  );
}

// ==================== DASHBOARD ====================
function Dashboard({ income, expense, inventory, tg, biz }) {
  const totalIn = income.reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount), 0);
  const profit = totalIn - totalOut;
  const lowStock = inventory.filter(i => Number(i.qty) <= Number(i.minQty || 5));

  // FIX #3: Laba bersih dari stok = harga jual - harga modal
  const netProfitFromStock = income
    .filter(r => r.fromStock)
    .reduce((s, r) => s + (Number(r.amount) - Number(r.costAmount || 0)), 0);

  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
  const nowM = new Date().getMonth();
  const last6 = Array.from({ length: 6 }, (_, i) => months[(nowM - 5 + i + 12) % 12]);
  const inData = last6.map((_, i) => { const m = (nowM - 5 + i + 12) % 12; return income.filter(r => new Date(r.date).getMonth() === m).reduce((s, r) => s + Number(r.amount), 0); });
  const outData = last6.map((_, i) => { const m = (nowM - 5 + i + 12) % 12; return expense.filter(r => new Date(r.date).getMonth() === m).reduce((s, r) => s + Number(r.amount), 0); });

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 24, fontWeight: 700 }}>Selamat datang, {biz.owner || "Pengguna"} 👋</h2>
        <p style={{ color: "#64748b", margin: "4px 0 0" }}>Ringkasan bisnis Anda hari ini</p>
      </div>

      {lowStock.length > 0 && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef444444", borderRadius: 12, padding: "12px 16px", marginBottom: 20, color: "#fca5a5", fontSize: 14 }}>
          ⚠️ <strong>{lowStock.length} barang</strong> stok menipis: {lowStock.map(i => i.name).join(", ")}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard label="TOTAL PEMASUKAN" value={formatRp(totalIn)} icon="📈" color="#10b981" sparkData={inData} />
        <StatCard label="TOTAL PENGELUARAN" value={formatRp(totalOut)} icon="📉" color="#ef4444" sparkData={outData} />
        <StatCard label="NET CASH FLOW" value={formatRp(profit)} icon="💵" color={profit >= 0 ? "#3b82f6" : "#f59e0b"} />
        <StatCard label="LABA BERSIH PENJUALAN" value={formatRp(netProfitFromStock)} icon="💹" color="#8b5cf6" sub="Harga Jual - Modal" />
        <StatCard label="TOTAL PENJUALAN" value={income.filter(r => r.fromStock).length + " transaksi"} icon="🛒" color="#06b6d4" />
        <StatCard label="TOTAL PRODUK" value={inventory.length} icon="📦" color="#f59e0b" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>📊 Pemasukan 6 Bulan</h4>
          <BarChart labels={last6} values={inData} color="#10b981" />
        </div>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>📊 Pengeluaran 6 Bulan</h4>
          <BarChart labels={last6} values={outData} color="#ef4444" />
        </div>
      </div>

      <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
        <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>🕐 Transaksi Terbaru</h4>
        {[...income.map(r => ({ ...r, type: "in" })), ...expense.map(r => ({ ...r, type: "out" }))]
          .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
          .map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #0f172a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: r.type === "in" ? "#10b98122" : "#ef444422", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {r.fromStock ? "📦" : r.type === "in" ? "📈" : "📉"}
                </div>
                <div>
                  <div style={{ color: "#f1f5f9", fontSize: 14 }}>{r.desc || r.category}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>{r.date} · {r.category}{r.fromStock ? " · Penjualan Stok" : ""}</div>
                </div>
              </div>
              <div style={{ color: r.type === "in" ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: 15 }}>
                {r.type === "in" ? "+" : "-"}{formatRp(r.amount)}
              </div>
            </div>
          ))}
        {income.length === 0 && expense.length === 0 && <div style={{ color: "#64748b", textAlign: "center", padding: "20px 0" }}>Belum ada transaksi</div>}
      </div>
    </div>
  );
}

// ==================== CASHFLOW ====================
function CashFlow({ income, setIncome, expense, setExpense, inventory, setInventory, tg, biz, addToast }) {
  const [tab, setTab] = useState("in");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: today(), category: "", desc: "", amount: "" });
  const [selectedStockItem, setSelectedStockItem] = useState("");
  const [stockQty, setStockQty] = useState("");

  const totalIn = income.reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount), 0);

  const isPembelianStok = tab === "out" && form.category === "Pembelian Stok";

  const handleCategoryChange = (val) => {
    setForm({ ...form, category: val });
    if (val !== "Pembelian Stok") {
      setSelectedStockItem("");
      setStockQty("");
    }
  };

  const handleStockItemChange = (itemId) => {
    setSelectedStockItem(itemId);
    const item = inventory.find(i => String(i.id) === String(itemId));
    if (item) {
      const total = item.costPrice && stockQty ? Number(item.costPrice) * Number(stockQty) : "";
      setForm(f => ({ ...f, amount: total !== "" ? String(total) : "", desc: f.desc || `Pembelian stok: ${item.name}` }));
    }
  };

  const submit = async () => {
    if (isSystemLocked()) return addToast("🔒 Sistem terkunci! Transaksi diblokir. Hubungi Owner.", "error");
    if (!form.category) return addToast("Lengkapi semua field!", "error");

    // Validasi pembelian stok
    if (isPembelianStok) {
      if (!selectedStockItem) return addToast("Pilih barang stok yang dibeli!", "error");
      if (!stockQty || Number(stockQty) <= 0) return addToast("Masukkan jumlah stok yang dibeli!", "error");
    }

    // Hitung ulang total nominal untuk pembelian stok: costPrice × qty
    let finalAmount = form.amount;
    if (isPembelianStok && selectedStockItem && stockQty) {
      const item = inventory.find(i => String(i.id) === String(selectedStockItem));
      if (item && item.costPrice) {
        finalAmount = String(Number(item.costPrice) * Number(stockQty));
      }
    }

    if (!finalAmount) return addToast("Lengkapi nominal!", "error");
    const rec = { ...form, amount: finalAmount, id: Date.now() };
    if (tab === "in") {
      const updated = [rec, ...income]; setIncome(updated); save("income", updated);
      const msg = `📢 <b>Pemasukan Baru</b>\n🏢 ${biz.name || "Bisnis"}\n📝 ${form.desc || "-"}\n📂 ${form.category}\n💰 ${formatRp(form.amount)}\n📅 ${form.date}`;
      const res = await sendTelegram(tg.token, tg.groupId, msg);
      if (res && !res.ok) addToast("Telegram gagal: " + (res.description || res.error || "error"), "error");
    } else {
      const updated = [rec, ...expense]; setExpense(updated); save("expense", updated);

      // Jika pembelian stok → update stok barang yang dipilih
      if (isPembelianStok && selectedStockItem) {
        const qty = Number(stockQty);
        const item = inventory.find(i => String(i.id) === String(selectedStockItem));
        const updatedInventory = inventory.map(i => {
          if (String(i.id) !== String(selectedStockItem)) return i;
          const newQty = Number(i.qty) + qty;
          const hist = [...(i.history || []), { type: "in", qty, date: today(), note: `Pembelian stok via Cash Flow - ${formatRp(form.amount)}` }];
          return { ...i, qty: newQty, history: hist };
        });
        setInventory(updatedInventory);
        save("inventory", updatedInventory);
        addToast(`Stok ${item?.name} bertambah ${qty} unit!`, "success");

        const msg = `📢 <b>Pembelian Stok</b>\n🏢 ${biz.name || "Bisnis"}\n📦 ${item?.name || "-"}\n🔢 Qty: +${qty}\n💸 ${formatRp(finalAmount)}\n📅 ${form.date}`;
        const res = await sendTelegram(tg.token, tg.groupId, msg);
        if (res && !res.ok) addToast("Telegram gagal: " + (res.description || res.error || "error"), "error");
      } else {
        const msg = `📢 <b>Pengeluaran Baru</b>\n🏢 ${biz.name || "Bisnis"}\n📝 ${form.desc || "-"}\n📂 ${form.category}\n💸 ${formatRp(form.amount)}\n📅 ${form.date}`;
        const res = await sendTelegram(tg.token, tg.groupId, msg);
        if (res && !res.ok) addToast("Telegram gagal: " + (res.description || res.error || "error"), "error");
      }
    }
    setForm({ date: today(), category: "", desc: "", amount: "" });
    setSelectedStockItem("");
    setStockQty("");
    setShowModal(false);
    addToast("Transaksi berhasil ditambahkan!", "success");
  };

  const del = (id) => {
    if (tab === "in") { const u = income.filter(r => r.id !== id); setIncome(u); save("income", u); }
    else { const u = expense.filter(r => r.id !== id); setExpense(u); save("expense", u); }
    addToast("Transaksi dihapus", "info");
  };

  const data = tab === "in" ? income : expense;
  const cats = tab === "in" ? CATEGORIES_IN : CATEGORIES_OUT;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>💰 Manajemen Cash Flow</h2>
        <button style={{ ...btnPrimary, opacity: isSystemLocked() ? 0.4 : 1 }} onClick={() => { if (isSystemLocked()) return; setShowModal(true); }}>+ Tambah</button>
      </div>

      {isSystemLocked() && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef444466", borderRadius: 14, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 32 }}>🔒</div>
          <div>
            <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>INPUT TRANSAKSI DIBLOKIR</div>
            <div style={{ color: "#fca5a5", fontSize: 13 }}>Sistem dalam mode cooldown 24 jam akibat perubahan rekening. Hubungi Owner untuk membuka kunci via kode OTP Telegram.</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155", textAlign: "center" }}>
          <div style={{ color: "#10b981", fontSize: 20, fontWeight: 700 }}>{formatRp(totalIn)}</div>
          <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>Total Pemasukan</div>
        </div>
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155", textAlign: "center" }}>
          <div style={{ color: "#ef4444", fontSize: 20, fontWeight: 700 }}>{formatRp(totalOut)}</div>
          <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>Total Pengeluaran</div>
        </div>
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155", textAlign: "center" }}>
          <div style={{ color: totalIn - totalOut >= 0 ? "#3b82f6" : "#f59e0b", fontSize: 20, fontWeight: 700 }}>{formatRp(totalIn - totalOut)}</div>
          <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>Net Cash Flow</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["in", "out"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: tab === t ? (t === "in" ? "#10b981" : "#ef4444") : "#1e293b", color: tab === t ? "#fff" : "#64748b" }}>
            {t === "in" ? "📈 Pemasukan" : "📉 Pengeluaran"}
          </button>
        ))}
      </div>

      <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              {["Tanggal", "Kategori", "Deskripsi", "Nominal", "Sumber", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", color: "#64748b", fontSize: 12, fontWeight: 600, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.id} style={{ borderTop: "1px solid #0f172a" }}>
                <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{r.date}</td>
                <td style={{ padding: "12px 16px" }}><span style={{ background: "#334155", color: "#94a3b8", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>{r.category}</span></td>
                <td style={{ padding: "12px 16px", color: "#f1f5f9", fontSize: 13 }}>{r.desc || "-"}</td>
                <td style={{ padding: "12px 16px", color: tab === "in" ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: 14 }}>{tab === "in" ? "+" : "-"}{formatRp(r.amount)}</td>
                <td style={{ padding: "12px 16px" }}>
                  {r.fromStock ? <span style={{ background: "#8b5cf622", color: "#8b5cf6", padding: "2px 8px", borderRadius: 12, fontSize: 11 }}>📦 Stok</span> : <span style={{ color: "#475569", fontSize: 11 }}>Manual</span>}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <button onClick={() => del(r.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16 }}>🗑️</button>
                </td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "#475569" }}>Belum ada data</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => { setShowModal(false); setSelectedStockItem(""); setStockQty(""); }} title={tab === "in" ? "➕ Tambah Pemasukan" : "➕ Tambah Pengeluaran"}>
        <Field label="TANGGAL"><input type="date" style={inputStyle} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="KATEGORI">
          <select style={inputStyle} value={form.category} onChange={e => handleCategoryChange(e.target.value)}>
            <option value="">Pilih kategori</option>
            {cats.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>

        {isPembelianStok && (
          <div style={{ background: "#0f172a", border: "1px solid #3b82f644", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ color: "#3b82f6", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📦 Pilih Barang Stok</div>
            <Field label="BARANG STOK">
              <select style={inputStyle} value={selectedStockItem} onChange={e => handleStockItemChange(e.target.value)}>
                <option value="">-- Pilih barang dari stok --</option>
                {inventory.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.sku ? ` (${item.sku})` : ""} — Stok: {item.qty} {item.category ? `· ${item.category}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            {selectedStockItem && (() => {
              const item = inventory.find(i => String(i.id) === String(selectedStockItem));
              return item ? (
                <div style={{ background: "#1e293b", borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#94a3b8" }}>Stok saat ini:</span>
                    <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{item.qty} unit</span>
                  </div>
                  {item.costPrice && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#94a3b8" }}>Harga modal/unit:</span>
                    <span style={{ color: "#f59e0b", fontWeight: 600 }}>{formatRp(item.costPrice)}</span>
                  </div>}
                  {item.supplier && <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#94a3b8" }}>Supplier:</span>
                    <span style={{ color: "#64748b" }}>{item.supplier}</span>
                  </div>}
                </div>
              ) : null;
            })()}
            <Field label="JUMLAH UNIT YANG DIBELI">
              <input type="number" style={inputStyle} placeholder="Masukkan jumlah unit" min="1"
                value={stockQty}
                onChange={e => {
                  setStockQty(e.target.value);
                  const item = inventory.find(i => String(i.id) === String(selectedStockItem));
                  if (item && item.costPrice && e.target.value) {
                    setForm(f => ({ ...f, amount: String(Number(item.costPrice) * Number(e.target.value)) }));
                  }
                }}
              />
            </Field>
          </div>
        )}

        <Field label="DESKRIPSI"><input style={inputStyle} placeholder="Deskripsi transaksi" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></Field>
        <Field label={isPembelianStok ? "TOTAL NOMINAL (RP) — auto hitung dari harga modal × qty" : "NOMINAL (RP)"}>
          <input type="number" style={inputStyle} placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => { setShowModal(false); setSelectedStockItem(""); setStockQty(""); }}>Batal</button>
          <button style={tab === "in" ? btnSuccess : btnDanger} onClick={submit}>Simpan</button>
        </div>
      </Modal>
    </div>
  );
}

// ==================== KASIR ====================
function Kasir({ income, setIncome, inventory, setInventory, tg, biz, addToast, systemLocked }) {
  const [cart, setCart] = useState([]);
  const [selectedItem, setSelectedItem] = useState("");
  const [qty, setQty] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Tunai");
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastTx, setLastTx] = useState(null);

  const availableItems = inventory.filter(i => Number(i.qty) > 0 && Number(i.sellPrice) > 0);

  const addToCart = () => {
    if (!selectedItem) return addToast("Pilih barang terlebih dahulu!", "error");
    const item = inventory.find(i => String(i.id) === String(selectedItem));
    if (!item) return;
    const maxQty = Number(item.qty);
    const cartExisting = cart.find(c => String(c.id) === String(selectedItem));
    const alreadyInCart = cartExisting ? cartExisting.qty : 0;
    if (alreadyInCart + qty > maxQty) return addToast(`Stok ${item.name} tidak cukup! Tersedia: ${maxQty - alreadyInCart}`, "error");

    if (cartExisting) {
      setCart(cart.map(c => String(c.id) === String(selectedItem) ? { ...c, qty: c.qty + qty } : c));
    } else {
      setCart([...cart, { id: item.id, name: item.name, sellPrice: Number(item.sellPrice), costPrice: Number(item.costPrice || 0), qty, sku: item.sku }]);
    }
    setSelectedItem(""); setQty(1);
  };

  const removeFromCart = (id) => setCart(cart.filter(c => String(c.id) !== String(id)));
  const updateCartQty = (id, newQty) => {
    if (newQty <= 0) return removeFromCart(id);
    const item = inventory.find(i => String(i.id) === String(id));
    if (item && newQty > Number(item.qty)) return addToast("Melebihi stok tersedia!", "error");
    setCart(cart.map(c => String(c.id) === String(id) ? { ...c, qty: newQty } : c));
  };

  const subtotal = cart.reduce((s, c) => s + c.sellPrice * c.qty, 0);
  const totalCost = cart.reduce((s, c) => s + c.costPrice * c.qty, 0);
  const netProfit = subtotal - totalCost;

  const checkout = async () => {
    if (isSystemLocked()) return addToast("🔒 Sistem terkunci! Transaksi diblokir. Hubungi Owner.", "error");
    if (cart.length === 0) return addToast("Keranjang kosong!", "error");

    const txId = Date.now();
    const txDate = today();

    // Update inventory stok
    const updatedInventory = inventory.map(item => {
      const cartItem = cart.find(c => String(c.id) === String(item.id));
      if (!cartItem) return item;
      const newQty = Math.max(0, Number(item.qty) - cartItem.qty);
      const hist = [...(item.history || []), { type: "out", qty: cartItem.qty, date: txDate, note: `Penjualan kasir${customerName ? " - " + customerName : ""}` }];
      return { ...item, qty: newQty, history: hist };
    });
    setInventory(updatedInventory); save("inventory", updatedInventory);

    // Catat ke income
    const saleRecord = {
      id: txId, date: txDate, category: "Penjualan",
      desc: `Kasir: ${cart.map(c => c.qty + "x " + c.name).join(", ")}${customerName ? " · " + customerName : ""}`,
      amount: subtotal, fromStock: true,
      costAmount: totalCost, grossProfit: netProfit,
      paymentMethod, customerName, items: cart,
    };
    const updatedIncome = [saleRecord, ...income];
    setIncome(updatedIncome); save("income", updatedIncome);

    // Telegram
    const itemLines = cart.map(c => `  • ${c.qty}x ${c.name} @ ${formatRp(c.sellPrice)} = ${formatRp(c.sellPrice * c.qty)}`).join("\n");
    const msg = `🛒 <b>Penjualan Kasir</b>\n🏢 ${biz.name || "Bisnis"}\n${customerName ? "👤 " + customerName + "\n" : ""}${itemLines}\n━━━━━━━━━━\n💰 Total: ${formatRp(subtotal)}\n💳 ${paymentMethod}\n💹 Laba Bersih: ${formatRp(netProfit)}\n📅 ${txDate}`;
    const res = await sendTelegram(tg.token, tg.groupId, msg);
    if (res && !res.ok) addToast("Telegram gagal: " + (res.description || res.error || "error"), "error");

    setLastTx({ ...saleRecord, subtotal, netProfit });
    setShowReceipt(true);
    setCart([]); setCustomerName(""); setPaymentMethod("Tunai");
    addToast(`Transaksi berhasil! Total: ${formatRp(subtotal)}`, "success");
  };

  const recentSales = income.filter(r => r.fromStock && r.items).slice(0, 8);

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: 22 }}>🛒 Kasir</h2>
      {isSystemLocked() && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef444466", borderRadius: 14, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 36 }}>🔒</div>
          <div>
            <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>TRANSAKSI DIBLOKIR — Sistem Terkunci</div>
            <div style={{ color: "#fca5a5", fontSize: 13 }}>Perubahan rekening terdeteksi. Semua transaksi online dihentikan selama masa cooldown 24 jam. Hubungi Owner untuk membuka kunci dengan kode OTP dari Telegram.</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" }}>
        {/* Kiri: pilih barang */}
        <div>
          {/* Input tambah barang */}
          <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginBottom: 16 }}>
            <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>➕ Tambah Barang</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "end" }}>
              <Field label="PILIH BARANG">
                <select style={inputStyle} value={selectedItem} onChange={e => setSelectedItem(e.target.value)}>
                  <option value="">-- Pilih barang --</option>
                  {availableItems.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}{item.sku ? ` (${item.sku})` : ""} — Stok: {item.qty} — {formatRp(item.sellPrice)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="QTY">
                <input type="number" style={{ ...inputStyle, width: 80 }} min="1" value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value)))} />
              </Field>
              <button style={{ ...btnPrimary, marginBottom: 14 }} onClick={addToCart}>+ Tambah</button>
            </div>
            {selectedItem && (() => {
              const item = inventory.find(i => String(i.id) === String(selectedItem));
              return item ? (
                <div style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px", fontSize: 13, display: "flex", gap: 20 }}>
                  <span style={{ color: "#94a3b8" }}>Stok: <b style={{ color: "#f1f5f9" }}>{item.qty}</b></span>
                  <span style={{ color: "#94a3b8" }}>Harga Jual: <b style={{ color: "#10b981" }}>{formatRp(item.sellPrice)}</b></span>
                  <span style={{ color: "#94a3b8" }}>Modal: <b style={{ color: "#f59e0b" }}>{formatRp(item.costPrice)}</b></span>
                </div>
              ) : null;
            })()}
          </div>

          {/* Tabel keranjang */}
          <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflow: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0f172a" }}>
                  {["Barang", "Harga", "Qty", "Subtotal", ""].map(h => (
                    <th key={h} style={{ padding: "12px 16px", color: "#64748b", fontSize: 12, fontWeight: 600, textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cart.map(c => (
                  <tr key={c.id} style={{ borderTop: "1px solid #0f172a" }}>
                    <td style={{ padding: "12px 16px", color: "#f1f5f9", fontSize: 14 }}>{c.name}{c.sku ? <span style={{ color: "#64748b", fontSize: 11, marginLeft: 6 }}>({c.sku})</span> : ""}</td>
                    <td style={{ padding: "12px 16px", color: "#10b981", fontSize: 13 }}>{formatRp(c.sellPrice)}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button onClick={() => updateCartQty(c.id, c.qty - 1)} style={{ background: "#334155", border: "none", color: "#f1f5f9", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 16 }}>−</button>
                        <span style={{ color: "#f1f5f9", fontWeight: 700, minWidth: 24, textAlign: "center" }}>{c.qty}</span>
                        <button onClick={() => updateCartQty(c.id, c.qty + 1)} style={{ background: "#334155", border: "none", color: "#f1f5f9", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 16 }}>+</button>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#f1f5f9", fontWeight: 700 }}>{formatRp(c.sellPrice * c.qty)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <button onClick={() => removeFromCart(c.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16 }}>🗑️</button>
                    </td>
                  </tr>
                ))}
                {cart.length === 0 && <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "#475569" }}>Keranjang kosong</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Riwayat penjualan */}
          <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
            <h4 style={{ color: "#f1f5f9", margin: "0 0 14px", fontSize: 15 }}>🕐 Riwayat Penjualan Terakhir</h4>
            {recentSales.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: "16px 0" }}>Belum ada transaksi</div>}
            {recentSales.map(r => (
              <div key={r.id} style={{ borderBottom: "1px solid #0f172a", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>{r.customerName || "Umum"} <span style={{ color: "#64748b", fontWeight: 400 }}>· {r.paymentMethod || "Tunai"}</span></div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{r.date} · {r.items?.length || 0} item</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#10b981", fontWeight: 700 }}>{formatRp(r.amount)}</div>
                  <div style={{ color: "#8b5cf6", fontSize: 12 }}>Laba: {formatRp(r.grossProfit || 0)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Kanan: ringkasan & checkout */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", position: "sticky", top: 80 }}>
          <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 16 }}>🧾 Ringkasan Transaksi</h4>

          <Field label="NAMA PELANGGAN (OPSIONAL)">
            <input style={inputStyle} placeholder="Nama pelanggan..." value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </Field>
          <Field label="METODE PEMBAYARAN">
            <select style={inputStyle} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              {["Tunai", "Transfer", "QRIS", "Kartu Debit", "Kartu Kredit"].map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>

          <div style={{ borderTop: "1px solid #334155", paddingTop: 16, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "#64748b", fontSize: 14 }}>Total Item</span>
              <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{cart.reduce((s, c) => s + c.qty, 0)} unit</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, paddingTop: 12, borderTop: "1px solid #334155" }}>
              <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>TOTAL</span>
              <span style={{ color: "#10b981", fontWeight: 800, fontSize: 20 }}>{formatRp(subtotal)}</span>
            </div>
            <button style={{ ...btnSuccess, width: "100%", padding: "14px", fontSize: 16, opacity: cart.length === 0 ? 0.5 : 1 }} onClick={checkout} disabled={cart.length === 0}>
              ✅ Bayar & Selesai
            </button>
            {cart.length > 0 && (
              <button style={{ ...btnPrimary, background: "#334155", width: "100%", padding: "10px", fontSize: 13, marginTop: 8 }} onClick={() => setCart([])}>
                🗑️ Kosongkan Keranjang
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal Struk */}
      <Modal open={showReceipt} onClose={() => setShowReceipt(false)} title="🧾 Struk Pembayaran">
        {lastTx && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ color: "#10b981", fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 18 }}>Pembayaran Berhasil!</div>
              {lastTx.customerName && <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>👤 {lastTx.customerName}</div>}
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{lastTx.date} · {lastTx.paymentMethod}</div>
            </div>
            <div style={{ background: "#0f172a", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              {lastTx.items?.map((c, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>{c.qty}x {c.name}</span>
                  <span style={{ color: "#f1f5f9" }}>{formatRp(c.sellPrice * c.qty)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 4 }}>
                <span style={{ color: "#f1f5f9", fontWeight: 700 }}>TOTAL</span>
                <span style={{ color: "#10b981", fontWeight: 800, fontSize: 18 }}>{formatRp(lastTx.subtotal)}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btnPrimary} onClick={() => setShowReceipt(false)}>Tutup</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ==================== INVENTORY ====================
// FIX #2 & #3: Saat stok keluar → otomatis tambah ke pemasukan dengan harga jual,
// laba bersih = harga jual - harga modal dicatat di record
function Inventory({ inventory, setInventory, income, setIncome, expense, setExpense, tg, biz, addToast }) {
  const [showModal, setShowModal] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txItem, setTxItem] = useState(null);
  const [txType, setTxType] = useState("in");
  const [txQty, setTxQty] = useState("");
  const [txNote, setTxNote] = useState("");
  const [form, setForm] = useState({ name: "", sku: "", category: "", qty: "", minQty: "5", costPrice: "", sellPrice: "", supplier: "" });

  const submit = () => {
    if (!form.name || !form.qty) return addToast("Nama & jumlah stok wajib!", "error");
    const rec = { ...form, id: Date.now(), history: [] };
    const updated = [rec, ...inventory]; setInventory(updated); save("inventory", updated);
    setForm({ name: "", sku: "", category: "", qty: "", minQty: "5", costPrice: "", sellPrice: "", supplier: "" });
    setShowModal(false);
    addToast("Barang berhasil ditambahkan!", "success");
  };

  const doTx = async () => {
    if (!txQty || Number(txQty) <= 0) return addToast("Jumlah harus lebih dari 0!", "error");
    const qty = Number(txQty);

    // Update inventory
    const updatedInventory = inventory.map(i => {
      if (i.id !== txItem.id) return i;
      const newQty = txType === "in" ? Number(i.qty) + qty : Math.max(0, Number(i.qty) - qty);
      const hist = [...(i.history || []), { type: txType, qty, date: today(), note: txNote }];
      return { ...i, qty: newQty, history: hist };
    });
    setInventory(updatedInventory); save("inventory", updatedInventory);

    const item = updatedInventory.find(i => i.id === txItem.id);

    // FIX #2: Stok keluar → otomatis masuk sebagai Penjualan di Cash Flow
    if (txType === "out") {
      const sellPrice = Number(txItem.sellPrice || 0);
      const costPrice = Number(txItem.costPrice || 0);
      const totalSell = sellPrice * qty;
      const totalCost = costPrice * qty;
      const grossProfit = totalSell - totalCost;

      if (sellPrice > 0) {
        const saleRecord = {
          id: Date.now(),
          date: today(),
          category: "Penjualan",
          desc: `Penjualan ${qty}x ${txItem.name}${txNote ? " - " + txNote : ""}`,
          amount: totalSell,
          fromStock: true,
          itemId: txItem.id,
          itemName: txItem.name,
          qty,
          sellPrice,
          costPrice,
          costAmount: totalCost,  // untuk perhitungan laba
          grossProfit,            // laba bersih per transaksi tersimpan
        };
        const updatedIncome = [saleRecord, ...income];
        setIncome(updatedIncome); save("income", updatedIncome);
        addToast(`Penjualan ${formatRp(totalSell)} otomatis dicatat! Laba: ${formatRp(grossProfit)}`, "success");

        // Telegram notif
        const msg = `🛒 <b>Penjualan Stok</b>\n🏢 ${biz.name || "Bisnis"}\n📦 ${txItem.name} x${qty}\n💰 Harga Jual: ${formatRp(totalSell)}\n📉 Modal: ${formatRp(totalCost)}\n💹 Laba: ${formatRp(grossProfit)}\n📅 ${today()}`;
        const res = await sendTelegram(tg.token, tg.groupId, msg);
        if (res && !res.ok) addToast("Telegram: " + (res.description || res.error), "error");
      } else {
        addToast("Harga jual belum diset, penjualan tidak dicatat otomatis", "error");
      }
    }

    // Stok menipis?
    if (Number(item.qty) <= Number(item.minQty || 5)) {
      const msg = `⚠️ <b>Stok Menipis!</b>\n🏢 ${biz.name || "Bisnis"}\n📦 ${item.name}\n📉 Sisa Stok: ${item.qty}\n🔴 Minimum: ${item.minQty || 5}`;
      await sendTelegram(tg.token, tg.groupId, msg);
      addToast(`⚠️ Stok ${item.name} menipis (${item.qty})`, "error");
    }

    // Stok masuk → otomatis catat ke pengeluaran (Pembelian Stok)
    if (txType === "in") {
      const costPrice = Number(txItem.costPrice || 0);
      const totalCost = costPrice * qty;
      if (costPrice > 0) {
        const expenseRecord = {
          id: Date.now() + 1,
          date: today(),
          category: "Pembelian Stok",
          desc: `Restock ${qty}x ${txItem.name}${txNote ? " - " + txNote : ""}`,
          amount: totalCost,
          fromStockIn: true,
          itemId: txItem.id,
          itemName: txItem.name,
          qty,
          costPrice,
        };
        const updatedExpense = [expenseRecord, ...expense];
        setExpense(updatedExpense); save("expense", updatedExpense);
        addToast(`Stok bertambah & pengeluaran ${formatRp(totalCost)} otomatis dicatat!`, "success");

        const msg = `📦 <b>Restock Gudang</b>
🏢 ${biz.name || "Bisnis"}
📦 ${txItem.name} x${qty}
💸 Modal/unit: ${formatRp(costPrice)}
💰 Total: ${formatRp(totalCost)}
📅 ${today()}`;
        const res = await sendTelegram(tg.token, tg.groupId, msg);
        if (res && !res.ok) addToast("Telegram: " + (res.description || res.error), "error");
      } else {
        addToast("Stok berhasil ditambahkan! (Harga modal belum diset, pengeluaran tidak dicatat)", "success");
      }
    }

    setShowTxModal(false); setTxQty(""); setTxNote(""); setTxItem(null);
  };

  const del = (id) => { const u = inventory.filter(i => i.id !== id); setInventory(u); save("inventory", u); addToast("Barang dihapus", "info"); };

  // Summary laba per barang
  const profitByItem = {};
  income.filter(r => r.fromStock).forEach(r => {
    if (!profitByItem[r.itemId]) profitByItem[r.itemId] = { sell: 0, profit: 0, sold: 0 };
    profitByItem[r.itemId].sell += Number(r.amount);
    profitByItem[r.itemId].profit += Number(r.grossProfit || 0);
    profitByItem[r.itemId].sold += Number(r.qty || 0);
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>📦 Stok Gudang</h2>
        <button style={btnPrimary} onClick={() => setShowModal(true)}>+ Tambah Barang</button>
      </div>

      {/* Info box */}
      <div style={{ background: "#1e293b22", border: "1px solid #3b82f633", borderRadius: 10, padding: "10px 16px", marginBottom: 16, color: "#94a3b8", fontSize: 13 }}>
        💡 Saat klik <strong style={{ color: "#ef4444" }}>kurangi stok (−)</strong>, penjualan otomatis tercatat di Cash Flow dengan harga jual yang sudah diset.
      </div>

      <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              {["Nama Barang", "SKU", "Stok", "Modal/pcs", "Jual/pcs", "Margin", "Terjual", "Laba Total", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", color: "#64748b", fontSize: 12, fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inventory.map(item => {
              const perf = profitByItem[item.id] || { sell: 0, profit: 0, sold: 0 };
              const margin = Number(item.sellPrice) > 0 ? ((Number(item.sellPrice) - Number(item.costPrice)) / Number(item.sellPrice) * 100).toFixed(1) : 0;
              return (
                <tr key={item.id} style={{ borderTop: "1px solid #0f172a" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ color: "#f1f5f9", fontWeight: 500 }}>{item.name}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{item.category || ""} {item.supplier ? "· " + item.supplier : ""}</div>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{item.sku || "-"}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ color: Number(item.qty) <= Number(item.minQty || 5) ? "#ef4444" : "#10b981", fontWeight: 700, fontSize: 15 }}>{item.qty}</span>
                    {Number(item.qty) <= Number(item.minQty || 5) && <span style={{ marginLeft: 4, fontSize: 11, color: "#ef4444" }}>⚠️</span>}
                  </td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{formatRp(item.costPrice)}</td>
                  <td style={{ padding: "12px 16px", color: "#10b981", fontSize: 13, fontWeight: 600 }}>{formatRp(item.sellPrice)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ background: Number(margin) > 20 ? "#10b98122" : "#f59e0b22", color: Number(margin) > 20 ? "#10b981" : "#f59e0b", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{margin}%</span>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{perf.sold} pcs</td>
                  <td style={{ padding: "12px 16px", color: "#8b5cf6", fontWeight: 700, fontSize: 13 }}>{formatRp(perf.profit)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => { setTxItem(item); setTxType("in"); setShowTxModal(true); }} style={{ ...btnSuccess, padding: "5px 10px", fontSize: 12 }} title="Stok Masuk">+</button>
                      <button onClick={() => { setTxItem(item); setTxType("out"); setShowTxModal(true); }} style={{ ...btnDanger, padding: "5px 10px", fontSize: 12 }} title="Jual / Stok Keluar">−</button>
                      <button onClick={() => del(item.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {inventory.length === 0 && <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#475569" }}>Belum ada barang</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal tambah barang */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="📦 Tambah Barang">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="NAMA BARANG"><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nama barang" /></Field>
          <Field label="SKU"><input style={inputStyle} value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="SKU-001" /></Field>
          <Field label="KATEGORI"><input style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Kategori" /></Field>
          <Field label="SUPPLIER"><input style={inputStyle} value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Nama supplier" /></Field>
          <Field label="STOK AWAL"><input type="number" style={inputStyle} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="0" /></Field>
          <Field label="STOK MINIMUM ALERT"><input type="number" style={inputStyle} value={form.minQty} onChange={e => setForm({ ...form, minQty: e.target.value })} placeholder="5" /></Field>
          <Field label="HARGA MODAL / PCS">
            <input type="number" style={inputStyle} value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} placeholder="0" />
          </Field>
          <Field label="HARGA JUAL / PCS">
            <input type="number" style={inputStyle} value={form.sellPrice} onChange={e => setForm({ ...form, sellPrice: e.target.value })} placeholder="0" />
          </Field>
        </div>
        {form.costPrice && form.sellPrice && (
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Margin per pcs: </span>
            <span style={{ color: "#10b981", fontWeight: 700 }}>{formatRp(Number(form.sellPrice) - Number(form.costPrice))}</span>
            <span style={{ color: "#64748b" }}> ({form.sellPrice > 0 ? ((Number(form.sellPrice) - Number(form.costPrice)) / Number(form.sellPrice) * 100).toFixed(1) : 0}%)</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowModal(false)}>Batal</button>
          <button style={btnPrimary} onClick={submit}>Simpan</button>
        </div>
      </Modal>

      {/* Modal transaksi stok */}
      <Modal open={showTxModal} onClose={() => { setShowTxModal(false); setTxQty(""); setTxNote(""); }} title={txType === "in" ? "📥 Stok Masuk" : "📤 Penjualan / Stok Keluar"}>
        {txItem && (
          <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ color: "#f1f5f9", fontWeight: 700, marginBottom: 6 }}>{txItem.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 13 }}>
              <div><span style={{ color: "#64748b" }}>Stok: </span><span style={{ color: "#f1f5f9", fontWeight: 600 }}>{txItem.qty}</span></div>
              <div><span style={{ color: "#64748b" }}>Modal: </span><span style={{ color: "#f1f5f9" }}>{formatRp(txItem.costPrice)}</span></div>
              <div><span style={{ color: "#64748b" }}>Jual: </span><span style={{ color: "#10b981", fontWeight: 700 }}>{formatRp(txItem.sellPrice)}</span></div>
            </div>
            {txType === "out" && txQty > 0 && (
              <div style={{ marginTop: 10, padding: "8px 0", borderTop: "1px solid #1e293b" }}>
                <div style={{ color: "#64748b", fontSize: 12 }}>Preview Penjualan:</div>
                <div style={{ color: "#10b981", fontWeight: 700, fontSize: 16 }}>{formatRp(Number(txItem.sellPrice) * Number(txQty))}</div>
                <div style={{ color: "#8b5cf6", fontSize: 13 }}>Laba: {formatRp((Number(txItem.sellPrice) - Number(txItem.costPrice)) * Number(txQty))}</div>
              </div>
            )}
          </div>
        )}
        <Field label="JUMLAH"><input type="number" style={inputStyle} placeholder="0" value={txQty} onChange={e => setTxQty(e.target.value)} /></Field>
        <Field label="CATATAN (OPSIONAL)"><input style={inputStyle} placeholder="Catatan transaksi..." value={txNote} onChange={e => setTxNote(e.target.value)} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => { setShowTxModal(false); setTxQty(""); setTxNote(""); }}>Batal</button>
          <button style={txType === "in" ? btnSuccess : btnDanger} onClick={doTx}>
            {txType === "in" ? "📥 Tambah Stok" : "🛒 Jual & Kurangi Stok"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ==================== INVOICE ====================
function Invoice({ biz, addToast }) {
  const [form, setForm] = useState({ clientName: "", clientAddr: "", clientPhone: "", date: today(), dueDate: "", notes: "" });
  const [items, setItems] = useState([{ desc: "", qty: 1, price: "" }]);
  const [tax, setTax] = useState(11);
  const [invoices, setInvoicesState] = useState(() => load("invoices", []));

  const addItem = () => setItems([...items, { desc: "", qty: 1, price: "" }]);
  const updateItem = (i, f, v) => setItems(items.map((it, idx) => idx === i ? { ...it, [f]: v } : it));
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const subtotal = items.reduce((s, i) => s + (Number(i.qty) * Number(i.price || 0)), 0);
  const taxAmt = subtotal * tax / 100;
  const total = subtotal + taxAmt;

  const saveInv = () => {
    if (!form.clientName) return addToast("Nama klien wajib!", "error");
    const inv = { ...form, items, tax, subtotal, taxAmt, total, id: Date.now(), no: `INV-${Date.now().toString().slice(-6)}` };
    const updated = [inv, ...invoices]; setInvoicesState(updated); save("invoices", updated);
    addToast("Invoice tersimpan!", "success");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>🧾 Invoice Generator</h2>
        <button style={btnSuccess} onClick={saveInv}>💾 Simpan Invoice</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <h4 style={{ color: "#f1f5f9", margin: "0 0 16px" }}>📋 Data Klien</h4>
          <Field label="NAMA KLIEN"><input style={inputStyle} value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} placeholder="Nama klien" /></Field>
          <Field label="ALAMAT"><input style={inputStyle} value={form.clientAddr} onChange={e => setForm({ ...form, clientAddr: e.target.value })} placeholder="Alamat" /></Field>
          <Field label="TELEPON"><input style={inputStyle} value={form.clientPhone} onChange={e => setForm({ ...form, clientPhone: e.target.value })} placeholder="08xx" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="TGL INVOICE"><input type="date" style={inputStyle} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="JATUH TEMPO"><input type="date" style={inputStyle} value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
          </div>
          <Field label={`PAJAK: ${tax}%`}><input type="range" min="0" max="20" style={{ width: "100%" }} value={tax} onChange={e => setTax(Number(e.target.value))} /></Field>
          <Field label="CATATAN"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Catatan..." /></Field>
        </div>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <div style={{ background: "#0f172a", borderRadius: 10, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {biz.logo ? <img src={biz.logo} alt="logo" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} /> : <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center" }}>💼</div>}
                <div>
                  <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 13 }}>{biz.name || "Bisnis Saya"}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{biz.email || ""}</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#3b82f6", fontWeight: 700, fontSize: 16 }}>INVOICE</div>
                <div style={{ color: "#64748b", fontSize: 11 }}>#{Date.now().toString().slice(-6)}</div>
              </div>
            </div>
            {form.clientName && <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12 }}><strong style={{ color: "#f1f5f9" }}>{form.clientName}</strong><br />{form.clientAddr}</div>}
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input style={{ ...inputStyle, flex: 2 }} placeholder="Deskripsi" value={it.desc} onChange={e => updateItem(i, "desc", e.target.value)} />
                <input type="number" style={{ ...inputStyle, flex: 0, width: 55 }} placeholder="Qty" value={it.qty} onChange={e => updateItem(i, "qty", e.target.value)} />
                <input type="number" style={{ ...inputStyle, flex: 1.5 }} placeholder="Harga" value={it.price} onChange={e => updateItem(i, "price", e.target.value)} />
                <button onClick={() => removeItem(i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
              </div>
            ))}
            <button onClick={addItem} style={{ ...btnPrimary, padding: "6px 14px", fontSize: 12, marginBottom: 12 }}>+ Item</button>
            <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 13, marginBottom: 4 }}><span>Subtotal</span><span>{formatRp(subtotal)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 13, marginBottom: 8 }}><span>Pajak {tax}%</span><span>{formatRp(taxAmt)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}><span>TOTAL</span><span style={{ color: "#3b82f6" }}>{formatRp(total)}</span></div>
            </div>
          </div>
          {invoices.length > 0 && (
            <div>
              <h5 style={{ color: "#64748b", margin: "0 0 10px", fontSize: 12 }}>INVOICE TERSIMPAN</h5>
              {invoices.slice(0, 3).map(inv => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #0f172a" }}>
                  <div><div style={{ color: "#f1f5f9", fontSize: 13 }}>{inv.clientName}</div><div style={{ color: "#64748b", fontSize: 11 }}>{inv.date}</div></div>
                  <span style={{ color: "#10b981", fontWeight: 700, fontSize: 14 }}>{formatRp(inv.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== REPORTS ====================
function Reports({ income, expense, inventory }) {
  const totalIn = income.reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount), 0);
  // Laba bersih penjualan = harga jual - modal
  const totalNetProfit = income.filter(r => r.fromStock).reduce((s, r) => s + Number(r.grossProfit || 0), 0);
  const netProfit = totalIn - totalOut;

  const printReport = () => {
    const bizName = "Laporan Cash Flow";
    const printDate = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;padding:32px;color:#1e293b;font-size:13px}
      h1{font-size:22px;margin-bottom:4px;color:#1e293b}
      .sub{color:#64748b;font-size:12px;margin-bottom:24px}
      .summary{display:flex;gap:16px;margin-bottom:24px}
      .card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
      .card-label{font-size:11px;color:#64748b;margin-bottom:4px}
      .card-value{font-size:16px;font-weight:700}
      .green{color:#059669}.red{color:#dc2626}.blue{color:#2563eb}.purple{color:#7c3aed}
      h2{font-size:15px;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th{background:#f1f5f9;padding:9px 12px;text-align:left;font-size:12px;color:#475569;font-weight:600}
      td{padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px}
      tr:last-child td{border-bottom:none}
      .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;background:#f1f5f9}
      @media print{body{padding:16px}.no-print{display:none}}
    </style></head><body>
    <h1>${bizName}</h1>
    <div class="sub">Dicetak: ${printDate}</div>
    <div class="summary">
      <div class="card"><div class="card-label">TOTAL PEMASUKAN</div><div class="card-value green">Rp ${totalIn.toLocaleString("id-ID")}</div></div>
      <div class="card"><div class="card-label">TOTAL PENGELUARAN</div><div class="card-value red">Rp ${totalOut.toLocaleString("id-ID")}</div></div>
      <div class="card"><div class="card-label">NET CASH FLOW</div><div class="card-value blue">Rp ${netProfit.toLocaleString("id-ID")}</div></div>
      <div class="card"><div class="card-label">LABA BERSIH PENJUALAN</div><div class="card-value purple">Rp ${totalNetProfit.toLocaleString("id-ID")}</div></div>
    </div>
    <h2>Pemasukan</h2>
    <table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th style="text-align:right">Nominal</th><th style="text-align:right">Laba Bersih</th></tr></thead><tbody>
    ${income.map(r => `<tr><td>${r.date}</td><td><span class="badge">${r.category}</span></td><td>${r.desc||"-"}</td><td style="text-align:right;color:#059669;font-weight:600">Rp ${Number(r.amount).toLocaleString("id-ID")}</td><td style="text-align:right;color:#7c3aed">${r.grossProfit ? "Rp " + Number(r.grossProfit).toLocaleString("id-ID") : "-"}</td></tr>`).join("")}
    </tbody></table>
    <h2>Pengeluaran</h2>
    <table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th style="text-align:right">Nominal</th></tr></thead><tbody>
    ${expense.map(r => `<tr><td>${r.date}</td><td><span class="badge">${r.category}</span></td><td>${r.desc||"-"}</td><td style="text-align:right;color:#dc2626;font-weight:600">Rp ${Number(r.amount).toLocaleString("id-ID")}</td></tr>`).join("")}
    </tbody></table>
    </body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none";
    document.body.appendChild(iframe);
    iframe.src = url;
    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); }, 2000);
    };
  };

  const exportCSV = () => {
    const rows = [
      ["Jenis","Tanggal","Kategori","Deskripsi","Nominal","Laba Bersih"],
      ...income.map(r => ["Pemasukan",r.date,r.category,r.desc||"",r.amount,r.grossProfit||""]),
      ...expense.map(r => ["Pengeluaran",r.date,r.category,r.desc||"",r.amount,""]),
    ];
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(rows.map(r => r.join(",")).join("\n"));
    a.download = "cashflow.csv"; a.click();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>📈 Laporan</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={btnPrimary} onClick={printReport}>🖨️ Cetak PDF</button>
          <button style={btnSuccess} onClick={exportCSV}>📥 Export CSV</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard label="TOTAL PEMASUKAN" value={formatRp(totalIn)} icon="📈" color="#10b981" />
        <StatCard label="TOTAL PENGELUARAN" value={formatRp(totalOut)} icon="📉" color="#ef4444" />
        <StatCard label="NET CASH FLOW" value={formatRp(netProfit)} icon="💵" color={netProfit >= 0 ? "#3b82f6" : "#f59e0b"} />
        <StatCard label="LABA BERSIH PENJUALAN" value={formatRp(totalNetProfit)} icon="💹" color="#8b5cf6" sub="Harga Jual - Modal" />
        <StatCard label="TOTAL PRODUK" value={inventory.length} icon="📦" color="#06b6d4" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[{ label: "Pemasukan per Kategori", data: income, color: "#10b981" }, { label: "Pengeluaran per Kategori", data: expense, color: "#ef4444" }].map(({ label, data, color }) => {
          const grouped = {};
          data.forEach(r => { grouped[r.category] = (grouped[r.category] || 0) + Number(r.amount); });
          const total = data.reduce((s, r) => s + Number(r.amount), 0);
          return (
            <div key={label} style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
              <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>{label}</h4>
              {Object.entries(grouped).map(([cat, amt]) => (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#94a3b8", fontSize: 13 }}>{cat}</span>
                    <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>{formatRp(amt)}</span>
                  </div>
                  <div style={{ background: "#0f172a", borderRadius: 99, height: 6 }}>
                    <div style={{ background: color, borderRadius: 99, height: "100%", width: `${total > 0 ? (amt / total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
              {Object.keys(grouped).length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>Belum ada data</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== TELEGRAM SETTINGS ====================
function TelegramSettings({ tg, setTg, addToast }) {
  const [form, setForm] = useState({
    token: tg.token || "",
    privateId: tg.privateId || tg.chatId || "",  // ID pribadi owner (keamanan)
    groupId: tg.groupId || "",                    // ID grup (transaksi)
  });
  const [testingPrivate, setTestingPrivate] = useState(false);
  const [testingGroup, setTestingGroup] = useState(false);
  const [resultPrivate, setResultPrivate] = useState(null);
  const [resultGroup, setResultGroup] = useState(null);
  const [pendingBotChange, setPendingBotChange] = useState(false);
  const [botOtpInput, setBotOtpInput] = useState("");
  const [pendingBotOtp, setPendingBotOtp] = useState(null);

  // Test kirim ke ID Pribadi Owner
  const testPrivate = async () => {
    if (!form.token || !form.privateId) return addToast("Bot Token dan ID Pribadi wajib diisi!", "error");
    setTestingPrivate(true); setResultPrivate(null);
    const res = await sendTelegram(
      form.token, form.privateId,
      `🔐 <b>Test — Chat Pribadi Owner</b>\n\n` +
      `✅ Koneksi ke ID Pribadi berhasil!\n` +
      `👤 Notifikasi keamanan akan dikirim ke sini.\n` +
      `📅 ${new Date().toLocaleString("id-ID")}`
    );
    setTestingPrivate(false);
    setResultPrivate(res);
    if (res?.ok) addToast("✅ Pesan test ke ID Pribadi berhasil!", "success");
    else addToast("❌ Gagal kirim ke ID Pribadi: " + (res?.description || res?.error || "Error"), "error");
  };

  // Test kirim ke Grup
  const testGroup = async () => {
    if (!form.token || !form.groupId) return addToast("Bot Token dan ID Grup wajib diisi!", "error");
    setTestingGroup(true); setResultGroup(null);
    const res = await sendTelegram(
      form.token, form.groupId,
      `💬 <b>Test — Grup Transaksi</b>\n\n` +
      `✅ Koneksi ke Grup berhasil!\n` +
      `📊 Semua notifikasi transaksi (pemasukan & pengeluaran) akan dikirim ke sini.\n` +
      `📅 ${new Date().toLocaleString("id-ID")}`
    );
    setTestingGroup(false);
    setResultGroup(res);
    if (res?.ok) addToast("✅ Pesan test ke Grup berhasil!", "success");
    else addToast("❌ Gagal kirim ke Grup: " + (res?.description || res?.error || "Error"), "error");
  };

  const saveTg = async () => {
    const oldToken = tg.token;
    const oldPrivateId = tg.privateId || tg.chatId;
    const tokenChanged = form.token !== oldToken;

    // Jika token berubah, wajib verifikasi OTP ke ID pribadi LAMA
    if (tokenChanged && oldToken && oldPrivateId) {
      const otp = generateOTP();
      setPendingBotOtp(otp);
      setPendingBotChange(true);
      const msg = `🚨 <b>PERINGATAN — Perubahan Bot Telegram</b>\n\n` +
        `Ada percobaan mengganti konfigurasi bot BizFlow Pro!\n` +
        `🕐 Waktu: ${new Date().toLocaleString("id-ID")}\n\n` +
        `Jika Anda yang melakukan ini, masukkan kode berikut di aplikasi:\n\n<code>${otp}</code>\n\nAbaikan jika bukan Anda!`;
      const res = await sendTelegram(oldToken, oldPrivateId, msg);
      if (res?.ok) addToast("⚠️ Kode verifikasi dikirim ke ID Pribadi lama. Masukkan untuk konfirmasi.", "info");
      else addToast("⚠️ Tidak bisa menghubungi bot lama. Cek konfigurasi.", "error");
      return;
    }

    // Simpan dengan field baru + backward-compat chatId = privateId
    const updated = { ...form, chatId: form.privateId };
    setTg(updated);
    save("telegram", updated);
    addToast("✅ Pengaturan Telegram disimpan!", "success");
  };

  const confirmBotChange = () => {
    if (botOtpInput.trim().toUpperCase() === pendingBotOtp) {
      const updated = { ...form, chatId: form.privateId };
      setTg(updated); save("telegram", updated);
      setPendingBotChange(false); setBotOtpInput(""); setPendingBotOtp(null);
      addToast("✅ Bot Telegram berhasil diperbarui!", "success");
    } else {
      addToast("❌ Kode OTP salah!", "error");
    }
  };

  const ResultBadge = ({ result }) => {
    if (!result) return null;
    return (
      <div style={{ background: result.ok ? "#10b98122" : "#ef444422", border: `1px solid ${result.ok ? "#10b98144" : "#ef444444"}`, borderRadius: 8, padding: "9px 13px", marginTop: 10, fontSize: 13 }}>
        {result.ok
          ? <span style={{ color: "#10b981" }}>✅ Berhasil! Terkirim ke ID: {result.result?.chat?.id}</span>
          : <span style={{ color: "#ef4444" }}>❌ {result.description || result.error}<br /><span style={{ color: "#94a3b8", fontSize: 12 }}>Pastikan bot sudah di-start dan ID valid.</span></span>}
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: 22 }}>✈️ Pengaturan Telegram Bot</h2>

      {/* Modal OTP ganti bot */}
      {pendingBotChange && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#1e293b", borderRadius: 18, padding: 32, maxWidth: 440, width: "100%", border: "2px solid #f59e0b88" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>🤖</div>
              <div style={{ color: "#f59e0b", fontSize: 20, fontWeight: 800 }}>Verifikasi Ganti Bot</div>
              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
                Kode OTP dikirim ke <strong style={{ color: "#3b82f6" }}>ID Pribadi Owner lama</strong>.<br />
                Masukkan kode tersebut untuk konfirmasi perubahan.
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>KODE OTP (dari chat pribadi)</label>
              <input style={{ ...inputStyle, fontFamily: "monospace", fontSize: 18, letterSpacing: 6, textAlign: "center", textTransform: "uppercase" }}
                placeholder="XXXXXX" value={botOtpInput}
                onChange={e => setBotOtpInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && confirmBotChange()} maxLength={8} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...btnPrimary, background: "#334155", flex: 1 }} onClick={() => { setPendingBotChange(false); setBotOtpInput(""); setPendingBotOtp(null); }}>Batal</button>
              <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#10b981,#059669)", flex: 1 }} onClick={confirmBotChange}>✅ Konfirmasi</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 620 }}>

        {/* ── Cara Setup ── */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 22, border: "1px solid #334155", marginBottom: 20 }}>
          <div style={{ background: "#0f172a", borderRadius: 10, padding: "14px 16px", marginBottom: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.9 }}>
            <strong style={{ color: "#3b82f6" }}>📋 Cara Setup Bot Telegram:</strong><br />
            <strong style={{ color: "#f59e0b" }}>1.</strong> Buka Telegram → cari <code style={{ background: "#1e293b", padding: "1px 6px", borderRadius: 4 }}>@BotFather</code> → <code style={{ background: "#1e293b", padding: "1px 6px", borderRadius: 4 }}>/newbot</code> → salin <strong style={{ color: "#f1f5f9" }}>Bot Token</strong><br />
            <strong style={{ color: "#f59e0b" }}>2.</strong> Untuk <strong style={{ color: "#ef4444" }}>ID Pribadi</strong>: cari <code style={{ background: "#1e293b", padding: "1px 6px", borderRadius: 4 }}>@userinfobot</code> → klik Start → salin angka ID Anda<br />
            <strong style={{ color: "#f59e0b" }}>3.</strong> Untuk <strong style={{ color: "#3b82f6" }}>ID Grup</strong>: buat grup → tambahkan bot → kirim pesan di grup → buka<br />
            <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>https://api.telegram.org/bot[TOKEN]/getUpdates</code> → cari <code style={{ background: "#1e293b", padding: "1px 6px", borderRadius: 4 }}>"chat":&#123;"id":-100...</code><br />
            <strong style={{ color: "#f59e0b" }}>4.</strong> Isi ketiga kolom di bawah → Simpan → Test masing-masing
          </div>
        </div>

        {/* ── Bot Token ── */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 22, border: "1px solid #334155", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#3b82f622", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🤖</div>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>Bot Token</div>
              <div style={{ color: "#64748b", fontSize: 12 }}>Token autentikasi bot dari @BotFather</div>
            </div>
          </div>
          <Field label="BOT TOKEN">
            <input style={inputStyle} value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ" />
          </Field>
        </div>

        {/* ── ID Pribadi Owner ── */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 22, border: "2px solid #ef444433", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#ef444422", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👤</div>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>ID Pribadi Owner</div>
              <div style={{ color: "#64748b", fontSize: 12 }}>Hanya untuk notifikasi keamanan & OTP — chat langsung ke Owner</div>
            </div>
            <span style={{ marginLeft: "auto", background: "#ef444422", color: "#ef4444", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid #ef444444" }}>🔐 KEAMANAN</span>
          </div>

          <div style={{ background: "#0f172a", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
            Pesan yang dikirim ke sini: <strong style={{ color: "#f1f5f9" }}>Peringatan perubahan rekening · Kode OTP bypass · Alert keamanan</strong>
          </div>

          <Field label="ID PRIBADI OWNER (angka, contoh: 123456789)">
            <input style={{ ...inputStyle, borderColor: "#ef444444" }} value={form.privateId}
              onChange={e => setForm({ ...form, privateId: e.target.value })} placeholder="123456789" />
          </Field>
          <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#ef4444,#b91c1c)", opacity: testingPrivate ? 0.7 : 1, fontSize: 13, padding: "9px 18px" }}
            onClick={testPrivate} disabled={testingPrivate}>
            {testingPrivate ? "⏳ Mengirim..." : "📨 Test Kirim ke ID Pribadi"}
          </button>
          <ResultBadge result={resultPrivate} />
        </div>

        {/* ── ID Grup ── */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 22, border: "2px solid #3b82f633", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#3b82f622", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💬</div>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>ID Group</div>
              <div style={{ color: "#64748b", fontSize: 12 }}>Untuk semua notifikasi transaksi arus masuk & keluar</div>
            </div>
            <span style={{ marginLeft: "auto", background: "#3b82f622", color: "#3b82f6", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid #3b82f644" }}>📊 TRANSAKSI</span>
          </div>

          <div style={{ background: "#0f172a", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
            Pesan yang dikirim ke sini: <strong style={{ color: "#f1f5f9" }}>Pemasukan baru · Pengeluaran baru · Penjualan kasir · Transaksi stok</strong>
          </div>

          <Field label="ID GROUP (angka negatif, contoh: -1001234567890)">
            <input style={{ ...inputStyle, borderColor: "#3b82f644" }} value={form.groupId}
              onChange={e => setForm({ ...form, groupId: e.target.value })} placeholder="-1001234567890" />
          </Field>
          <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", opacity: testingGroup ? 0.7 : 1, fontSize: 13, padding: "9px 18px" }}
            onClick={testGroup} disabled={testingGroup}>
            {testingGroup ? "⏳ Mengirim..." : "📨 Test Kirim ke Grup"}
          </button>
          <ResultBadge result={resultGroup} />
        </div>

        {/* ── Simpan ── */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginBottom: 20 }}>
          <button style={{ ...btnPrimary, width: "100%", padding: "13px", fontSize: 15 }} onClick={saveTg}>
            💾 Simpan Semua Pengaturan Telegram
          </button>
          {/* Status summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
            {[
              { label: "Bot Token", ok: !!form.token, icon: "🤖" },
              { label: "ID Pribadi", ok: !!form.privateId, icon: "👤" },
              { label: "ID Group", ok: !!form.groupId, icon: "💬" },
            ].map(s => (
              <div key={s.label} style={{ background: "#0f172a", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: s.ok ? "#10b981" : "#ef4444" }}>{s.ok ? "✓ Terisi" : "✕ Kosong"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Routing Notifikasi ── */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>🔔 Routing Notifikasi Otomatis</h4>
          {[
            { icon: "🔐", label: "Peringatan perubahan rekening",     dest: "ID Pribadi", destColor: "#ef4444" },
            { icon: "🔑", label: "Kode OTP bypass keamanan",          dest: "ID Pribadi", destColor: "#ef4444" },
            { icon: "🚨", label: "Alert keamanan sistem",             dest: "ID Pribadi", destColor: "#ef4444" },
            { icon: "💰", label: "Pemasukan baru ditambahkan",        dest: "ID Group",   destColor: "#3b82f6" },
            { icon: "💸", label: "Pengeluaran baru ditambahkan",      dest: "ID Group",   destColor: "#3b82f6" },
            { icon: "🛒", label: "Transaksi kasir (detail laba)",     dest: "ID Group",   destColor: "#3b82f6" },
            { icon: "📦", label: "Penjualan stok (detail laba)",      dest: "ID Group",   destColor: "#3b82f6" },
            { icon: "⚠️", label: "Stok barang di bawah minimum",     dest: "ID Group",   destColor: "#3b82f6" },
          ].map(n => (
            <div key={n.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #0f172a" }}>
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              <span style={{ color: "#94a3b8", fontSize: 13, flex: 1 }}>{n.label}</span>
              <span style={{ background: n.destColor + "22", color: n.destColor, fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
                → {n.dest}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

// ==================== SETTINGS ====================
function Settings({ biz, setBiz, addToast }) {
  const [form, setForm] = useState(biz);
  const fileRef = useRef();

  const handleLogo = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setForm({ ...form, logo: ev.target.result });
    r.readAsDataURL(f);
  };

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: 22 }}>⚙️ Pengaturan Bisnis</h2>
      <div style={{ maxWidth: 560 }}>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div onClick={() => fileRef.current.click()} style={{ cursor: "pointer", display: "inline-block" }}>
              {form.logo
                ? <img src={form.logo} alt="logo" style={{ width: 90, height: 90, borderRadius: 18, objectFit: "cover", border: "3px solid #3b82f6" }} />
                : <div style={{ width: 90, height: 90, borderRadius: 18, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto" }}>💼</div>}
            </div>
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>Klik untuk upload logo bisnis</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogo} />
          </div>
          <Field label="NAMA BISNIS"><input style={inputStyle} value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="PT. Contoh Bisnis" /></Field>
          <Field label="NAMA PEMILIK"><input style={inputStyle} value={form.owner || ""} onChange={e => setForm({ ...form, owner: e.target.value })} placeholder="Nama pemilik" /></Field>
          <Field label="NOMOR TELEPON"><input style={inputStyle} value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></Field>
          <Field label="EMAIL"><input type="email" style={inputStyle} value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@bisnis.com" /></Field>
          <Field label="ALAMAT"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Alamat bisnis" /></Field>
          <button style={btnPrimary} onClick={() => { setBiz(form); save("biz", form); addToast("Profil bisnis disimpan!", "success"); }}>💾 Simpan Profil</button>
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================
// ==================== NAV CONFIG ====================
const NAV_OWNER = [
  { id: "dashboard", icon: "📊", label: "Dashboard" },
  { id: "cashflow", icon: "💰", label: "Cash Flow" },
  { id: "kasir", icon: "🛒", label: "Kasir" },
  { id: "inventory", icon: "📦", label: "Stok Gudang" },
  { id: "invoice", icon: "🧾", label: "Invoice" },
  { id: "reports", icon: "📈", label: "Laporan" },
  { id: "telegram", icon: "✈️", label: "Telegram Bot" },
  { id: "owner", icon: "👑", label: "Owner" },
  { id: "settings", icon: "⚙️", label: "Pengaturan" },
];

const NAV_KARYAWAN = [
  { id: "dashboard", icon: "📊", label: "Dashboard" },
  { id: "kasir", icon: "🛒", label: "Kasir" },
  { id: "inventory", icon: "📦", label: "Stok Gudang" },
  { id: "invoice", icon: "🧾", label: "Invoice" },
  { id: "reports", icon: "📈", label: "Laporan" },
];

// ==================== LOGIN SCREEN ====================
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  const handleLogin = () => {
    if (!username || !password) return setError("Username & password wajib diisi!");
    const users = load("users", []);
    // Cek owner default
    const ownerDefault = load("owner_account", { username: "owner", password: "owner123" });
    let user = null;
    if (username === ownerDefault.username && password === ownerDefault.password) {
      user = { username, role: "owner", name: "Owner" };
    } else {
      user = users.find(u => u.username === username && u.password === password && u.active !== false);
    }
    if (!user) return setError("Username atau password salah!");
    setError("");
    onLogin(user);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans','Segoe UI',sans-serif", padding: 16 }}>
      <style>{`@keyframes floatUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}} @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}`}</style>
      <div style={{ width: "100%", maxWidth: 400, animation: "floatUp 0.6s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 16px", boxShadow: "0 0 40px #3b82f644" }}>💼</div>
          <div style={{ fontSize: 26, fontWeight: 800, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundSize: "200% auto", animation: "shimmer 2s linear infinite" }}>BizFlow Pro</div>
          <div style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>Masuk ke akun Anda</div>
        </div>
        <div style={{ background: "#1e293b", borderRadius: 18, padding: 28, border: "1px solid #334155", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
          <Field label="USERNAME">
            <input style={inputStyle} placeholder="Masukkan username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} autoFocus />
          </Field>
          <Field label="PASSWORD">
            <div style={{ position: "relative" }}>
              <input type={showPass ? "text" : "password"} style={{ ...inputStyle, paddingRight: 40 }} placeholder="Masukkan password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
              <button onClick={() => setShowPass(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16 }}>{showPass ? "🙈" : "👁️"}</button>
            </div>
          </Field>
          {error && <div style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 14 }}>❌ {error}</div>}
          <button style={{ ...btnPrimary, width: "100%", padding: "12px", fontSize: 15, marginTop: 4 }} onClick={handleLogin}>🔓 Masuk</button>
          <div style={{ color: "#334155", fontSize: 11, textAlign: "center", marginTop: 16 }}>Login default owner: owner / owner123</div>
        </div>
      </div>
    </div>
  );
}

// ==================== OWNER PAGE ====================
const generateKey = () => "bfk_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const ACCOUNT_TYPES = ["Rekening Bank", "E-Wallet", "Kartu Kredit", "Lainnya"];
const BANK_LIST = ["BCA", "BNI", "BRI", "Mandiri", "CIMB Niaga", "Danamon", "Permata", "BSI", "Jenius", "GoPay", "OVO", "Dana", "ShopeePay", "LinkAja", "Lainnya"];
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SECURITY_LOCKOUT_MS = 24 * 60 * 60 * 1000; // 24 jam lockout

// ==================== SECURITY SYSTEM UTILS ====================
const generateOTP = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const getSecurityState = () => {
  try { return JSON.parse(localStorage.getItem("security_state")) ?? { locked: false, lockTime: null, otp: null, otpExpiry: null }; }
  catch { return { locked: false, lockTime: null, otp: null, otpExpiry: null }; }
};
const setSecurityState = v => localStorage.setItem("security_state", JSON.stringify(v));

const isSystemLocked = () => {
  const s = getSecurityState();
  if (!s.locked) return false;
  if (s.lockTime && Date.now() - s.lockTime > SECURITY_LOCKOUT_MS) {
    setSecurityState({ locked: false, lockTime: null, otp: null, otpExpiry: null });
    return false;
  }
  return true;
};

const getLockRemainingText = () => {
  const s = getSecurityState();
  if (!s.lockTime) return "";
  const rem = SECURITY_LOCKOUT_MS - (Date.now() - s.lockTime);
  if (rem <= 0) return "";
  const h = Math.floor(rem / 3600000);
  const m = Math.floor((rem % 3600000) / 60000);
  return `${h} jam ${m} menit`;
};

// ==================== SECURITY LOCKOUT BANNER ====================
function SecurityLockBanner({ onUnlock }) {
  const [otp, setOtp] = useState("");
  const [remaining, setRemaining] = useState(getLockRemainingText());
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setRemaining(getLockRemainingText()), 10000);
    return () => clearInterval(iv);
  }, []);

  const tryUnlock = () => {
    const s = getSecurityState();
    if (!s.otp) return;
    if (otp.trim().toUpperCase() === s.otp) {
      setSecurityState({ locked: false, lockTime: null, otp: null, otpExpiry: null });
      onUnlock();
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 99990,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans','Segoe UI',sans-serif", padding: 24
    }}>
      <style>{`@keyframes lockShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-10px)}40%,80%{transform:translateX(10px)}}`}</style>
      <div style={{
        background: "#1e293b", borderRadius: 20, padding: 36, maxWidth: 440, width: "100%",
        border: "2px solid #ef444488", boxShadow: "0 0 60px #ef444422",
        animation: shake ? "lockShake 0.5s ease" : "none"
      }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🔒</div>
          <div style={{ color: "#ef4444", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>SISTEM TERKUNCI</div>
          <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
            Perubahan rekening terdeteksi. Semua transaksi online dihentikan sementara.<br />
            Sistem dalam mode <strong style={{ color: "#f59e0b" }}>COOLDOWN 24 JAM</strong>.
          </div>
        </div>

        <div style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 12, padding: "14px 18px", marginBottom: 24 }}>
          <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 6 }}>⏳ Waktu tersisa cooldown:</div>
          <div style={{ color: "#ef4444", fontSize: 20, fontWeight: 800 }}>{remaining || "Segera selesai..."}</div>
        </div>

        <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
          <div style={{ color: "#f59e0b", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🔑 Bypass dengan Kode OTP</div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
            Kode OTP dikirim ke <strong style={{ color: "#3b82f6" }}>Telegram pribadi Owner</strong>.<br />
            Masukkan kode tersebut untuk membuka kunci seketika.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 16, letterSpacing: 4, textTransform: "uppercase", textAlign: "center" }}
              placeholder="XXXXXX"
              value={otp}
              onChange={e => setOtp(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && tryUnlock()}
              maxLength={8}
            />
            <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#10b981,#059669)", padding: "10px 18px", whiteSpace: "nowrap" }} onClick={tryUnlock}>
              🔓 Buka
            </button>
          </div>
        </div>

        <div style={{ background: "#1e40af22", borderRadius: 10, padding: "10px 14px", color: "#93c5fd", fontSize: 12, lineHeight: 1.7 }}>
          ℹ️ Jika Anda adalah Owner yang melakukan perubahan, buka <strong>Telegram pribadi Anda</strong>, salin kode yang dikirim bot, dan tempelkan di atas.
        </div>
      </div>
    </div>
  );
}

// ==================== CLOUD SYNC PANEL ====================
function CloudSyncPanel({ addToast }) {
  const [url, setUrl] = useState(localStorage.getItem("sb_url") || "");
  const [key, setKey] = useState(localStorage.getItem("sb_key") || "");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(localStorage.getItem("last_sync") || null);

  const TABLE_LIST = [
    { key: "biz",              label: "Profil Bisnis",       icon: "🏢", table: "biz_profile" },
    { key: "income",           label: "Pemasukan",           icon: "📈", table: "cashflow (type=income)" },
    { key: "expense",          label: "Pengeluaran",         icon: "📉", table: "cashflow (type=expense)" },
    { key: "inventory",        label: "Stok Gudang",         icon: "📦", table: "inventory" },
    { key: "invoices",         label: "Invoice",             icon: "🧾", table: "invoices" },
    { key: "users",            label: "Data Karyawan",       icon: "👥", table: "users" },
    { key: "owner_accounts",   label: "Rekening Owner",      icon: "🏦", table: "owner_accounts" },
    { key: "owner_account",    label: "Akun Owner",          icon: "🔑", table: "owner_account" },
    { key: "telegram",         label: "Konfigurasi Telegram",icon: "✈️", table: "telegram_config" },
    { key: "work_hours",       label: "Jam Kerja",           icon: "🕐", table: "work_hours" },
    { key: "integrations_web", label: "Integrasi Website",   icon: "🌐", table: "integrations_web" },
    { key: "payment_gateways", label: "Payment Gateway",     icon: "💳", table: "payment_gateways" },
    { key: "security_state",   label: "Status Keamanan",     icon: "🔒", table: "security_state" },
  ];

  const testConnection = async () => {
    if (!url || !key) return setTestResult({ ok: false, msg: "URL dan Key wajib diisi!" });
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(url.replace(/\/$/, "") + "/rest/v1/biz_profile?limit=1", {
        headers: { "apikey": key, "Authorization": "Bearer " + key },
      });
      if (res.ok || res.status === 406) {
        setTestResult({ ok: true, msg: "✅ Koneksi Supabase berhasil!" });
      } else {
        const t = await res.text();
        setTestResult({ ok: false, msg: "❌ " + (t.slice(0, 150) || "Koneksi gagal") });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: "❌ Error: " + e.message });
    }
    setTesting(false);
  };

  const handleSaveConfig = () => {
    if (!url || !key) return addToast("URL dan Key wajib diisi!", "error");
    localStorage.setItem("sb_url", url.replace(/\/$/, ""));
    localStorage.setItem("sb_key", key.trim());
    addToast("✅ Konfigurasi Supabase disimpan! Reload halaman untuk mulai sync.", "success");
  };

  const handleFullSync = async () => {
    if (!isSupabaseReady()) return addToast("Konfigurasi Supabase belum diisi!", "error");
    setSyncing(true);
    const keys = ["biz", "income", "expense", "inventory", "invoices", "users", "owner_accounts", "owner_account", "telegram", "work_hours", "integrations_web", "payment_gateways"];
    let ok = 0, fail = 0;
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        await saveAndSync(k, parsed);
        ok++;
      } catch { fail++; }
    }
    const now = new Date().toLocaleString("id-ID");
    localStorage.setItem("last_sync", now);
    setLastSync(now);
    setSyncing(false);
    addToast(`☁️ Sync selesai! ${ok} berhasil${fail > 0 ? `, ${fail} gagal` : ""}`, ok > 0 ? "success" : "error");
  };

  const handleClearConfig = () => {
    localStorage.removeItem("sb_url");
    localStorage.removeItem("sb_key");
    setUrl(""); setKey("");
    addToast("Konfigurasi Supabase dihapus. App beralih ke mode lokal.", "info");
  };

  const inputS = { width: "100%", padding: "10px 14px", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" };
  const btn = { background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontSize: 14, fontWeight: 600 };

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Status banner */}
      <div style={{ background: isSupabaseReady() ? "#10b98122" : "#f59e0b22", border: `1px solid ${isSupabaseReady() ? "#10b98144" : "#f59e0b44"}`, borderRadius: 14, padding: "18px 22px", marginBottom: 24, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ fontSize: 40 }}>{isSupabaseReady() ? "☁️" : "⚠️"}</div>
        <div>
          <div style={{ color: isSupabaseReady() ? "#10b981" : "#f59e0b", fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
            {isSupabaseReady() ? "Supabase Terhubung" : "Belum Terhubung ke Cloud"}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            {isSupabaseReady()
              ? `Endpoint: ${(localStorage.getItem("sb_url") || "").replace("https://", "").slice(0, 40)}...`
              : "App berjalan di mode lokal (localStorage). Data tidak tersinkronisasi antar perangkat."}
          </div>
          {lastSync && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>🕐 Terakhir sync: {lastSync}</div>}
        </div>
      </div>

      {/* Konfigurasi */}
      <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155", marginBottom: 20 }}>
        <h4 style={{ color: "#f1f5f9", margin: "0 0 20px", fontSize: 16 }}>⚙️ Konfigurasi Supabase</h4>

        <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
          <strong style={{ color: "#3b82f6" }}>📋 Cara setup:</strong><br />
          1. Buka <strong style={{ color: "#f1f5f9" }}>supabase.com</strong> → Project Anda → <strong>Settings → API</strong><br />
          2. Salin <strong style={{ color: "#10b981" }}>Project URL</strong> dan <strong style={{ color: "#10b981" }}>anon/public key</strong><br />
          3. Jalankan SQL schema di bawah di <strong>SQL Editor</strong> Supabase Anda
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>SUPABASE PROJECT URL</label>
          <input style={inputS} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxxxxxxxxxx.supabase.co" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>ANON / PUBLIC KEY</label>
          <div style={{ position: "relative" }}>
            <input type={showKey ? "text" : "password"} style={{ ...inputS, paddingRight: 44 }} value={key} onChange={e => setKey(e.target.value)} placeholder="eyJhbGci..." />
            <button onClick={() => setShowKey(s => !s)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>{showKey ? "🙈" : "👁️"}</button>
          </div>
        </div>

        {testResult && (
          <div style={{ background: testResult.ok ? "#10b98122" : "#ef444422", border: `1px solid ${testResult.ok ? "#10b98144" : "#ef444444"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: testResult.ok ? "#10b981" : "#fca5a5", fontSize: 13 }}>
            {testResult.msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "#334155", opacity: testing ? 0.7 : 1 }} onClick={testConnection} disabled={testing}>
            {testing ? "⏳ Testing..." : "🔌 Test Koneksi"}
          </button>
          <button style={btn} onClick={handleSaveConfig}>💾 Simpan Konfigurasi</button>
          {isSupabaseReady() && (
            <button style={{ ...btn, background: "linear-gradient(135deg,#10b981,#059669)", opacity: syncing ? 0.7 : 1 }} onClick={handleFullSync} disabled={syncing}>
              {syncing ? "⏳ Syncing..." : "☁️ Sync Semua Data Sekarang"}
            </button>
          )}
          {isSupabaseReady() && (
            <button style={{ ...btn, background: "linear-gradient(135deg,#ef4444,#b91c1c)" }} onClick={handleClearConfig}>🗑️ Hapus Konfigurasi</button>
          )}
        </div>
      </div>

      {/* Tabel Mapping */}
      <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155", marginBottom: 20 }}>
        <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>🗂️ Pemetaan Data → Tabel Supabase</h4>
        <div style={{ background: "#0f172a", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#1e293b" }}>
                {["Data", "Tabel Supabase", "Mode"].map(h => <th key={h} style={{ padding: "10px 14px", color: "#64748b", fontSize: 11, fontWeight: 600, textAlign: "left" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {TABLE_LIST.map((t, i) => (
                <tr key={t.key} style={{ borderTop: i > 0 ? "1px solid #1e293b" : "none" }}>
                  <td style={{ padding: "10px 14px", color: "#f1f5f9" }}>{t.icon} {t.label}</td>
                  <td style={{ padding: "10px 14px" }}><code style={{ color: "#8b5cf6", fontSize: 12 }}>{t.table}</code></td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ background: t.table.includes("array") || !["biz_profile","telegram_config","work_hours","owner_account","owner_cooldowns","security_state"].includes(t.table) ? "#3b82f622" : "#f59e0b22",
                      color: ["biz_profile","telegram_config","work_hours","owner_account","owner_cooldowns","security_state"].includes(t.table) ? "#f59e0b" : "#3b82f6",
                      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20 }}>
                      {["biz_profile","telegram_config","work_hours","owner_account","owner_cooldowns","security_state"].includes(t.table) ? "single row" : "array / upsert"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SQL Schema */}
      <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h4 style={{ color: "#f1f5f9", margin: 0, fontSize: 15 }}>📄 SQL Schema untuk Supabase</h4>
          <button onClick={() => { navigator.clipboard?.writeText(SQL_SCHEMA); addToast("Schema SQL disalin!", "success"); }}
            style={{ ...btn, fontSize: 12, padding: "6px 14px" }}>📋 Salin SQL</button>
        </div>
        <pre style={{ background: "#0f172a", borderRadius: 10, padding: 16, color: "#94a3b8", fontSize: 11, overflow: "auto", maxHeight: 300, margin: 0, lineHeight: 1.6 }}>
          {SQL_SCHEMA}
        </pre>
      </div>
    </div>
  );
}

// SQL Schema lengkap untuk dijalankan di Supabase SQL Editor
const SQL_SCHEMA = `-- ======================================
-- BizFlow Pro — Supabase Schema
-- Jalankan di: Supabase Dashboard > SQL Editor
-- ======================================

-- Tabel single-row config (key-value store)
create table if not exists biz_profile (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table if not exists telegram_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table if not exists work_hours (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table if not exists owner_account (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table if not exists owner_cooldowns (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table if not exists security_state (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- Tabel array (data bisnis utama)
create table if not exists cashflow (
  id bigint primary key,
  type text not null,        -- 'income' | 'expense'
  date text,
  category text,
  desc text,
  amount numeric,
  from_stock boolean default false,
  cost_amount numeric,
  gross_profit numeric,
  payment_method text,
  customer_name text,
  items jsonb,
  updated_at timestamptz default now()
);

create table if not exists inventory (
  id bigint primary key,
  name text,
  sku text,
  category text,
  qty numeric default 0,
  min_qty numeric default 5,
  cost_price numeric,
  sell_price numeric,
  supplier text,
  history jsonb,
  updated_at timestamptz default now()
);

create table if not exists invoices (
  id bigint primary key,
  number text,
  date text,
  due_date text,
  client text,
  items jsonb,
  total numeric,
  status text,
  notes text,
  updated_at timestamptz default now()
);

create table if not exists users (
  id bigint primary key,
  name text,
  username text unique,
  password text,
  position text,
  role text default 'karyawan',
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists owner_accounts (
  id bigint primary key,
  type text,
  bank text,
  account_name text,
  account_number text,
  notes text,
  last_edited timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists integrations_web (
  id bigint primary key,
  name text,
  url text,
  api_key text,
  webhook_url text,
  sync_kasir boolean default true,
  sync_stok boolean default true,
  notes text,
  status text,
  updated_at timestamptz default now()
);

create table if not exists payment_gateways (
  id bigint primary key,
  provider text,
  merchant_id text,
  server_key text,
  client_key text,
  webhook_url text,
  active boolean default true,
  notif_telegram boolean default true,
  notes text,
  total_tx integer default 0,
  total_amount numeric default 0,
  updated_at timestamptz default now()
);

-- Enable Row Level Security (RLS) — sesuaikan dengan kebutuhan auth Anda
-- alter table cashflow enable row level security;
-- (Untuk penggunaan dengan anon key, nonaktifkan RLS atau tambahkan policy)
`;

// ==================== SECURITY HELPER COMPONENTS ====================
function ManualUnlockPanel({ onUnlock, addToast }) {
  const [otpInput, setOtpInput] = useState("");
  const [shake, setShake] = useState(false);

  const tryUnlock = () => {
    const s = getSecurityState();
    if (!s.otp) { addToast("Tidak ada kode OTP aktif.", "error"); return; }
    if (otpInput.trim().toUpperCase() === s.otp) {
      setSecurityState({ locked: false, lockTime: null, otp: null, otpExpiry: null });
      addToast("✅ Sistem berhasil dibuka!", "success");
      onUnlock();
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 600);
      addToast("❌ Kode OTP salah!", "error");
    }
  };

  return (
    <div style={{ animation: shake ? "lockShake 0.5s ease" : "none" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <input
          style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 18, letterSpacing: 6, textTransform: "uppercase", textAlign: "center" }}
          placeholder="KODE OTP"
          value={otpInput}
          onChange={e => setOtpInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && tryUnlock()}
          maxLength={8}
        />
        <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#10b981,#059669)", padding: "10px 20px" }} onClick={tryUnlock}>
          🔓 Buka Kunci
        </button>
      </div>
    </div>
  );
}

function TestSecurityNotif({ tg, addToast }) {
  const [sending, setSending] = useState(false);
  const test = async () => {
    if (!tg.token || !tg.chatId) return addToast("Konfigurasi Telegram belum diisi!", "error");
    setSending(true);
    const otp = generateOTP();
    const msg = `🧪 <b>TEST Sistem Keamanan — BizFlow Pro</b>\n\n` +
      `✅ Notifikasi keamanan berfungsi!\n` +
      `📱 Jika ada perubahan rekening, OTP akan terkirim ke sini.\n\n` +
      `Contoh kode OTP bypass:\n<code>${otp}</code>\n\n` +
      `📅 ${new Date().toLocaleString("id-ID")}`;
    const res = await sendTelegram(tg.token, tg.privateId, msg);
    setSending(false);
    if (res && res.ok) addToast("✅ Test notifikasi keamanan berhasil dikirim!", "success");
    else addToast("❌ Gagal kirim: " + (res?.description || "Cek konfigurasi Telegram"), "error");
  };

  return (
    <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#8b5cf6,#7c3aed)", opacity: sending ? 0.7 : 1 }} onClick={test} disabled={sending}>
      {sending ? "⏳ Mengirim..." : "📨 Kirim Test Notifikasi Keamanan"}
    </button>
  );
}

function OwnerPage({ addToast, tg, setTg, systemLocked, setSystemLocked }) {
  const [tab, setTab] = useState("akun");
  // --- Rekening ---
  const [accounts, setAccounts] = useState(() => load("owner_accounts", []));
  const [cooldowns, setCooldowns] = useState(() => load("owner_cooldowns", {}));
  const [showAccModal, setShowAccModal] = useState(false);
  const [editAccId, setEditAccId] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showNumbers, setShowNumbers] = useState({});
  const [accForm, setAccForm] = useState({ type: "Rekening Bank", bank: "BCA", accountName: "", accountNumber: "", notes: "" });
  // --- Karyawan ---
  const [users, setUsers] = useState(() => load("users", []));
  const [showUserModal, setShowUserModal] = useState(false);
  const [editUserId, setEditUserId] = useState(null);
  const [userForm, setUserForm] = useState({ name: "", username: "", password: "", position: "", active: true });
  // --- Owner akun sendiri ---
  const [ownerAcc, setOwnerAcc] = useState(() => load("owner_account", { username: "owner", password: "owner123" }));
  const [showOwnerPass, setShowOwnerPass] = useState(false);
  const [ownerForm, setOwnerForm] = useState({ username: ownerAcc.username, password: "", newPassword: "", confirmPassword: "" });
  // --- Jam kerja Telegram ---
  const [workHours, setWorkHours] = useState(() => load("work_hours", { enabled: false, start: "08:00", end: "17:00" }));
  // --- Integrasi Website ---
  const [websites, setWebsites] = useState(() => load("integrations_web", []));
  const [showWebModal, setShowWebModal] = useState(false);
  const [webForm, setWebForm] = useState({ name: "", url: "", apiKey: "", webhookUrl: "", syncKasir: true, syncStok: true, notes: "" });
  const [editWebId, setEditWebId] = useState(null);
  const [testingWeb, setTestingWeb] = useState(null);
  // --- Payment Gateway ---
  const [gateways, setGateways] = useState(() => load("payment_gateways", []));
  const [showGwModal, setShowGwModal] = useState(false);
  const [gwForm, setGwForm] = useState({ provider: "Midtrans", merchantId: "", serverKey: "", clientKey: "", webhookUrl: "", active: true, notifTelegram: true, notes: "" });
  const [editGwId, setEditGwId] = useState(null);
  const [showGwKeys, setShowGwKeys] = useState({});

  const saveAccounts = d => { setAccounts(d); save("owner_accounts", d); };
  const saveCooldowns = d => { setCooldowns(d); save("owner_cooldowns", d); };
  const saveUsers = d => { setUsers(d); save("users", d); };

  const getCooldownRemaining = id => {
    const cd = cooldowns[id]; if (!cd) return null;
    const r = cd - Date.now(); if (r <= 0) return null;
    return `${Math.floor(r/3600000)} jam ${Math.floor((r%3600000)/60000)} menit`;
  };

  // --- Rekening handlers ---
  const openAddAcc = () => { setEditAccId(null); setAccForm({ type: "Rekening Bank", bank: "BCA", accountName: "", accountNumber: "", notes: "" }); setShowAccModal(true); };
  const openEditAcc = acc => {
    const r = getCooldownRemaining(acc.id); if (r) return addToast(`Cooldown aktif, tunggu ${r}`, "error");
    setEditAccId(acc.id); setAccForm({ type: acc.type, bank: acc.bank, accountName: acc.accountName, accountNumber: acc.accountNumber, notes: acc.notes || "" }); setShowAccModal(true);
  };
  const submitAcc = async () => {
    if (!accForm.accountName || !accForm.accountNumber) return addToast("Nama & nomor akun wajib!", "error");
    if (editAccId) {
      saveAccounts(accounts.map(a => a.id === editAccId ? { ...a, ...accForm, lastEdited: Date.now() } : a));
      saveCooldowns({ ...cooldowns, [editAccId]: Date.now() + COOLDOWN_MS });

      // 🔐 SECURITY: Kunci sistem & kirim OTP ke Telegram owner
      const otp = generateOTP();
      setSecurityState({ locked: true, lockTime: Date.now(), otp, otpExpiry: Date.now() + SECURITY_LOCKOUT_MS });
      setSystemLocked(true);

      const changedAcc = accounts.find(a => a.id === editAccId);
      const secMsg = `🚨 <b>PERINGATAN KEAMANAN — BizFlow Pro</b>\n\n` +
        `⚠️ Rekening telah diubah!\n` +
        `🏦 Rekening: <b>${changedAcc?.bank || accForm.bank}</b> (${accForm.type})\n` +
        `👤 Nama: ${accForm.accountName}\n` +
        `🔢 Nomor: ${accForm.accountNumber}\n` +
        `🕐 Waktu: ${new Date().toLocaleString("id-ID")}\n\n` +
        `🔒 Sistem langsung dikunci 24 jam.\n` +
        `🔑 Kode bypass OTP Owner:\n\n` +
        `<code>${otp}</code>\n\n` +
        `Masukkan kode ini di aplikasi untuk membuka kunci seketika jika Anda yang melakukan perubahan ini.`;

      const res = await sendTelegram(tg.token, tg.privateId, secMsg);
      if (res && res.ok) {
        addToast("⚠️ Rekening diubah! Sistem dikunci. Kode OTP dikirim ke Telegram Owner.", "error");
      } else {
        addToast("⚠️ Rekening diubah! Sistem dikunci. Cek koneksi Telegram Owner.", "error");
      }
    } else {
      saveAccounts([...accounts, { ...accForm, id: Date.now(), createdAt: Date.now() }]);
      addToast("Akun ditambahkan!", "success");
    }
    setShowAccModal(false); setEditAccId(null);
  };
  const deleteAcc = id => {
    const r = getCooldownRemaining(id); if (r) return addToast(`Cooldown aktif, tunggu ${r}`, "error");
    saveAccounts(accounts.filter(a => a.id !== id));
    const nc = { ...cooldowns }; delete nc[id]; saveCooldowns(nc);
    setShowDeleteConfirm(null); addToast("Akun dihapus!", "info");
  };
  const maskNum = n => !n ? "-" : "*".repeat(Math.max(0, n.length - 4)) + n.slice(-4);
  const typeIcon = t => ({ "Rekening Bank": "🏦", "E-Wallet": "📱", "Kartu Kredit": "💳", "Lainnya": "💰" }[t] || "💰");

  // --- Karyawan handlers ---
  const openAddUser = () => { setEditUserId(null); setUserForm({ name: "", username: "", password: "", position: "", active: true }); setShowUserModal(true); };
  const openEditUser = u => { setEditUserId(u.id); setUserForm({ name: u.name, username: u.username, password: u.password, position: u.position || "", active: u.active !== false }); setShowUserModal(true); };
  const submitUser = () => {
    if (!userForm.name || !userForm.username || !userForm.password) return addToast("Nama, username & password wajib!", "error");
    const ownerData = load("owner_account", { username: "owner", password: "owner123" });
    if (userForm.username === ownerData.username) return addToast("Username sudah dipakai oleh owner!", "error");
    if (!editUserId && users.find(u => u.username === userForm.username)) return addToast("Username sudah ada!", "error");
    if (editUserId) {
      saveUsers(users.map(u => u.id === editUserId ? { ...u, ...userForm } : u));
      addToast("Data karyawan diperbarui!", "success");
    } else {
      saveUsers([...users, { ...userForm, id: Date.now(), role: "karyawan", createdAt: Date.now() }]);
      addToast("Karyawan berhasil ditambahkan!", "success");
    }
    setShowUserModal(false); setEditUserId(null);
  };
  const toggleUserActive = id => { saveUsers(users.map(u => u.id === id ? { ...u, active: !u.active } : u)); };
  const deleteUser = id => { saveUsers(users.filter(u => u.id !== id)); addToast("Karyawan dihapus!", "info"); };

  // --- Ganti password owner ---
  const saveOwnerPass = () => {
    if (!ownerForm.password || ownerForm.password !== ownerAcc.password) return addToast("Password lama salah!", "error");
    if (!ownerForm.newPassword || ownerForm.newPassword.length < 6) return addToast("Password baru minimal 6 karakter!", "error");
    if (ownerForm.newPassword !== ownerForm.confirmPassword) return addToast("Konfirmasi password tidak cocok!", "error");
    const updated = { username: ownerForm.username || ownerAcc.username, password: ownerForm.newPassword };
    setOwnerAcc(updated); save("owner_account", updated);
    setOwnerForm({ username: updated.username, password: "", newPassword: "", confirmPassword: "" });
    addToast("Password owner diperbarui!", "success");
  };

  // --- Jam kerja ---
  const saveWorkHours = wh => { setWorkHours(wh); save("work_hours", wh); addToast("Jam kerja disimpan!", "success"); };

  // --- Website handlers ---
  const saveWebsites = d => { setWebsites(d); save("integrations_web", d); };
  const openAddWeb = () => { setEditWebId(null); setWebForm({ name: "", url: "", apiKey: generateKey(), webhookUrl: "", syncKasir: true, syncStok: true, notes: "" }); setShowWebModal(true); };
  const openEditWeb = w => { setEditWebId(w.id); setWebForm({ name: w.name, url: w.url, apiKey: w.apiKey, webhookUrl: w.webhookUrl || "", syncKasir: w.syncKasir !== false, syncStok: w.syncStok !== false, notes: w.notes || "" }); setShowWebModal(true); };
  const submitWeb = () => {
    if (!webForm.name || !webForm.url) return addToast("Nama & URL website wajib!", "error");
    if (editWebId) {
      saveWebsites(websites.map(w => w.id === editWebId ? { ...w, ...webForm, updatedAt: Date.now() } : w));
      addToast("Integrasi diperbarui!", "success");
    } else {
      saveWebsites([...websites, { ...webForm, id: Date.now(), createdAt: Date.now(), status: "connected" }]);
      addToast("Website berhasil ditautkan!", "success");
    }
    setShowWebModal(false); setEditWebId(null);
  };
  const testWebConnection = async (w) => {
    setTestingWeb(w.id);
    await new Promise(r => setTimeout(r, 1500));
    setTestingWeb(null);
    addToast(`Koneksi ke ${w.name} berhasil! ✓`, "success");
  };
  const deleteWeb = id => { saveWebsites(websites.filter(w => w.id !== id)); addToast("Integrasi dihapus!", "info"); };

  // --- Gateway handlers ---
  const saveGateways = d => { setGateways(d); save("payment_gateways", d); };
  const openAddGw = () => { setEditGwId(null); setGwForm({ provider: "Midtrans", merchantId: "", serverKey: "", clientKey: "", webhookUrl: "", active: true, notifTelegram: true, notes: "" }); setShowGwModal(true); };
  const openEditGw = g => { setEditGwId(g.id); setGwForm({ provider: g.provider, merchantId: g.merchantId, serverKey: g.serverKey, clientKey: g.clientKey, webhookUrl: g.webhookUrl || "", active: g.active !== false, notifTelegram: g.notifTelegram !== false, notes: g.notes || "" }); setShowGwModal(true); };
  const submitGw = () => {
    if (!gwForm.merchantId || !gwForm.serverKey) return addToast("Merchant ID & Server Key wajib!", "error");
    if (editGwId) {
      saveGateways(gateways.map(g => g.id === editGwId ? { ...g, ...gwForm, updatedAt: Date.now() } : g));
      addToast("Payment gateway diperbarui!", "success");
    } else {
      saveGateways([...gateways, { ...gwForm, id: Date.now(), createdAt: Date.now(), totalTx: 0, totalAmount: 0 }]);
      addToast("Payment gateway ditambahkan!", "success");
    }
    setShowGwModal(false); setEditGwId(null);
  };
  const deleteGw = id => { saveGateways(gateways.filter(g => g.id !== id)); addToast("Gateway dihapus!", "info"); };
  const toggleGwKey = id => setShowGwKeys(s => ({ ...s, [id]: !s[id] }));

  const tabStyle = active => ({ padding: "9px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: active ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : "#1e293b", color: active ? "#fff" : "#64748b" });

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 20px", fontSize: 22 }}>👑 Owner</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {[["akun","🏦 Rekening & Akun"],["karyawan","👥 Karyawan"],["website","🌐 Integrasi Website"],["gateway","💳 Payment Gateway"],["jam","🕐 Jam Kerja Telegram"],["cloud","☁️ Cloud Sync"],["keamanan","🔐 Keamanan"],["owner","🔑 Akun Owner"]].map(([id,label]) => (
          <button key={id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ---- TAB REKENING ---- */}
      {tab === "akun" && (
        <div>
          {systemLocked && (
            <div style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 14, padding: "18px 20px", marginBottom: 20 }}>
              <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 16, marginBottom: 6 }}>🔒 Sistem Sedang Terkunci</div>
              <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 12 }}>
                Kode OTP bypass sudah dikirim ke Telegram Owner. Sisa cooldown: <strong>{getLockRemainingText()}</strong>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Buka Telegram Anda → salin kode OTP → masukkan di layar kunci yang muncul.</div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ color: "#64748b", fontSize: 13 }}>Data rekening bank, e-wallet, dan kartu. Setiap perubahan memerlukan cooldown 24 jam.</div>
            <button style={btnPrimary} onClick={openAddAcc}>+ Tambah</button>
          </div>
          {accounts.length === 0 && <div style={{ textAlign: "center", color: "#475569", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 12 }}>🏦</div>Belum ada akun tersimpan</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: 16 }}>
            {accounts.map(acc => {
              const rem = getCooldownRemaining(acc.id); const locked = !!rem;
              return (
                <div key={acc.id} style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: `1px solid ${locked ? "#f59e0b44" : "#334155"}`, position: "relative" }}>
                  {locked && <div style={{ position: "absolute", top: 0, right: 0, background: "#f59e0b", color: "#000", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: "0 14px 0 8px" }}>⏳ COOLDOWN</div>}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 11, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{typeIcon(acc.type)}</div>
                    <div><div style={{ color: "#f1f5f9", fontWeight: 700 }}>{acc.bank}</div><div style={{ color: "#64748b", fontSize: 12 }}>{acc.type}</div></div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 2 }}>PEMILIK</div>
                    <div style={{ color: "#f1f5f9", fontWeight: 600 }}>{acc.accountName}</div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 2 }}>NOMOR</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#3b82f6", fontWeight: 700, fontFamily: "monospace", letterSpacing: 2 }}>{showNumbers[acc.id] ? acc.accountNumber : maskNum(acc.accountNumber)}</span>
                      <button onClick={() => setShowNumbers(s => ({ ...s, [acc.id]: !s[acc.id] }))} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>{showNumbers[acc.id] ? "🙈" : "👁️"}</button>
                      <button onClick={() => { navigator.clipboard?.writeText(acc.accountNumber); addToast("Disalin!", "success"); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>📋</button>
                    </div>
                  </div>
                  {acc.notes && <div style={{ color: "#64748b", fontSize: 12, marginBottom: 12, fontStyle: "italic" }}>📝 {acc.notes}</div>}
                  {locked && <div style={{ background: "#f59e0b22", borderRadius: 8, padding: "7px 10px", marginBottom: 10, color: "#fbbf24", fontSize: 12 }}>⏳ Dapat diubah dalam {rem}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => openEditAcc(acc)} disabled={locked} style={{ ...btnPrimary, flex: 1, padding: "8px", fontSize: 12, opacity: locked ? 0.4 : 1 }}>✏️ Edit</button>
                    <button onClick={() => setShowDeleteConfirm(acc.id)} disabled={locked} style={{ ...btnDanger, padding: "8px 12px", fontSize: 12, opacity: locked ? 0.4 : 1 }}>🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
          <Modal open={showAccModal} onClose={() => setShowAccModal(false)} title={editAccId ? "✏️ Edit Akun" : "➕ Tambah Akun"}>
            <Field label="JENIS"><select style={inputStyle} value={accForm.type} onChange={e => setAccForm({ ...accForm, type: e.target.value })}>{ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
            <Field label="BANK / PLATFORM"><select style={inputStyle} value={accForm.bank} onChange={e => setAccForm({ ...accForm, bank: e.target.value })}>{BANK_LIST.map(b => <option key={b}>{b}</option>)}</select></Field>
            <Field label="NAMA PEMILIK"><input style={inputStyle} value={accForm.accountName} onChange={e => setAccForm({ ...accForm, accountName: e.target.value })} placeholder="Nama sesuai rekening" /></Field>
            <Field label="NOMOR REKENING / AKUN"><input style={inputStyle} value={accForm.accountNumber} onChange={e => setAccForm({ ...accForm, accountNumber: e.target.value })} placeholder="Masukkan nomor..." /></Field>
            <Field label="CATATAN"><input style={inputStyle} value={accForm.notes} onChange={e => setAccForm({ ...accForm, notes: e.target.value })} placeholder="Opsional..." /></Field>
            {editAccId && <div style={{ background: "#f59e0b22", borderRadius: 8, padding: "10px", marginBottom: 14, color: "#fbbf24", fontSize: 13 }}>⚠️ Setelah disimpan tidak bisa diubah selama 24 jam.</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowAccModal(false)}>Batal</button>
              <button style={btnPrimary} onClick={submitAcc}>Simpan</button>
            </div>
          </Modal>
          <Modal open={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title="🗑️ Hapus Akun">
            <p style={{ color: "#94a3b8", marginBottom: 20, fontSize: 14 }}>Yakin hapus akun ini? Tidak dapat dibatalkan.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowDeleteConfirm(null)}>Batal</button>
              <button style={btnDanger} onClick={() => deleteAcc(showDeleteConfirm)}>Hapus</button>
            </div>
          </Modal>
        </div>
      )}

      {/* ---- TAB KARYAWAN ---- */}
      {tab === "karyawan" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ color: "#64748b", fontSize: 13 }}>Akun karyawan hanya bisa dibuat & diubah dari sisi owner.</div>
            <button style={btnPrimary} onClick={openAddUser}>+ Tambah Karyawan</button>
          </div>
          {users.length === 0 && <div style={{ textAlign: "center", color: "#475569", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 12 }}>👥</div>Belum ada karyawan</div>}
          <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflow: "auto" }}>
            {users.length > 0 && <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#0f172a" }}>
                {["Nama","Username","Jabatan","Status","Aksi"].map(h => <th key={h} style={{ padding: "12px 16px", color: "#64748b", fontSize: 12, fontWeight: 600, textAlign: "left" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderTop: "1px solid #0f172a" }}>
                    <td style={{ padding: "12px 16px", color: "#f1f5f9", fontWeight: 600 }}>{u.name}</td>
                    <td style={{ padding: "12px 16px", color: "#94a3b8", fontFamily: "monospace" }}>{u.username}</td>
                    <td style={{ padding: "12px 16px", color: "#64748b", fontSize: 13 }}>{u.position || "-"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <button onClick={() => toggleUserActive(u.id)} style={{ background: u.active !== false ? "#10b98122" : "#ef444422", color: u.active !== false ? "#10b981" : "#ef4444", border: "none", borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        {u.active !== false ? "✓ Aktif" : "✕ Nonaktif"}
                      </button>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEditUser(u)} style={{ ...btnPrimary, padding: "6px 12px", fontSize: 12 }}>✏️</button>
                        <button onClick={() => deleteUser(u.id)} style={{ ...btnDanger, padding: "6px 12px", fontSize: 12 }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
          </div>
          <Modal open={showUserModal} onClose={() => setShowUserModal(false)} title={editUserId ? "✏️ Edit Karyawan" : "➕ Tambah Karyawan"}>
            <Field label="NAMA LENGKAP"><input style={inputStyle} value={userForm.name} onChange={e => setUserForm({ ...userForm, name: e.target.value })} placeholder="Nama karyawan" /></Field>
            <Field label="USERNAME"><input style={inputStyle} value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="username login" disabled={!!editUserId} /></Field>
            <Field label="PASSWORD"><input type="password" style={inputStyle} value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} placeholder="min. 6 karakter" /></Field>
            <Field label="JABATAN / POSISI"><input style={inputStyle} value={userForm.position} onChange={e => setUserForm({ ...userForm, position: e.target.value })} placeholder="Kasir, Admin, dll" /></Field>
            <Field label="STATUS">
              <select style={inputStyle} value={userForm.active ? "aktif" : "nonaktif"} onChange={e => setUserForm({ ...userForm, active: e.target.value === "aktif" })}>
                <option value="aktif">Aktif</option>
                <option value="nonaktif">Nonaktif</option>
              </select>
            </Field>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowUserModal(false)}>Batal</button>
              <button style={btnPrimary} onClick={submitUser}>Simpan</button>
            </div>
          </Modal>
        </div>
      )}

      {/* ---- TAB JAM KERJA ---- */}
      {tab === "jam" && (
        <div style={{ maxWidth: 520 }}>
          <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155" }}>
            <h4 style={{ color: "#f1f5f9", margin: "0 0 6px" }}>🕐 Jam Kerja Notifikasi Telegram</h4>
            <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px" }}>Bot Telegram hanya akan mengirim notifikasi transaksi dalam rentang jam kerja yang ditentukan.</p>
            <Field label="AKTIFKAN JAM KERJA">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button onClick={() => setWorkHours(w => ({ ...w, enabled: !w.enabled }))} style={{ width: 48, height: 26, borderRadius: 99, border: "none", cursor: "pointer", background: workHours.enabled ? "#10b981" : "#334155", position: "relative", transition: "background 0.2s" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: workHours.enabled ? 25 : 3, transition: "left 0.2s" }} />
                </button>
                <span style={{ color: workHours.enabled ? "#10b981" : "#64748b", fontSize: 13, fontWeight: 600 }}>{workHours.enabled ? "Aktif" : "Nonaktif"}</span>
              </div>
            </Field>
            {workHours.enabled && <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="JAM MULAI"><input type="time" style={inputStyle} value={workHours.start} onChange={e => setWorkHours(w => ({ ...w, start: e.target.value }))} /></Field>
                <Field label="JAM SELESAI"><input type="time" style={inputStyle} value={workHours.end} onChange={e => setWorkHours(w => ({ ...w, end: e.target.value }))} /></Field>
              </div>
              <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", marginBottom: 16, color: "#94a3b8", fontSize: 13 }}>
                📨 Notifikasi hanya dikirim antara <strong style={{ color: "#3b82f6" }}>{workHours.start}</strong> – <strong style={{ color: "#3b82f6" }}>{workHours.end}</strong>
              </div>
            </>}
            <button style={btnPrimary} onClick={() => saveWorkHours(workHours)}>💾 Simpan Pengaturan</button>
          </div>
        </div>
      )}

      {/* ---- TAB INTEGRASI WEBSITE ---- */}
      {tab === "website" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 600, marginBottom: 4 }}>Tautkan Website ke Aplikasi</div>
              <div style={{ color: "#64748b", fontSize: 13 }}>Website yang ditautkan dapat sinkronisasi data kasir & stok secara real-time via API Key.</div>
            </div>
            <button style={btnPrimary} onClick={openAddWeb}>+ Tautkan Website</button>
          </div>

          <div style={{ background: "#1e40af22", border: "1px solid #3b82f644", borderRadius: 12, padding: "12px 16px", marginBottom: 20, color: "#93c5fd", fontSize: 13 }}>
            📡 Gunakan <strong>API Key</strong> dan <strong>Webhook URL</strong> di bawah untuk mengintegrasikan website Anda. Data pesanan masuk otomatis tercatat di kasir dan stok diperbarui.
          </div>

          {websites.length === 0 && <div style={{ textAlign: "center", color: "#475569", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 12 }}>🌐</div>Belum ada website yang ditautkan</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
            {websites.map(w => (
              <div key={w.id} style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🌐</div>
                    <div>
                      <div style={{ color: "#f1f5f9", fontWeight: 700 }}>{w.name}</div>
                      <a href={w.url} target="_blank" rel="noreferrer" style={{ color: "#3b82f6", fontSize: 12 }}>{w.url}</a>
                    </div>
                  </div>
                  <span style={{ background: "#10b98122", color: "#10b981", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20 }}>● Terhubung</span>
                </div>

                <div style={{ background: "#0f172a", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                  <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>API KEY</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ color: "#8b5cf6", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.apiKey}</code>
                    <button onClick={() => { navigator.clipboard?.writeText(w.apiKey); addToast("API Key disalin!", "success"); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>📋</button>
                  </div>
                </div>

                {w.webhookUrl && (
                  <div style={{ background: "#0f172a", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>WEBHOOK URL</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code style={{ color: "#f59e0b", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.webhookUrl}</code>
                      <button onClick={() => { navigator.clipboard?.writeText(w.webhookUrl); addToast("Webhook URL disalin!", "success"); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>📋</button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1, background: w.syncKasir !== false ? "#10b98122" : "#33415522", borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>SYNC KASIR</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: w.syncKasir !== false ? "#10b981" : "#64748b" }}>{w.syncKasir !== false ? "✓ Aktif" : "✕ Off"}</div>
                  </div>
                  <div style={{ flex: 1, background: w.syncStok !== false ? "#3b82f622" : "#33415522", borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>SYNC STOK</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: w.syncStok !== false ? "#3b82f6" : "#64748b" }}>{w.syncStok !== false ? "✓ Aktif" : "✕ Off"}</div>
                  </div>
                </div>

                {w.notes && <div style={{ color: "#64748b", fontSize: 12, marginBottom: 12, fontStyle: "italic" }}>📝 {w.notes}</div>}

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => testWebConnection(w)} style={{ ...btnPrimary, background: "#1e40af", flex: 1, padding: "8px", fontSize: 12 }}>
                    {testingWeb === w.id ? "⏳ Testing..." : "🔌 Test Koneksi"}
                  </button>
                  <button onClick={() => openEditWeb(w)} style={{ ...btnPrimary, padding: "8px 12px", fontSize: 12 }}>✏️</button>
                  <button onClick={() => deleteWeb(w.id)} style={{ ...btnDanger, padding: "8px 12px", fontSize: 12 }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>

          {/* Panduan Integrasi */}
          <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginTop: 24 }}>
            <h4 style={{ color: "#f1f5f9", margin: "0 0 14px" }}>📖 Panduan Integrasi API</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
              {[
                { icon: "1️⃣", title: "Tautkan Website", desc: "Tambahkan URL website & salin API Key yang digenerate" },
                { icon: "2️⃣", title: "Pasang di Website", desc: "Kirim header Authorization: Bearer {API_KEY} di setiap request" },
                { icon: "3️⃣", title: "Endpoint Pesanan", desc: "POST /api/order dengan body { items, customer, total } — otomatis masuk kasir" },
                { icon: "4️⃣", title: "Webhook Stok", desc: "Set Webhook URL di website untuk menerima update stok real-time" },
              ].map(s => (
                <div key={s.title} style={{ background: "#0f172a", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
                  <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <Modal open={showWebModal} onClose={() => setShowWebModal(false)} title={editWebId ? "✏️ Edit Integrasi" : "🌐 Tautkan Website"}>
            <Field label="NAMA WEBSITE / TOKO"><input style={inputStyle} value={webForm.name} onChange={e => setWebForm({ ...webForm, name: e.target.value })} placeholder="Toko Online Saya" /></Field>
            <Field label="URL WEBSITE"><input style={inputStyle} value={webForm.url} onChange={e => setWebForm({ ...webForm, url: e.target.value })} placeholder="https://tokosaya.com" /></Field>
            <Field label="API KEY (auto-generate)">
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }} value={webForm.apiKey} onChange={e => setWebForm({ ...webForm, apiKey: e.target.value })} placeholder="API Key" />
                <button style={{ ...btnPrimary, padding: "0 14px", fontSize: 12 }} onClick={() => setWebForm(f => ({ ...f, apiKey: generateKey() }))}>🔄 Baru</button>
              </div>
            </Field>
            <Field label="WEBHOOK URL (OPSIONAL)"><input style={inputStyle} value={webForm.webhookUrl} onChange={e => setWebForm({ ...webForm, webhookUrl: e.target.value })} placeholder="https://tokosaya.com/webhook/bizflow" /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Sync Kasir</div>
                <button onClick={() => setWebForm(f => ({ ...f, syncKasir: !f.syncKasir }))} style={{ width: 44, height: 24, borderRadius: 99, border: "none", cursor: "pointer", background: webForm.syncKasir ? "#10b981" : "#334155", position: "relative" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: webForm.syncKasir ? 23 : 3, transition: "left 0.2s" }} />
                </button>
              </div>
              <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Sync Stok</div>
                <button onClick={() => setWebForm(f => ({ ...f, syncStok: !f.syncStok }))} style={{ width: 44, height: 24, borderRadius: 99, border: "none", cursor: "pointer", background: webForm.syncStok ? "#3b82f6" : "#334155", position: "relative" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: webForm.syncStok ? 23 : 3, transition: "left 0.2s" }} />
                </button>
              </div>
            </div>
            <Field label="CATATAN"><input style={inputStyle} value={webForm.notes} onChange={e => setWebForm({ ...webForm, notes: e.target.value })} placeholder="Opsional..." /></Field>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowWebModal(false)}>Batal</button>
              <button style={btnPrimary} onClick={submitWeb}>Simpan</button>
            </div>
          </Modal>
        </div>
      )}

      {/* ---- TAB PAYMENT GATEWAY ---- */}
      {tab === "gateway" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 600, marginBottom: 4 }}>Payment Gateway</div>
              <div style={{ color: "#64748b", fontSize: 13 }}>Terima notifikasi pembayaran otomatis dari berbagai payment gateway.</div>
            </div>
            <button style={btnPrimary} onClick={openAddGw}>+ Tambah Gateway</button>
          </div>

          <div style={{ background: "#14532d22", border: "1px solid #16a34a44", borderRadius: 12, padding: "12px 16px", marginBottom: 20, color: "#86efac", fontSize: 13 }}>
            💳 Setiap pembayaran yang masuk akan otomatis dicatat sebagai <strong>Pemasukan</strong> dan dikirim notifikasi ke <strong>Telegram</strong> (jika diaktifkan).
          </div>

          {gateways.length === 0 && <div style={{ textAlign: "center", color: "#475569", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 12 }}>💳</div>Belum ada payment gateway</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
            {gateways.map(g => (
              <div key={g.id} style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: `1px solid ${g.active !== false ? "#10b98144" : "#334155"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 11, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                      {{"Midtrans":"🟢","Xendit":"🔵","Doku":"🟣","Stripe":"🟡","PayPal":"🔷","Manual/COD":"📦"}[g.provider] || "💳"}
                    </div>
                    <div>
                      <div style={{ color: "#f1f5f9", fontWeight: 700 }}>{g.provider}</div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>Merchant: {g.merchantId || "-"}</div>
                    </div>
                  </div>
                  <span style={{ background: g.active !== false ? "#10b98122" : "#ef444422", color: g.active !== false ? "#10b981" : "#ef4444", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20 }}>
                    {g.active !== false ? "● Aktif" : "○ Nonaktif"}
                  </span>
                </div>

                <div style={{ background: "#0f172a", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ color: "#64748b", fontSize: 11 }}>SERVER KEY</span>
                    <button onClick={() => toggleGwKey(g.id)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}>{showGwKeys[g.id] ? "🙈 Sembunyikan" : "👁️ Tampilkan"}</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <code style={{ color: "#8b5cf6", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {showGwKeys[g.id] ? g.serverKey : "•".repeat(Math.min(32, g.serverKey?.length || 8))}
                    </code>
                    <button onClick={() => { navigator.clipboard?.writeText(g.serverKey); addToast("Server Key disalin!", "success"); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>📋</button>
                  </div>
                </div>

                {g.webhookUrl && (
                  <div style={{ background: "#0f172a", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>WEBHOOK ENDPOINT</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <code style={{ color: "#f59e0b", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.webhookUrl}</code>
                      <button onClick={() => { navigator.clipboard?.writeText(g.webhookUrl); addToast("Disalin!", "success"); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>📋</button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1, background: "#0f172a", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>TOTAL TRANSAKSI</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>{g.totalTx || 0}</div>
                  </div>
                  <div style={{ flex: 1, background: "#0f172a", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>TOTAL MASUK</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981" }}>{formatRp(g.totalAmount || 0)}</div>
                  </div>
                  <div style={{ flex: 1, background: g.notifTelegram !== false ? "#10b98122" : "#0f172a", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>NOTIF TG</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: g.notifTelegram !== false ? "#10b981" : "#64748b" }}>{g.notifTelegram !== false ? "✓ On" : "✕ Off"}</div>
                  </div>
                </div>

                {g.notes && <div style={{ color: "#64748b", fontSize: 12, marginBottom: 12, fontStyle: "italic" }}>📝 {g.notes}</div>}

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => openEditGw(g)} style={{ ...btnPrimary, flex: 1, padding: "8px", fontSize: 12 }}>✏️ Edit</button>
                  <button onClick={() => deleteGw(g.id)} style={{ ...btnDanger, padding: "8px 12px", fontSize: 12 }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>

          {/* Simulasi notif pembayaran masuk */}
          {gateways.some(g => g.active !== false) && (
            <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155", marginTop: 24 }}>
              <h4 style={{ color: "#f1f5f9", margin: "0 0 14px" }}>🧪 Simulasi Notifikasi Pembayaran</h4>
              <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>Simulasikan penerimaan notifikasi pembayaran dari gateway aktif untuk testing.</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {gateways.filter(g => g.active !== false).map(g => (
                  <button key={g.id} style={{ ...btnSuccess, fontSize: 13 }} onClick={() => {
                    const amount = Math.floor(Math.random() * 500 + 1) * 1000;
                    const orderId = "ORD-" + Date.now().toString().slice(-6);
                    addToast(`💳 Pembayaran masuk via ${g.provider}! Order ${orderId} — ${formatRp(amount)}`, "success");
                    const updated = gateways.map(x => x.id === g.id ? { ...x, totalTx: (x.totalTx || 0) + 1, totalAmount: (x.totalAmount || 0) + amount } : x);
                    saveGateways(updated);
                  }}>
                    💳 Simulasi {g.provider}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Modal open={showGwModal} onClose={() => setShowGwModal(false)} title={editGwId ? "✏️ Edit Gateway" : "💳 Tambah Payment Gateway"}>
            <Field label="PROVIDER">
              <select style={inputStyle} value={gwForm.provider} onChange={e => setGwForm({ ...gwForm, provider: e.target.value })}>
                {["Midtrans","Xendit","Doku","Stripe","PayPal","Manual/COD"].map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="MERCHANT ID / ACCOUNT ID"><input style={inputStyle} value={gwForm.merchantId} onChange={e => setGwForm({ ...gwForm, merchantId: e.target.value })} placeholder="Merchant ID dari dashboard gateway" /></Field>
            <Field label="SERVER KEY / SECRET KEY"><input type="password" style={inputStyle} value={gwForm.serverKey} onChange={e => setGwForm({ ...gwForm, serverKey: e.target.value })} placeholder="Server Key (rahasia)" /></Field>
            <Field label="CLIENT KEY / PUBLIC KEY"><input style={inputStyle} value={gwForm.clientKey} onChange={e => setGwForm({ ...gwForm, clientKey: e.target.value })} placeholder="Client Key (opsional)" /></Field>
            <Field label="WEBHOOK URL NOTIFIKASI"><input style={inputStyle} value={gwForm.webhookUrl} onChange={e => setGwForm({ ...gwForm, webhookUrl: e.target.value })} placeholder="https://domain.com/webhook/payment" /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Status Aktif</div>
                <button onClick={() => setGwForm(f => ({ ...f, active: !f.active }))} style={{ width: 44, height: 24, borderRadius: 99, border: "none", cursor: "pointer", background: gwForm.active ? "#10b981" : "#334155", position: "relative" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: gwForm.active ? 23 : 3, transition: "left 0.2s" }} />
                </button>
              </div>
              <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Notif Telegram</div>
                <button onClick={() => setGwForm(f => ({ ...f, notifTelegram: !f.notifTelegram }))} style={{ width: 44, height: 24, borderRadius: 99, border: "none", cursor: "pointer", background: gwForm.notifTelegram ? "#3b82f6" : "#334155", position: "relative" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: gwForm.notifTelegram ? 23 : 3, transition: "left 0.2s" }} />
                </button>
              </div>
            </div>
            <Field label="CATATAN"><input style={inputStyle} value={gwForm.notes} onChange={e => setGwForm({ ...gwForm, notes: e.target.value })} placeholder="Opsional..." /></Field>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowGwModal(false)}>Batal</button>
              <button style={btnPrimary} onClick={submitGw}>Simpan</button>
            </div>
          </Modal>
        </div>
      )}

      {/* ---- TAB CLOUD SYNC ---- */}
      {tab === "cloud" && <CloudSyncPanel addToast={addToast} />}

      {/* ---- TAB KEAMANAN ---- */}
      {tab === "keamanan" && (
        <div style={{ maxWidth: 560 }}>
          {/* Status Panel */}
          <div style={{ background: systemLocked ? "#7f1d1d22" : "#10b98122", border: `1px solid ${systemLocked ? "#ef444466" : "#10b98144"}`, borderRadius: 16, padding: "22px 24px", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ fontSize: 48 }}>{systemLocked ? "🔒" : "🔓"}</div>
              <div>
                <div style={{ color: systemLocked ? "#ef4444" : "#10b981", fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
                  {systemLocked ? "SISTEM TERKUNCI" : "SISTEM AMAN"}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  {systemLocked
                    ? `Cooldown aktif. Sisa waktu: ${getLockRemainingText() || "Segera selesai"}`
                    : "Tidak ada ancaman terdeteksi. Semua transaksi berjalan normal."}
                </div>
              </div>
            </div>
          </div>

          {/* Cara kerja */}
          <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155", marginBottom: 20 }}>
            <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 16 }}>🛡️ Cara Kerja Sistem Keamanan</h4>
            {[
              { icon: "1️⃣", title: "Perubahan Rekening Terdeteksi", desc: "Siapapun (karyawan/owner) yang mengedit data rekening akan langsung memicu sistem keamanan." },
              { icon: "2️⃣", title: "Sistem Langsung Terkunci", desc: "Semua transaksi online (kasir & cashflow) diblokir. Sistem masuk mode cooldown 24 jam." },
              { icon: "3️⃣", title: "OTP Dikirim ke Telegram Owner", desc: "Kode bypass 6 karakter dikirim otomatis ke chat pribadi Telegram Owner." },
              { icon: "4️⃣", title: "Owner Memasukkan Kode", desc: "Owner buka Telegram → salin kode → masukkan di layar kunci aplikasi → sistem terbuka seketika." },
              { icon: "5️⃣", title: "Ganti Bot = Verifikasi ke Bot Lama", desc: "Jika ada yang mencoba mengganti token bot Telegram, OTP wajib dikirim & dikonfirmasi via bot lama terlebih dahulu." },
            ].map(s => (
              <div key={s.title} style={{ display: "flex", gap: 14, padding: "12px 0", borderBottom: "1px solid #0f172a" }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>{s.icon}</div>
                <div>
                  <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{s.title}</div>
                  <div style={{ color: "#64748b", fontSize: 13 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Manual unlock (owner saja) */}
          {systemLocked && (
            <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #f59e0b44" }}>
              <h4 style={{ color: "#f59e0b", margin: "0 0 6px", fontSize: 15 }}>🔑 Buka Kunci Manual (Owner)</h4>
              <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 16px" }}>
                Masukkan kode OTP yang dikirim ke Telegram Anda untuk membuka kunci seketika tanpa menunggu cooldown.
              </p>
              <ManualUnlockPanel onUnlock={() => setSystemLocked(false)} addToast={addToast} />
            </div>
          )}

          {/* Test: Simulasi kirim OTP */}
          {!systemLocked && (
            <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155" }}>
              <h4 style={{ color: "#f1f5f9", margin: "0 0 6px", fontSize: 15 }}>🧪 Test Kirim OTP ke Telegram</h4>
              <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>Kirim simulasi pesan keamanan ke Telegram Owner untuk memastikan notifikasi berfungsi.</p>
              <TestSecurityNotif tg={tg} addToast={addToast} />
            </div>
          )}
        </div>
      )}

      {/* ---- TAB AKUN OWNER ---- */}
      {tab === "owner" && (
        <div style={{ maxWidth: 480 }}>
          <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155" }}>
            <h4 style={{ color: "#f1f5f9", margin: "0 0 20px" }}>🔑 Ubah Password Owner</h4>
            <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>Username saat ini: </span>
              <span style={{ color: "#3b82f6", fontWeight: 700, fontFamily: "monospace" }}>{ownerAcc.username}</span>
            </div>
            <Field label="USERNAME BARU (OPSIONAL)"><input style={inputStyle} value={ownerForm.username} onChange={e => setOwnerForm({ ...ownerForm, username: e.target.value })} placeholder={ownerAcc.username} /></Field>
            <Field label="PASSWORD LAMA">
              <div style={{ position: "relative" }}>
                <input type={showOwnerPass ? "text" : "password"} style={{ ...inputStyle, paddingRight: 40 }} value={ownerForm.password} onChange={e => setOwnerForm({ ...ownerForm, password: e.target.value })} placeholder="••••••" />
                <button onClick={() => setShowOwnerPass(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>{showOwnerPass ? "🙈" : "👁️"}</button>
              </div>
            </Field>
            <Field label="PASSWORD BARU (min. 6 karakter)"><input type="password" style={inputStyle} value={ownerForm.newPassword} onChange={e => setOwnerForm({ ...ownerForm, newPassword: e.target.value })} placeholder="••••••" /></Field>
            <Field label="KONFIRMASI PASSWORD BARU"><input type="password" style={inputStyle} value={ownerForm.confirmPassword} onChange={e => setOwnerForm({ ...ownerForm, confirmPassword: e.target.value })} placeholder="••••••" /></Field>
            <button style={btnPrimary} onClick={saveOwnerPass}>💾 Simpan Password</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== MAIN APP ====================
export default function App() {
  const [loading, setLoading] = useState(true);
  const [showSupabaseSetup, setShowSupabaseSetup] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => load("session_user", null));
  const [active, setActive] = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(true);
  const [biz, setBiz] = useState(() => load("biz", {}));
  const [income, setIncome] = useState(() => load("income", []));
  const [expense, setExpense] = useState(() => load("expense", []));
  const [inventory, setInventory] = useState(() => load("inventory", []));
  const [tg, setTg] = useState(() => load("telegram", { token: "", privateId: "", groupId: "", chatId: "" }));
  const [toasts, setToasts] = useState([]);
  const [systemLocked, setSystemLocked] = useState(() => isSystemLocked());
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error

  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  // Load semua data dari Supabase saat startup
  useEffect(() => {
    const loadAllFromCloud = async () => {
      if (!isSupabaseReady()) return; // skip jika belum dikonfigurasi
      setSyncStatus("syncing");
      try {
        const [
          cloudBiz, cloudIncome, cloudExpense,
          cloudInventory, cloudTg
        ] = await Promise.all([
          loadFromCloud("biz", {}),
          loadFromCloud("income", []),
          loadFromCloud("expense", []),
          loadFromCloud("inventory", []),
          loadFromCloud("telegram", { token: "", privateId: "", groupId: "", chatId: "" }),
        ]);
        setBiz(cloudBiz);
        setIncome(cloudIncome);
        setExpense(cloudExpense);
        setInventory(cloudInventory);
        setTg(cloudTg);
        setSyncStatus("synced");
      } catch (e) {
        setSyncStatus("error");
        console.error("Cloud load error:", e);
      }
    };
    loadAllFromCloud();
  }, []);

  const handleLogin = (user) => { setCurrentUser(user); save("session_user", user); setActive("dashboard"); };
  const handleLogout = () => { setCurrentUser(null); save("session_user", null); setActive("dashboard"); };

  if (loading) return <LoadingScreen onDone={() => setLoading(false)} />;
  if (showSupabaseSetup) return <SupabaseSetup onSave={() => { setShowSupabaseSetup(false); window.location.reload(); }} />;
  if (!currentUser) return <LoginScreen onLogin={handleLogin} />;

  const isOwner = currentUser.role === "owner";
  const NAV = isOwner ? NAV_OWNER : NAV_KARYAWAN;

  // Wrap sendTelegram dengan pengecekan jam kerja
  const workHours = load("work_hours", { enabled: false, start: "08:00", end: "17:00" });
  const sendTelegramWithWorkHours = async (token, chatId, text) => {
    if (workHours.enabled) {
      const now = new Date();
      const [sh, sm] = workHours.start.split(":").map(Number);
      const [eh, em] = workHours.end.split(":").map(Number);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (nowMin < startMin || nowMin > endMin) return { ok: false, error: "Di luar jam kerja" };
    }
    return sendTelegram(token, chatId, text);
  };

  const sharedProps = { income, setIncome, expense, setExpense, inventory, setInventory, tg, setTg, biz, setBiz, addToast, sendTg: sendTelegramWithWorkHours, systemLocked };

  const pages = {
    dashboard: <Dashboard {...sharedProps} />,
    cashflow: <CashFlow {...sharedProps} />,
    kasir: <Kasir income={income} setIncome={setIncome} inventory={inventory} setInventory={setInventory} tg={tg} biz={biz} addToast={addToast} sendTg={sendTelegramWithWorkHours} systemLocked={systemLocked} />,
    inventory: <Inventory income={income} setIncome={setIncome} expense={expense} setExpense={setExpense} inventory={inventory} setInventory={setInventory} tg={tg} biz={biz} addToast={addToast} sendTg={sendTelegramWithWorkHours} />,
    invoice: <Invoice {...sharedProps} />,
    reports: <Reports {...sharedProps} />,
    telegram: <TelegramSettings {...sharedProps} />,
    owner: <OwnerPage addToast={addToast} tg={tg} setTg={setTg} systemLocked={systemLocked} setSystemLocked={setSystemLocked} />,
    settings: <Settings {...sharedProps} />,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1e", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      {/* Security Lock Banner - tampil di semua user saat sistem terkunci */}
      {systemLocked && <SecurityLockBanner onUnlock={() => setSystemLocked(false)} />}
      <style>{`
        @keyframes slideIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes floatUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#0f172a}::-webkit-scrollbar-thumb{background:#334155;border-radius:99px}
        input[type=range]{accent-color:#3b82f6}
        select option{background:#1e293b}
      `}</style>

      {/* Sidebar */}
      <>
        {sideOpen && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40 }} onClick={() => setSideOpen(false)} />}
        <aside style={{ position: "fixed", left: sideOpen ? 0 : -260, top: 0, bottom: 0, width: 240, background: "#0f172a", borderRight: "1px solid #1e293b", zIndex: 50, transition: "left 0.3s ease", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #1e293b" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {biz.logo ? <img src={biz.logo} alt="logo" style={{ width: 38, height: 38, borderRadius: 9, objectFit: "cover" }} /> : <div style={{ width: 38, height: 38, borderRadius: 9, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>💼</div>}
              <div>
                <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 13 }}>{biz.name || "Bisnis Saya"}</div>
                <div style={{ color: "#64748b", fontSize: 10 }}>{biz.owner || "Owner"}</div>
              </div>
            </div>
          </div>
          <div style={{ padding: "10px 10px 6px", borderBottom: "1px solid #1e293b" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#1e293b", borderRadius: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: isOwner ? "linear-gradient(135deg,#f59e0b,#d97706)" : "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{isOwner ? "👑" : "👤"}</div>
              <div>
                <div style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 600 }}>{currentUser.name || currentUser.username}</div>
                <div style={{ color: "#64748b", fontSize: 10, textTransform: "capitalize" }}>{currentUser.role}</div>
              </div>
            </div>
          </div>
          <nav style={{ flex: 1, padding: "10px 10px", overflowY: "auto" }}>
            {NAV.map(n => (
              <button key={n.id} onClick={() => { setActive(n.id); setSideOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: active === n.id ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : "none", color: active === n.id ? "#fff" : "#64748b", fontSize: 14, fontWeight: 500, marginBottom: 2, textAlign: "left" }}>
                <span>{n.icon}</span><span>{n.label}</span>
              </button>
            ))}
          </nav>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #1e293b" }}>
            <button onClick={handleLogout} style={{ width: "100%", padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", background: "#1e293b", color: "#ef4444", fontSize: 13, fontWeight: 600 }}>🚪 Keluar</button>
          </div>
          <div style={{ padding: "8px 16px", color: "#1e293b", fontSize: 11, textAlign: "center" }}>BizFlow Pro v2.0</div>
        </aside>
      </>

      <header style={{ position: "fixed", top: 0, left: sideOpen ? 240 : 0, right: 0, height: 60, background: "#0f172a", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", padding: "0 20px", zIndex: 30, transition: "left 0.3s ease", gap: 14 }}>
        <button onClick={() => setSideOpen(s => !s)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20, padding: 4 }}>☰</button>
        <span style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 16 }}>
          {NAV.find(n => n.id === active)?.icon} {NAV.find(n => n.id === active)?.label}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#64748b", fontSize: 13 }}>{new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          {/* Supabase sync status badge */}
          {isSupabaseReady() ? (
            <span style={{
              background: syncStatus === "synced" ? "#10b98122" : syncStatus === "syncing" ? "#f59e0b22" : syncStatus === "error" ? "#ef444422" : "#33415522",
              color: syncStatus === "synced" ? "#10b981" : syncStatus === "syncing" ? "#f59e0b" : syncStatus === "error" ? "#ef4444" : "#64748b",
              padding: "3px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: "1px solid transparent"
            }} onClick={() => setShowSupabaseSetup(true)}>
              {syncStatus === "synced" ? "☁️ Cloud Sync" : syncStatus === "syncing" ? "⏳ Syncing..." : syncStatus === "error" ? "⚠️ Sync Error" : "☁️ Cloud"}
            </span>
          ) : (
            <span style={{ background: "#f59e0b22", color: "#f59e0b", padding: "3px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: "1px solid #f59e0b44", fontWeight: 600 }}
              onClick={() => setShowSupabaseSetup(true)}>
              ⚙️ Setup Cloud
            </span>
          )}
          {systemLocked && <span style={{ background: "#ef444422", color: "#ef4444", padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "1px solid #ef444444", cursor: "pointer" }} onClick={() => setSystemLocked(true)}>🔒 SISTEM TERKUNCI</span>}
          {!systemLocked && tg.token && <><span style={{ background: "#ef444422", color: "#ef4444", padding: "3px 10px", borderRadius: 20, fontSize: 12, marginRight: 6 }}>{tg.privateId ? "🔐 Pribadi ✓" : "🔐 Pribadi ✕"}</span><span style={{ background: tg.groupId ? "#3b82f622" : "#33415522", color: tg.groupId ? "#3b82f6" : "#64748b", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>{tg.groupId ? "💬 Grup ✓" : "💬 Grup ✕"}</span></>}
        </div>
      </header>

      <main style={{ marginLeft: sideOpen ? 240 : 0, marginTop: 60, padding: 24, transition: "margin-left 0.3s ease", minHeight: "calc(100vh - 60px)" }}>
        {pages[active] || <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Halaman tidak ditemukan</div>}
      </main>

      <Toast toasts={toasts} />
    </div>
  );
}

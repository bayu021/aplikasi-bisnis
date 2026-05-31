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

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

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
  { id: "projects", icon: "📁", label: "Proyek" },
  { id: "inventory", icon: "📦", label: "Stok Barang" },
  { id: "invoice", icon: "🧾", label: "Invoice" },
  { id: "reports", icon: "📈", label: "Laporan" },
  { id: "telegram", icon: "✈️", label: "Telegram Bot" },
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
function Dashboard({ income, expense, projects, inventory, tg, biz }) {
  const totalIn = income.reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount), 0);
  const profit = totalIn - totalOut;
  const activeProjects = projects.filter(p => p.status === "Berjalan").length;
  const lowStock = inventory.filter(i => Number(i.qty) <= Number(i.minQty || 5));

  // FIX #3: Laba bersih dari stok = harga jual - harga modal
  const grossProfitFromStock = income
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
        <StatCard label="LABA KOTOR PENJUALAN" value={formatRp(grossProfitFromStock)} icon="💹" color="#8b5cf6" sub="Harga Jual - Modal" />
        <StatCard label="PROYEK AKTIF" value={activeProjects} icon="📁" color="#06b6d4" />
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
    if (item && item.costPrice) {
      setForm(f => ({ ...f, amount: item.costPrice, desc: f.desc || `Pembelian stok: ${item.name}` }));
    }
  };

  const submit = async () => {
    if (!form.amount || !form.category) return addToast("Lengkapi semua field!", "error");

    // Validasi pembelian stok
    if (isPembelianStok) {
      if (!selectedStockItem) return addToast("Pilih barang stok yang dibeli!", "error");
      if (!stockQty || Number(stockQty) <= 0) return addToast("Masukkan jumlah stok yang dibeli!", "error");
    }

    const rec = { ...form, id: Date.now() };
    if (tab === "in") {
      const updated = [rec, ...income]; setIncome(updated); save("income", updated);
      const msg = `📢 <b>Pemasukan Baru</b>\n🏢 ${biz.name || "Bisnis"}\n📝 ${form.desc || "-"}\n📂 ${form.category}\n💰 ${formatRp(form.amount)}\n📅 ${form.date}`;
      const res = await sendTelegram(tg.token, tg.chatId, msg);
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

        const msg = `📢 <b>Pembelian Stok</b>\n🏢 ${biz.name || "Bisnis"}\n📦 ${item?.name || "-"}\n🔢 Qty: +${qty}\n💸 ${formatRp(form.amount)}\n📅 ${form.date}`;
        const res = await sendTelegram(tg.token, tg.chatId, msg);
        if (res && !res.ok) addToast("Telegram gagal: " + (res.description || res.error || "error"), "error");
      } else {
        const msg = `📢 <b>Pengeluaran Baru</b>\n🏢 ${biz.name || "Bisnis"}\n📝 ${form.desc || "-"}\n📂 ${form.category}\n💸 ${formatRp(form.amount)}\n📅 ${form.date}`;
        const res = await sendTelegram(tg.token, tg.chatId, msg);
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
        <button style={btnPrimary} onClick={() => setShowModal(true)}>+ Tambah</button>
      </div>

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

// ==================== PROJECTS ====================
function Projects({ projects, setProjects, tg, biz, addToast }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", client: "", value: "", deadline: "", status: "Pending", progress: 0, notes: "" });

  const submit = async () => {
    if (!form.name || !form.client) return addToast("Nama proyek & klien wajib!", "error");
    const rec = { ...form, id: Date.now() };
    const updated = [rec, ...projects]; setProjects(updated); save("projects", updated);
    setForm({ name: "", client: "", value: "", deadline: "", status: "Pending", progress: 0, notes: "" });
    setShowModal(false);
    addToast("Proyek berhasil ditambahkan!", "success");
    if (form.status === "Selesai") {
      await sendTelegram(tg.token, tg.chatId, `✅ <b>Proyek Selesai</b>\n🏢 ${biz.name || "-"}\n📁 ${form.name}\n👤 ${form.client}\n💰 ${formatRp(form.value)}`);
    }
  };

  const updateStatus = async (id, status) => {
    const updated = projects.map(p => p.id === id ? { ...p, status } : p);
    setProjects(updated); save("projects", updated);
    const p = projects.find(p => p.id === id);
    if (status === "Selesai" && p) {
      await sendTelegram(tg.token, tg.chatId, `✅ <b>Proyek Selesai</b>\n🏢 ${biz.name || "-"}\n📁 ${p.name}\n👤 ${p.client}\n💰 ${formatRp(p.value)}`);
    }
    addToast("Status diperbarui", "success");
  };

  const del = (id) => { const u = projects.filter(p => p.id !== id); setProjects(u); save("projects", u); addToast("Proyek dihapus", "info"); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>📁 Manajemen Proyek</h2>
        <button style={btnPrimary} onClick={() => setShowModal(true)}>+ Proyek Baru</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
        {projects.map(p => (
          <div key={p.id} style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>👤 {p.client}</div>
              </div>
              <span style={{ background: STATUS_COLOR[p.status] + "22", color: STATUS_COLOR[p.status], padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{p.status}</span>
            </div>
            {p.value && <div style={{ color: "#10b981", fontWeight: 700, fontSize: 18, marginBottom: 10 }}>{formatRp(p.value)}</div>}
            {p.deadline && <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 10 }}>📅 Deadline: {p.deadline}</div>}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "#64748b", fontSize: 12 }}>Progress</span>
                <span style={{ color: "#3b82f6", fontSize: 12, fontWeight: 600 }}>{p.progress || 0}%</span>
              </div>
              <div style={{ background: "#0f172a", borderRadius: 99, height: 6 }}>
                <div style={{ background: "linear-gradient(90deg,#3b82f6,#1d4ed8)", borderRadius: 99, height: "100%", width: `${p.progress || 0}%`, transition: "width 0.5s" }} />
              </div>
            </div>
            {p.notes && <div style={{ color: "#64748b", fontSize: 12, marginBottom: 12 }}>📝 {p.notes}</div>}
            <div style={{ display: "flex", gap: 6 }}>
              {PROJECT_STATUS.map(s => (
                <button key={s} onClick={() => updateStatus(p.id, s)} style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, background: p.status === s ? STATUS_COLOR[s] : "#0f172a", color: p.status === s ? "#fff" : "#64748b" }}>{s}</button>
              ))}
              <button onClick={() => del(p.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "0 6px" }}>🗑️</button>
            </div>
          </div>
        ))}
        {projects.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", color: "#475569", padding: 40 }}>Belum ada proyek</div>}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="📁 Proyek Baru">
        <Field label="NAMA PROYEK"><input style={inputStyle} placeholder="Nama proyek" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="NAMA KLIEN"><input style={inputStyle} placeholder="Nama klien" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} /></Field>
        <Field label="NILAI PROYEK (RP)"><input type="number" style={inputStyle} placeholder="0" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></Field>
        <Field label="DEADLINE"><input type="date" style={inputStyle} value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></Field>
        <Field label="STATUS">
          <select style={inputStyle} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {PROJECT_STATUS.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={`PROGRESS: ${form.progress}%`}><input type="range" min="0" max="100" style={{ width: "100%" }} value={form.progress} onChange={e => setForm({ ...form, progress: Number(e.target.value) })} /></Field>
        <Field label="CATATAN"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} placeholder="Catatan..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowModal(false)}>Batal</button>
          <button style={btnPrimary} onClick={submit}>Simpan</button>
        </div>
      </Modal>
    </div>
  );
}

// ==================== INVENTORY ====================
// FIX #2 & #3: Saat stok keluar → otomatis tambah ke pemasukan dengan harga jual,
// laba bersih = harga jual - harga modal dicatat di record
function Inventory({ inventory, setInventory, income, setIncome, tg, biz, addToast }) {
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
          grossProfit,            // FIX #3: laba kotor tersimpan
        };
        const updatedIncome = [saleRecord, ...income];
        setIncome(updatedIncome); save("income", updatedIncome);
        addToast(`Penjualan ${formatRp(totalSell)} otomatis dicatat! Laba: ${formatRp(grossProfit)}`, "success");

        // Telegram notif
        const msg = `🛒 <b>Penjualan Stok</b>\n🏢 ${biz.name || "Bisnis"}\n📦 ${txItem.name} x${qty}\n💰 Harga Jual: ${formatRp(totalSell)}\n📉 Modal: ${formatRp(totalCost)}\n💹 Laba: ${formatRp(grossProfit)}\n📅 ${today()}`;
        const res = await sendTelegram(tg.token, tg.chatId, msg);
        if (res && !res.ok) addToast("Telegram: " + (res.description || res.error), "error");
      } else {
        addToast("Harga jual belum diset, penjualan tidak dicatat otomatis", "error");
      }
    }

    // Stok menipis?
    if (Number(item.qty) <= Number(item.minQty || 5)) {
      const msg = `⚠️ <b>Stok Menipis!</b>\n🏢 ${biz.name || "Bisnis"}\n📦 ${item.name}\n📉 Sisa Stok: ${item.qty}\n🔴 Minimum: ${item.minQty || 5}`;
      await sendTelegram(tg.token, tg.chatId, msg);
      addToast(`⚠️ Stok ${item.name} menipis (${item.qty})`, "error");
    }

    setShowTxModal(false); setTxQty(""); setTxNote(""); setTxItem(null);
    if (txType === "in") addToast("Stok berhasil ditambahkan!", "success");
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
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>📦 Manajemen Stok</h2>
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
function Reports({ income, expense, projects, inventory }) {
  const totalIn = income.reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount), 0);
  // FIX #3: Laba bersih terisi dari harga jual - modal (grossProfit)
  const totalGrossProfit = income.filter(r => r.fromStock).reduce((s, r) => s + Number(r.grossProfit || 0), 0);
  const netProfit = totalIn - totalOut;

  const printReport = () => {
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Laporan</title><style>body{font-family:sans-serif;padding:32px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:10px;border:1px solid #ddd;font-size:13px}th{background:#f0f4ff}</style></head><body>
      <h1>Laporan Cash Flow</h1>
      <p>Total Pemasukan: <b>Rp ${totalIn.toLocaleString("id-ID")}</b></p>
      <p>Total Pengeluaran: <b>Rp ${totalOut.toLocaleString("id-ID")}</b></p>
      <p>Net Cash Flow: <b>Rp ${netProfit.toLocaleString("id-ID")}</b></p>
      <p>Laba Kotor Penjualan (Jual-Modal): <b>Rp ${totalGrossProfit.toLocaleString("id-ID")}</b></p>
      <h2>Pemasukan</h2><table><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Nominal</th><th>Laba</th></tr>
      ${income.map(r => `<tr><td>${r.date}</td><td>${r.category}</td><td>${r.desc||"-"}</td><td>Rp ${Number(r.amount).toLocaleString("id-ID")}</td><td>${r.grossProfit ? "Rp " + Number(r.grossProfit).toLocaleString("id-ID") : "-"}</td></tr>`).join("")}
      </table><h2>Pengeluaran</h2><table><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Nominal</th></tr>
      ${expense.map(r => `<tr><td>${r.date}</td><td>${r.category}</td><td>${r.desc||"-"}</td><td>Rp ${Number(r.amount).toLocaleString("id-ID")}</td></tr>`).join("")}
      </table></body></html>`);
    w.print();
  };

  const exportCSV = () => {
    const rows = [
      ["Jenis","Tanggal","Kategori","Deskripsi","Nominal","Laba Kotor"],
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
        <StatCard label="LABA KOTOR PENJUALAN" value={formatRp(totalGrossProfit)} icon="💹" color="#8b5cf6" sub="Jual - Modal" />
        <StatCard label="TOTAL PROYEK" value={projects.length} icon="📁" color="#f59e0b" />
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
  const [form, setForm] = useState(tg);
  const [testing, setTesting] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const test = async () => {
    if (!form.token || !form.chatId) return addToast("Isi Bot Token dan Chat ID terlebih dahulu!", "error");
    setTesting(true); setLastResult(null);
    const res = await sendTelegram(form.token, form.chatId, `✅ <b>Test BizFlow Pro</b>\n\nIntegrasi Telegram berhasil!\n🤖 Bot aktif dan siap menerima notifikasi.\n📅 ${new Date().toLocaleString("id-ID")}`);
    setTesting(false);
    setLastResult(res);
    if (res && res.ok) {
      addToast("✅ Pesan test berhasil terkirim ke Telegram!", "success");
    } else {
      const errMsg = res?.description || res?.error || "Tidak diketahui";
      addToast("❌ Gagal: " + errMsg, "error");
    }
  };

  const saveTg = () => { setTg(form); save("telegram", form); addToast("Pengaturan Telegram disimpan!", "success"); };

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: 22 }}>✈️ Pengaturan Telegram Bot</h2>
      <div style={{ maxWidth: 580 }}>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155", marginBottom: 20 }}>
          <div style={{ background: "#0f172a", borderRadius: 10, padding: 16, marginBottom: 20, color: "#94a3b8", fontSize: 13, lineHeight: 1.8 }}>
            <strong style={{ color: "#3b82f6" }}>📋 Cara Setup Bot Telegram:</strong><br />
            1. Buka Telegram → cari <code style={{ background: "#1e293b", padding: "1px 5px", borderRadius: 4 }}>@BotFather</code><br />
            2. Ketik <code style={{ background: "#1e293b", padding: "1px 5px", borderRadius: 4 }}>/newbot</code> → ikuti instruksi → salin <strong style={{ color: "#f1f5f9" }}>Bot Token</strong><br />
            3. Untuk Chat ID pribadi: cari <code style={{ background: "#1e293b", padding: "1px 5px", borderRadius: 4 }}>@userinfobot</code> → klik Start<br />
            4. Untuk grup: tambahkan bot ke grup → kirim pesan → cek<br /><code style={{ background: "#1e293b", padding: "1px 5px", borderRadius: 4 }}>https://api.telegram.org/bot[TOKEN]/getUpdates</code><br />
            5. Masukkan token & chat ID → Simpan → Test
          </div>

          <Field label="BOT TOKEN">
            <input style={inputStyle} value={form.token || ""} onChange={e => setForm({ ...form, token: e.target.value })} placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ" />
          </Field>
          <Field label="CHAT ID (angka, contoh: 123456789 atau -100xxxx untuk grup)">
            <input style={inputStyle} value={form.chatId || ""} onChange={e => setForm({ ...form, chatId: e.target.value })} placeholder="123456789" />
          </Field>

          {lastResult && (
            <div style={{ background: lastResult.ok ? "#10b98122" : "#ef444422", border: `1px solid ${lastResult.ok ? "#10b981" : "#ef4444"}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
              {lastResult.ok
                ? <span style={{ color: "#10b981" }}>✅ Berhasil! Pesan terkirim ke chat ID: {lastResult.result?.chat?.id}</span>
                : <span style={{ color: "#ef4444" }}>❌ Gagal: {lastResult.description || lastResult.error}<br /><span style={{ color: "#94a3b8", fontSize: 12 }}>Pastikan token benar, bot sudah di-start, dan chat ID valid.</span></span>
              }
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnPrimary} onClick={saveTg}>💾 Simpan</button>
            <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#0088cc,#0066aa)", opacity: testing ? 0.7 : 1 }} onClick={test} disabled={testing}>
              {testing ? "⏳ Mengirim..." : "📨 Kirim Test"}
            </button>
          </div>
        </div>

        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <h4 style={{ color: "#f1f5f9", margin: "0 0 12px" }}>🔔 Notifikasi Otomatis</h4>
          {[
            { icon: "💰", label: "Pemasukan baru ditambahkan" },
            { icon: "💸", label: "Pengeluaran baru ditambahkan" },
            { icon: "🛒", label: "Penjualan stok (dengan detail laba)" },
            { icon: "✅", label: "Proyek selesai" },
            { icon: "⚠️", label: "Stok barang di bawah minimum" },
          ].map(n => (
            <div key={n.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #0f172a", color: "#94a3b8", fontSize: 14 }}>
              <span>{n.icon}</span> {n.label} <span style={{ marginLeft: "auto", color: "#10b981", fontSize: 12 }}>Aktif ✓</span>
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
export default function App() {
  // FIX #4: Loading screen state
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(true);
  const [biz, setBiz] = useState(() => load("biz", {}));
  const [income, setIncome] = useState(() => load("income", []));
  const [expense, setExpense] = useState(() => load("expense", []));
  const [projects, setProjects] = useState(() => load("projects", []));
  const [inventory, setInventory] = useState(() => load("inventory", []));
  const [tg, setTg] = useState(() => load("telegram", { token: "", chatId: "" }));
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  if (loading) return <LoadingScreen onDone={() => setLoading(false)} />;

  const sharedProps = { income, setIncome, expense, setExpense, projects, setProjects, inventory, setInventory, tg, setTg, biz, setBiz, addToast };

  const pages = {
    dashboard: <Dashboard {...sharedProps} />,
    cashflow: <CashFlow {...sharedProps} />,
    projects: <Projects {...sharedProps} />,
    inventory: <Inventory income={income} setIncome={setIncome} inventory={inventory} setInventory={setInventory} tg={tg} biz={biz} addToast={addToast} />,
    invoice: <Invoice {...sharedProps} />,
    reports: <Reports {...sharedProps} />,
    telegram: <TelegramSettings {...sharedProps} />,
    settings: <Settings {...sharedProps} />,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1e", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
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

      <Sidebar active={active} setActive={setActive} biz={biz} sideOpen={sideOpen} setSideOpen={setSideOpen} />

      <header style={{ position: "fixed", top: 0, left: sideOpen ? 240 : 0, right: 0, height: 60, background: "#0f172a", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", padding: "0 20px", zIndex: 30, transition: "left 0.3s ease", gap: 14 }}>
        <button onClick={() => setSideOpen(s => !s)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20, padding: 4 }}>☰</button>
        <span style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 16 }}>
          {NAV.find(n => n.id === active)?.icon} {NAV.find(n => n.id === active)?.label}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#64748b", fontSize: 13 }}>{new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          {tg.token && <span style={{ background: "#10b98122", color: "#10b981", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>✈️ Telegram Aktif</span>}
        </div>
      </header>

      <main style={{ marginLeft: sideOpen ? 240 : 0, marginTop: 60, padding: 24, transition: "margin-left 0.3s ease", minHeight: "calc(100vh - 60px)" }}>
        {pages[active]}
      </main>

      <Toast toasts={toasts} />
    </div>
  );
}

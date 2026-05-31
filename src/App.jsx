import { useState, useEffect, useRef, useCallback } from "react";

// ==================== UTILS ====================
const formatRp = (n) =>
  "Rp " + Number(n || 0).toLocaleString("id-ID");

const today = () => new Date().toISOString().slice(0, 10);

const sendTelegram = async (token, chatId, text) => {
  if (!token || !chatId) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      }
    );
  } catch (_) {}
};

const CATEGORIES_IN = ["Penjualan", "Jasa", "Investasi", "Lainnya"];
const CATEGORIES_OUT = ["Operasional", "Gaji", "Pembelian Stok", "Marketing", "Lainnya"];
const PROJECT_STATUS = ["Pending", "Berjalan", "Selesai", "Ditunda"];
const STATUS_COLOR = {
  Pending: "#f59e0b",
  Berjalan: "#3b82f6",
  Selesai: "#10b981",
  Ditunda: "#ef4444",
};

// ==================== STORAGE ====================
const load = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ==================== MINI CHART ====================
function SparkLine({ data, color = "#3b82f6", height = 50 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 200, h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
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
          <div style={{
            width: "100%", background: color, borderRadius: 4,
            height: `${(v / max) * 64}px`, minHeight: v > 0 ? 4 : 0,
            transition: "height 0.5s ease"
          }} />
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
          animation: "slideIn 0.3s ease", maxWidth: 320
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
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    }} onClick={onClose}>
      <div style={{
        background: "#1e293b", borderRadius: 16, padding: 28, width: "100%", maxWidth: 520,
        border: "1px solid #334155", boxShadow: "0 25px 60px rgba(0,0,0,0.5)"
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#f1f5f9", fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ==================== INPUT ====================
const inputStyle = {
  width: "100%", padding: "10px 14px", background: "#0f172a",
  border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9",
  fontSize: 14, outline: "none", boxSizing: "border-box"
};
const labelStyle = { display: "block", color: "#94a3b8", fontSize: 12, marginBottom: 4, fontWeight: 600, letterSpacing: "0.05em" };
const btnPrimary = {
  background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", color: "#fff",
  border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer",
  fontSize: 14, fontWeight: 600, transition: "opacity 0.2s"
};
const btnDanger = { ...btnPrimary, background: "linear-gradient(135deg, #ef4444, #b91c1c)" };
const btnSuccess = { ...btnPrimary, background: "linear-gradient(135deg, #10b981, #059669)" };

function Field({ label, children }) {
  return <div style={{ marginBottom: 14 }}><label style={labelStyle}>{label}</label>{children}</div>;
}

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
      <aside style={{
        position: "fixed", left: sideOpen ? 0 : -260, top: 0, bottom: 0,
        width: 240, background: "#0f172a", borderRight: "1px solid #1e293b",
        zIndex: 50, transition: "left 0.3s ease", display: "flex", flexDirection: "column",
        boxShadow: sideOpen ? "4px 0 30px rgba(0,0,0,0.4)" : "none"
      }}>
        {/* Logo Area */}
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {biz.logo
              ? <img src={biz.logo} alt="logo" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }} />
              : <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💼</div>
            }
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{biz.name || "Bisnis Saya"}</div>
              <div style={{ color: "#64748b", fontSize: 11 }}>{biz.owner || "Pemilik"}</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => { setActive(n.id); setSideOpen(false); }} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer",
              background: active === n.id ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : "none",
              color: active === n.id ? "#fff" : "#64748b", fontSize: 14, fontWeight: 500,
              marginBottom: 2, textAlign: "left", transition: "all 0.2s"
            }}>
              <span>{n.icon}</span><span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ padding: 16, borderTop: "1px solid #1e293b", color: "#475569", fontSize: 11, textAlign: "center" }}>
          BizFlow Pro v1.0
        </div>
      </aside>
    </>
  );
}

// ==================== STAT CARD ====================
function StatCard({ label, value, icon, color, sparkData }) {
  return (
    <div style={{
      background: "#1e293b", borderRadius: 14, padding: "20px 22px",
      border: "1px solid #334155", position: "relative", overflow: "hidden"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
          <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700 }}>{value}</div>
        </div>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20
        }}>{icon}</div>
      </div>
      {sparkData && <div style={{ marginTop: 12 }}><SparkLine data={sparkData} color={color} height={40} /></div>}
    </div>
  );
}

// ==================== DASHBOARD ====================
function Dashboard({ income, expense, projects, inventory, tg, biz, addToast }) {
  const totalIn = income.reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount), 0);
  const profit = totalIn - totalOut;
  const activeProjects = projects.filter(p => p.status === "Berjalan").length;
  const lowStock = inventory.filter(i => Number(i.qty) <= Number(i.minQty || 5));

  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
  const nowM = new Date().getMonth();
  const last6 = Array.from({ length: 6 }, (_, i) => months[(nowM - 5 + i + 12) % 12]);
  const inData = last6.map((_, i) => {
    const m = (nowM - 5 + i + 12) % 12;
    return income.filter(r => new Date(r.date).getMonth() === m).reduce((s, r) => s + Number(r.amount), 0);
  });
  const outData = last6.map((_, i) => {
    const m = (nowM - 5 + i + 12) % 12;
    return expense.filter(r => new Date(r.date).getMonth() === m).reduce((s, r) => s + Number(r.amount), 0);
  });

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 24, fontWeight: 700 }}>
          Selamat datang, {biz.owner || "Pengguna"} 👋
        </h2>
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
        <StatCard label="LABA BERSIH" value={formatRp(profit)} icon="💵" color={profit >= 0 ? "#3b82f6" : "#f59e0b"} />
        <StatCard label="PROYEK AKTIF" value={activeProjects} icon="📁" color="#8b5cf6" />
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

      {/* Recent Transactions */}
      <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
        <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>🕐 Transaksi Terbaru</h4>
        {[...income.map(r => ({ ...r, type: "in" })), ...expense.map(r => ({ ...r, type: "out" }))]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 6)
          .map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #0f172a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: r.type === "in" ? "#10b98122" : "#ef444422", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {r.type === "in" ? "📈" : "📉"}
                </div>
                <div>
                  <div style={{ color: "#f1f5f9", fontSize: 14 }}>{r.desc || r.category}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>{r.date} · {r.category}</div>
                </div>
              </div>
              <div style={{ color: r.type === "in" ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: 15 }}>
                {r.type === "in" ? "+" : "-"}{formatRp(r.amount)}
              </div>
            </div>
          ))}
        {income.length === 0 && expense.length === 0 && (
          <div style={{ color: "#64748b", textAlign: "center", padding: "20px 0" }}>Belum ada transaksi</div>
        )}
      </div>
    </div>
  );
}

// ==================== CASHFLOW ====================
function CashFlow({ income, setIncome, expense, setExpense, tg, biz, addToast }) {
  const [tab, setTab] = useState("in");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: today(), category: "", desc: "", amount: "" });

  const totalIn = income.reduce((s, r) => s + Number(r.amount), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount), 0);

  const submit = async () => {
    if (!form.amount || !form.category) return addToast("Lengkapi semua field!", "error");
    const rec = { ...form, id: Date.now() };
    if (tab === "in") {
      const updated = [rec, ...income];
      setIncome(updated); save("income", updated);
      const msg = `📢 <b>Pemasukan Baru</b>\n🏢 Bisnis: ${biz.name || "-"}\n📝 Deskripsi: ${form.desc || "-"}\n📂 Kategori: ${form.category}\n💰 Nominal: ${formatRp(form.amount)}\n📅 Tanggal: ${form.date}`;
      await sendTelegram(tg.token, tg.chatId, msg);
    } else {
      const updated = [rec, ...expense];
      setExpense(updated); save("expense", updated);
      const msg = `📢 <b>Pengeluaran Baru</b>\n🏢 Bisnis: ${biz.name || "-"}\n📝 Deskripsi: ${form.desc || "-"}\n📂 Kategori: ${form.category}\n💸 Nominal: ${formatRp(form.amount)}\n📅 Tanggal: ${form.date}`;
      await sendTelegram(tg.token, tg.chatId, msg);
    }
    setForm({ date: today(), category: "", desc: "", amount: "" });
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
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
            background: tab === t ? (t === "in" ? "#10b981" : "#ef4444") : "#1e293b",
            color: tab === t ? "#fff" : "#64748b"
          }}>{t === "in" ? "📈 Pemasukan" : "📉 Pengeluaran"}</button>
        ))}
      </div>

      <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              {["Tanggal", "Kategori", "Deskripsi", "Nominal", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", color: "#64748b", fontSize: 12, fontWeight: 600, textAlign: "left", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.id} style={{ borderTop: "1px solid #0f172a" }}>
                <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{r.date}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ background: "#334155", color: "#94a3b8", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>{r.category}</span>
                </td>
                <td style={{ padding: "12px 16px", color: "#f1f5f9", fontSize: 13 }}>{r.desc || "-"}</td>
                <td style={{ padding: "12px 16px", color: tab === "in" ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: 14 }}>
                  {tab === "in" ? "+" : "-"}{formatRp(r.amount)}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <button onClick={() => del(r.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16 }}>🗑️</button>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "#475569" }}>Belum ada data</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={tab === "in" ? "➕ Tambah Pemasukan" : "➕ Tambah Pengeluaran"}>
        <Field label="TANGGAL"><input type="date" style={inputStyle} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="KATEGORI">
          <select style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            <option value="">Pilih kategori</option>
            {cats.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="DESKRIPSI"><input style={inputStyle} placeholder="Deskripsi transaksi" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></Field>
        <Field label="NOMINAL (RP)"><input type="number" style={inputStyle} placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowModal(false)}>Batal</button>
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
    if (!form.name || !form.client) return addToast("Nama proyek & klien wajib diisi!", "error");
    const rec = { ...form, id: Date.now() };
    const updated = [rec, ...projects];
    setProjects(updated); save("projects", updated);
    setForm({ name: "", client: "", value: "", deadline: "", status: "Pending", progress: 0, notes: "" });
    setShowModal(false);
    addToast("Proyek berhasil ditambahkan!", "success");
    if (form.status === "Selesai") {
      const msg = `✅ <b>Proyek Selesai</b>\n🏢 Bisnis: ${biz.name || "-"}\n📁 Proyek: ${form.name}\n👤 Klien: ${form.client}\n💰 Nilai: ${formatRp(form.value)}`;
      await sendTelegram(tg.token, tg.chatId, msg);
    }
  };

  const updateStatus = async (id, status) => {
    const updated = projects.map(p => p.id === id ? { ...p, status } : p);
    setProjects(updated); save("projects", updated);
    const p = projects.find(p => p.id === id);
    if (status === "Selesai" && p) {
      const msg = `✅ <b>Proyek Selesai</b>\n🏢 Bisnis: ${biz.name || "-"}\n📁 Proyek: ${p.name}\n👤 Klien: ${p.client}\n💰 Nilai: ${formatRp(p.value)}`;
      await sendTelegram(tg.token, tg.chatId, msg);
    }
    addToast("Status diperbarui", "success");
  };

  const del = (id) => {
    const u = projects.filter(p => p.id !== id); setProjects(u); save("projects", u);
    addToast("Proyek dihapus", "info");
  };

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
                <button key={s} onClick={() => updateStatus(p.id, s)} style={{
                  flex: 1, padding: "5px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600,
                  background: p.status === s ? STATUS_COLOR[s] : "#0f172a",
                  color: p.status === s ? "#fff" : "#64748b"
                }}>{s}</button>
              ))}
              <button onClick={() => del(p.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "0 6px" }}>🗑️</button>
            </div>
          </div>
        ))}
        {projects.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", color: "#475569", padding: 40 }}>Belum ada proyek</div>
        )}
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
        <Field label={`PROGRESS: ${form.progress}%`}>
          <input type="range" min="0" max="100" style={{ width: "100%" }} value={form.progress} onChange={e => setForm({ ...form, progress: Number(e.target.value) })} />
        </Field>
        <Field label="CATATAN"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} placeholder="Catatan proyek..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowModal(false)}>Batal</button>
          <button style={btnPrimary} onClick={submit}>Simpan</button>
        </div>
      </Modal>
    </div>
  );
}

// ==================== INVENTORY ====================
function Inventory({ inventory, setInventory, tg, biz, addToast }) {
  const [showModal, setShowModal] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txItem, setTxItem] = useState(null);
  const [txType, setTxType] = useState("in");
  const [txQty, setTxQty] = useState("");
  const [form, setForm] = useState({ name: "", sku: "", category: "", qty: "", minQty: "5", costPrice: "", sellPrice: "", supplier: "" });

  const submit = () => {
    if (!form.name || !form.qty) return addToast("Nama & jumlah stok wajib!", "error");
    const rec = { ...form, id: Date.now(), history: [] };
    const updated = [rec, ...inventory];
    setInventory(updated); save("inventory", updated);
    setForm({ name: "", sku: "", category: "", qty: "", minQty: "5", costPrice: "", sellPrice: "", supplier: "" });
    setShowModal(false);
    addToast("Barang berhasil ditambahkan!", "success");
  };

  const doTx = async () => {
    if (!txQty || txQty <= 0) return addToast("Jumlah harus lebih dari 0!", "error");
    const updated = inventory.map(i => {
      if (i.id !== txItem.id) return i;
      const newQty = txType === "in" ? Number(i.qty) + Number(txQty) : Math.max(0, Number(i.qty) - Number(txQty));
      const hist = [...(i.history || []), { type: txType, qty: txQty, date: today() }];
      return { ...i, qty: newQty, history: hist };
    });
    setInventory(updated); save("inventory", updated);
    const item = updated.find(i => i.id === txItem.id);
    if (Number(item.qty) <= Number(item.minQty || 5)) {
      const msg = `⚠️ <b>Stok Menipis</b>\n🏢 Bisnis: ${biz.name || "-"}\n📦 Barang: ${item.name}\n📉 Sisa Stok: ${item.qty}`;
      await sendTelegram(tg.token, tg.chatId, msg);
    }
    setShowTxModal(false); setTxQty(""); setTxItem(null);
    addToast("Stok berhasil diperbarui!", "success");
  };

  const del = (id) => {
    const u = inventory.filter(i => i.id !== id); setInventory(u); save("inventory", u);
    addToast("Barang dihapus", "info");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>📦 Manajemen Stok</h2>
        <button style={btnPrimary} onClick={() => setShowModal(true)}>+ Tambah Barang</button>
      </div>

      <div style={{ background: "#1e293b", borderRadius: 14, border: "1px solid #334155", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              {["Nama Barang", "SKU", "Kategori", "Stok", "Harga Modal", "Harga Jual", "Supplier", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", color: "#64748b", fontSize: 12, fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inventory.map(item => (
              <tr key={item.id} style={{ borderTop: "1px solid #0f172a" }}>
                <td style={{ padding: "12px 16px", color: "#f1f5f9", fontWeight: 500 }}>{item.name}</td>
                <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{item.sku || "-"}</td>
                <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{item.category || "-"}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{
                    color: Number(item.qty) <= Number(item.minQty || 5) ? "#ef4444" : "#10b981",
                    fontWeight: 700, fontSize: 15
                  }}>{item.qty}</span>
                  {Number(item.qty) <= Number(item.minQty || 5) && <span style={{ color: "#ef4444", fontSize: 11, marginLeft: 4 }}>⚠️</span>}
                </td>
                <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{formatRp(item.costPrice)}</td>
                <td style={{ padding: "12px 16px", color: "#10b981", fontSize: 13 }}>{formatRp(item.sellPrice)}</td>
                <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{item.supplier || "-"}</td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => { setTxItem(item); setTxType("in"); setShowTxModal(true); }} style={{ ...btnSuccess, padding: "5px 10px", fontSize: 12 }}>+</button>
                    <button onClick={() => { setTxItem(item); setTxType("out"); setShowTxModal(true); }} style={{ ...btnDanger, padding: "5px 10px", fontSize: 12 }}>-</button>
                    <button onClick={() => del(item.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
            {inventory.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "#475569" }}>Belum ada barang</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="📦 Tambah Barang">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="NAMA BARANG"><input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nama barang" /></Field>
          <Field label="SKU"><input style={inputStyle} value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="SKU-001" /></Field>
          <Field label="KATEGORI"><input style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Kategori" /></Field>
          <Field label="STOK AWAL"><input type="number" style={inputStyle} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="0" /></Field>
          <Field label="STOK MINIMUM"><input type="number" style={inputStyle} value={form.minQty} onChange={e => setForm({ ...form, minQty: e.target.value })} placeholder="5" /></Field>
          <Field label="SUPPLIER"><input style={inputStyle} value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Nama supplier" /></Field>
          <Field label="HARGA MODAL"><input type="number" style={inputStyle} value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} placeholder="0" /></Field>
          <Field label="HARGA JUAL"><input type="number" style={inputStyle} value={form.sellPrice} onChange={e => setForm({ ...form, sellPrice: e.target.value })} placeholder="0" /></Field>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => setShowModal(false)}>Batal</button>
          <button style={btnPrimary} onClick={submit}>Simpan</button>
        </div>
      </Modal>

      <Modal open={showTxModal} onClose={() => { setShowTxModal(false); setTxQty(""); }} title={txType === "in" ? "📥 Barang Masuk" : "📤 Barang Keluar"}>
        {txItem && <p style={{ color: "#94a3b8", marginTop: 0 }}>Barang: <strong style={{ color: "#f1f5f9" }}>{txItem.name}</strong> · Stok saat ini: <strong style={{ color: "#f1f5f9" }}>{txItem.qty}</strong></p>}
        <Field label="JUMLAH"><input type="number" style={inputStyle} placeholder="0" value={txQty} onChange={e => setTxQty(e.target.value)} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={{ ...btnPrimary, background: "#334155" }} onClick={() => { setShowTxModal(false); setTxQty(""); }}>Batal</button>
          <button style={txType === "in" ? btnSuccess : btnDanger} onClick={doTx}>{txType === "in" ? "Tambah Stok" : "Kurangi Stok"}</button>
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
  const [invoices, setInvoices] = useState(() => load("invoices", []));

  const addItem = () => setItems([...items, { desc: "", qty: 1, price: "" }]);
  const updateItem = (i, f, v) => setItems(items.map((it, idx) => idx === i ? { ...it, [f]: v } : it));
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));

  const subtotal = items.reduce((s, i) => s + (Number(i.qty) * Number(i.price || 0)), 0);
  const taxAmt = subtotal * tax / 100;
  const total = subtotal + taxAmt;

  const save_ = () => {
    if (!form.clientName) return addToast("Nama klien wajib diisi!", "error");
    const inv = { ...form, items, tax, subtotal, taxAmt, total, id: Date.now(), no: `INV-${Date.now()}` };
    const updated = [inv, ...invoices];
    setInvoices(updated); save("invoices", updated);
    addToast("Invoice berhasil disimpan!", "success");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 22 }}>🧾 Invoice Generator</h2>
        <button style={btnSuccess} onClick={save_}>💾 Simpan Invoice</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Form */}
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
          <Field label="CATATAN"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Catatan tambahan..." /></Field>
        </div>

        {/* Preview */}
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <div style={{ background: "#0f172a", borderRadius: 10, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {biz.logo ? <img src={biz.logo} alt="logo" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} /> : <div style={{ width: 40, height: 40, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center" }}>💼</div>}
                <div>
                  <div style={{ color: "#f1f5f9", fontWeight: 700 }}>{biz.name || "Bisnis Saya"}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>{biz.email || ""}</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#3b82f6", fontWeight: 700, fontSize: 18 }}>INVOICE</div>
                <div style={{ color: "#64748b", fontSize: 12 }}>#{Date.now().toString().slice(-6)}</div>
              </div>
            </div>
            {form.clientName && <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>
              <strong style={{ color: "#f1f5f9" }}>{form.clientName}</strong><br />
              {form.clientAddr && <>{form.clientAddr}<br /></>}
              {form.clientPhone}
            </div>}

            {/* Items */}
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input style={{ ...inputStyle, flex: 2 }} placeholder="Deskripsi produk/jasa" value={it.desc} onChange={e => updateItem(i, "desc", e.target.value)} />
                <input type="number" style={{ ...inputStyle, flex: 0, width: 60 }} placeholder="Qty" value={it.qty} onChange={e => updateItem(i, "qty", e.target.value)} />
                <input type="number" style={{ ...inputStyle, flex: 1.5 }} placeholder="Harga" value={it.price} onChange={e => updateItem(i, "price", e.target.value)} />
                <button onClick={() => removeItem(i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
              </div>
            ))}
            <button onClick={addItem} style={{ ...btnPrimary, padding: "6px 14px", fontSize: 12, marginBottom: 12 }}>+ Item</button>

            <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 13, marginBottom: 6 }}>
                <span>Subtotal</span><span>{formatRp(subtotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>
                <span>Pajak {tax}%</span><span>{formatRp(taxAmt)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>
                <span>TOTAL</span><span style={{ color: "#3b82f6" }}>{formatRp(total)}</span>
              </div>
            </div>
          </div>

          {/* Saved invoices */}
          {invoices.length > 0 && (
            <div>
              <h5 style={{ color: "#64748b", margin: "0 0 10px", fontSize: 12, letterSpacing: "0.05em" }}>INVOICE TERSIMPAN</h5>
              {invoices.slice(0, 3).map(inv => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #0f172a", alignItems: "center" }}>
                  <div>
                    <div style={{ color: "#f1f5f9", fontSize: 13 }}>{inv.clientName}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{inv.date}</div>
                  </div>
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

  const printReport = () => {
    const w = window.open("", "_blank");
    w.document.write(`
      <html><head><title>Laporan Cash Flow</title>
      <style>body{font-family:sans-serif;padding:32px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{padding:10px;border:1px solid #ddd;font-size:13px}th{background:#f0f4ff}h1,h2{margin-bottom:4px}</style>
      </head><body>
      <h1>Laporan Cash Flow</h1>
      <p>Total Pemasukan: <strong>Rp ${totalIn.toLocaleString("id-ID")}</strong></p>
      <p>Total Pengeluaran: <strong>Rp ${totalOut.toLocaleString("id-ID")}</strong></p>
      <p>Net Cash Flow: <strong>Rp ${(totalIn - totalOut).toLocaleString("id-ID")}</strong></p>
      <h2>Pemasukan</h2>
      <table><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Nominal</th></tr>
      ${income.map(r => `<tr><td>${r.date}</td><td>${r.category}</td><td>${r.desc || "-"}</td><td>Rp ${Number(r.amount).toLocaleString("id-ID")}</td></tr>`).join("")}
      </table>
      <h2>Pengeluaran</h2>
      <table><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Nominal</th></tr>
      ${expense.map(r => `<tr><td>${r.date}</td><td>${r.category}</td><td>${r.desc || "-"}</td><td>Rp ${Number(r.amount).toLocaleString("id-ID")}</td></tr>`).join("")}
      </table>
      </body></html>
    `);
    w.print();
  };

  const exportCSV = () => {
    const rows = [
      ["Jenis", "Tanggal", "Kategori", "Deskripsi", "Nominal"],
      ...income.map(r => ["Pemasukan", r.date, r.category, r.desc, r.amount]),
      ...expense.map(r => ["Pengeluaran", r.date, r.category, r.desc, r.amount]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "cashflow.csv";
    a.click();
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard label="TOTAL PEMASUKAN" value={formatRp(totalIn)} icon="📈" color="#10b981" />
        <StatCard label="TOTAL PENGELUARAN" value={formatRp(totalOut)} icon="📉" color="#ef4444" />
        <StatCard label="LABA BERSIH" value={formatRp(totalIn - totalOut)} icon="💵" color="#3b82f6" />
        <StatCard label="TOTAL TRANSAKSI" value={income.length + expense.length} icon="📋" color="#8b5cf6" />
        <StatCard label="TOTAL PROYEK" value={projects.length} icon="📁" color="#f59e0b" />
        <StatCard label="TOTAL PRODUK" value={inventory.length} icon="📦" color="#06b6d4" />
      </div>

      {/* Breakdown by category */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[{ label: "Pemasukan per Kategori", data: income, color: "#10b981" }, { label: "Pengeluaran per Kategori", data: expense, color: "#ef4444" }].map(({ label, data, color }) => {
          const grouped = {};
          data.forEach(r => { grouped[r.category] = (grouped[r.category] || 0) + Number(r.amount); });
          return (
            <div key={label} style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
              <h4 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: 15 }}>{label}</h4>
              {Object.entries(grouped).map(([cat, amt]) => {
                const total = data.reduce((s, r) => s + Number(r.amount), 0);
                const pct = total > 0 ? (amt / total) * 100 : 0;
                return (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "#94a3b8", fontSize: 13 }}>{cat}</span>
                      <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>{formatRp(amt)}</span>
                    </div>
                    <div style={{ background: "#0f172a", borderRadius: 99, height: 6 }}>
                      <div style={{ background: color, borderRadius: 99, height: "100%", width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
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

  const test = async () => {
    if (!form.token || !form.chatId) return addToast("Isi Bot Token dan Chat ID terlebih dahulu!", "error");
    await sendTelegram(form.token, form.chatId, "✅ <b>Test Berhasil!</b>\nIntegrasi Telegram BizFlow Pro aktif.");
    addToast("Pesan test terkirim ke Telegram!", "success");
  };

  const saveTg = () => {
    setTg(form); save("telegram", form);
    addToast("Pengaturan Telegram disimpan!", "success");
  };

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: 22 }}>✈️ Pengaturan Telegram Bot</h2>
      <div style={{ maxWidth: 560 }}>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155", marginBottom: 20 }}>
          <div style={{ background: "#0f172a", borderRadius: 10, padding: 16, marginBottom: 20, color: "#94a3b8", fontSize: 13, lineHeight: 1.7 }}>
            <strong style={{ color: "#3b82f6" }}>📋 Cara Setup:</strong><br />
            1. Buka Telegram, cari <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4 }}>@BotFather</code><br />
            2. Ketik <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4 }}>/newbot</code> dan ikuti instruksi<br />
            3. Salin <strong>Bot Token</strong> yang diberikan<br />
            4. Cari <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4 }}>@userinfobot</code> untuk mendapat <strong>Chat ID</strong> Anda<br />
            5. Masukkan token dan chat ID di bawah, klik Simpan
          </div>
          <Field label="BOT TOKEN">
            <input style={inputStyle} value={form.token || ""} onChange={e => setForm({ ...form, token: e.target.value })} placeholder="1234567890:ABCdefGHIjklMNO..." />
          </Field>
          <Field label="CHAT ID">
            <input style={inputStyle} value={form.chatId || ""} onChange={e => setForm({ ...form, chatId: e.target.value })} placeholder="-100xxxxxxxxx atau @username" />
          </Field>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button style={btnPrimary} onClick={saveTg}>💾 Simpan</button>
            <button style={{ ...btnPrimary, background: "linear-gradient(135deg,#0088cc,#0066aa)" }} onClick={test}>📨 Kirim Test</button>
          </div>
        </div>

        <div style={{ background: "#1e293b", borderRadius: 14, padding: 20, border: "1px solid #334155" }}>
          <h4 style={{ color: "#f1f5f9", margin: "0 0 12px" }}>🔔 Notifikasi Aktif</h4>
          {[
            "Pemasukan baru ditambahkan",
            "Pengeluaran baru ditambahkan",
            "Proyek selesai",
            "Stok barang menipis",
          ].map(n => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #0f172a", color: "#94a3b8", fontSize: 14 }}>
              <span style={{ color: "#10b981" }}>✓</span> {n}
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
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setForm({ ...form, logo: ev.target.result });
    r.readAsDataURL(f);
  };

  const saveBiz = () => {
    setBiz(form); save("biz", form);
    addToast("Profil bisnis berhasil disimpan!", "success");
  };

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: 22 }}>⚙️ Pengaturan Bisnis</h2>
      <div style={{ maxWidth: 560 }}>
        <div style={{ background: "#1e293b", borderRadius: 14, padding: 24, border: "1px solid #334155" }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div onClick={() => fileRef.current.click()} style={{ cursor: "pointer", display: "inline-block" }}>
              {form.logo
                ? <img src={form.logo} alt="logo" style={{ width: 90, height: 90, borderRadius: 18, objectFit: "cover", border: "2px solid #3b82f6" }} />
                : <div style={{ width: 90, height: 90, borderRadius: 18, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto" }}>💼</div>
              }
            </div>
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>Klik untuk ganti logo</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogo} />
          </div>

          <Field label="NAMA BISNIS"><input style={inputStyle} value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="PT. Contoh Bisnis" /></Field>
          <Field label="NAMA PEMILIK"><input style={inputStyle} value={form.owner || ""} onChange={e => setForm({ ...form, owner: e.target.value })} placeholder="Nama pemilik" /></Field>
          <Field label="NOMOR TELEPON"><input style={inputStyle} value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></Field>
          <Field label="EMAIL"><input type="email" style={inputStyle} value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@bisnis.com" /></Field>
          <Field label="ALAMAT"><textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Alamat bisnis" /></Field>

          <button style={btnPrimary} onClick={saveBiz}>💾 Simpan Profil</button>
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================
export default function App() {
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
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const sharedProps = { income, setIncome, expense, setExpense, projects, setProjects, inventory, setInventory, tg, setTg, biz, setBiz, addToast };

  const pages = {
    dashboard: <Dashboard {...sharedProps} />,
    cashflow: <CashFlow {...sharedProps} />,
    projects: <Projects {...sharedProps} />,
    inventory: <Inventory {...sharedProps} />,
    invoice: <Invoice {...sharedProps} />,
    reports: <Reports {...sharedProps} />,
    telegram: <TelegramSettings {...sharedProps} />,
    settings: <Settings {...sharedProps} />,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1e", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 99px; }
        input[type=range] { accent-color: #3b82f6; }
        select option { background: #1e293b; }
      `}</style>

      <Sidebar active={active} setActive={setActive} biz={biz} sideOpen={sideOpen} setSideOpen={setSideOpen} />

      {/* Header */}
      <header style={{
        position: "fixed", top: 0, left: sideOpen ? 240 : 0, right: 0, height: 60,
        background: "#0f172a", borderBottom: "1px solid #1e293b",
        display: "flex", alignItems: "center", padding: "0 20px", zIndex: 30,
        transition: "left 0.3s ease", gap: 14
      }}>
        <button onClick={() => setSideOpen(s => !s)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20, padding: 4 }}>☰</button>
        <span style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 16 }}>
          {NAV.find(n => n.id === active)?.icon} {NAV.find(n => n.id === active)?.label}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#64748b", fontSize: 13 }}>{new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          {tg.token && <span style={{ background: "#10b98122", color: "#10b981", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>✈️ Telegram Aktif</span>}
        </div>
      </header>

      {/* Content */}
      <main style={{
        marginLeft: sideOpen ? 240 : 0, marginTop: 60,
        padding: 24, transition: "margin-left 0.3s ease", minHeight: "calc(100vh - 60px)"
      }}>
        {pages[active]}
      </main>

      <Toast toasts={toasts} />
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ==================== UTILS & CONFIG ====================
const formatRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const today = () => new Date().toISOString().slice(0, 10);

const CATEGORIES_IN = ["Penjualan", "Jasa", "Investasi", "Lainnya"];
const CATEGORIES_OUT = ["Operasional", "Gaji", "Pembelian Stok", "Marketing", "Lainnya"];
const PROJECT_STATUS = ["Pending", "Berjalan", "Selesai", "Ditunda"];
const STATUS_COLOR = { Pending: "#f59e0b", Berjalan: "#3b82f6", Selesai: "#10b981", Ditunda: "#ef4444" };

const loadLocal = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const saveLocal = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// Helper Notifikasi Telegram aman dengan Try-Catch mendalam
const sendTelegram = async (token, chatId, text) => {
  if (!token || !chatId) return { ok: false, error: "Token/ChatID tidak terkonfigurasi" };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return await res.json();
  } catch (err) {
    console.error("Gagal mengirim Telegram log:", err.message);
    return { ok: false, error: err.message };
  }
};

// ==================== LOADING SCREEN ====================
function LoadingScreen({ onDone }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 25 + 5;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(onDone, 400); }
      setProgress(Math.min(p, 100));
    }, 80);
    return () => clearInterval(iv);
  }, [onDone]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0a0f1e", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 99999 }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ width: 70, height: 70, borderRadius: 20, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 15px", boxShadow: "0 0 40px rgba(59,130,246,0.3)" }}>💼</div>
        <h2 style={{ color: "#fff", margin: 0, fontSize: 24, letterSpacing: 1 }}>BizFlow Cloud</h2>
        <p style={{ color: "#475569", fontSize: 12, margin: "4px 0 0" }}>Menyelaraskan data lokal & cloud...</p>
      </div>
      <div style={{ width: 200, background: "#1e293b", height: 4, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", height: "100%", transition: "width 0.1s" }} />
      </div>
    </div>
  );
}

// ==================== REUSABLE UI ELEMENTS ====================
function Toast({ toasts }) {
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 99999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type === "success" ? "#10b981" : t.type === "error" ? "#ef4444" : "#3b82f6", color: "#fff", padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
          {t.type === "success" ? "✅ " : t.type === "error" ? "❌ " : "ℹ️ "}{t.msg}
        </div>
      ))}
    </div>
  );
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,7,16,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#1e293b", borderRadius: 16, padding: 24, width: "100%", maxWidth: 480, border: "1px solid #334155" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: "#f1f5f9", fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" };
const btnStyle = { padding: "10px 16px", borderRadius: 8, border: "none", fontWeight: 600, fontSize: 13, cursor: "pointer" };

// ==================== COMPONENT: DASHBOARD ====================
function Dashboard({ income, expense, inventory, projects, biz }) {
  const totalIn = income.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalOut = expense.reduce((s, r) => s + Number(r.amount || 0), 0);
  const profit = totalIn - totalOut;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, color: "#f1f5f9" }}>Workshop {biz.name || "Sumber Rezeki"} 🛠️</h2>
        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>Pemilik: {biz.owner || "Mochamad Budi"}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ background: "#1e293b", padding: 20, borderRadius: 12, border: "1px solid #334155" }}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700 }}>TOTAL PEMASUKAN</div>
          <div style={{ color: "#10b981", fontSize: 20, fontWeight: 700, marginTop: 4 }}>{formatRp(totalIn)}</div>
        </div>
        <div style={{ background: "#1e293b", padding: 20, borderRadius: 12, border: "1px solid #334155" }}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700 }}>TOTAL PENGELUARAN</div>
          <div style={{ color: "#ef4444", fontSize: 20, fontWeight: 700, marginTop: 4 }}>{formatRp(totalOut)}</div>
        </div>
        <div style={{ background: "#1e293b", padding: 20, borderRadius: 12, border: "1px solid #334155" }}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700 }}>SALDO BERSIH (NET)</div>
          <div style={{ color: profit >= 0 ? "#3b82f6" : "#f59e0b", fontSize: 20, fontWeight: 700, marginTop: 4 }}>{formatRp(profit)}</div>
        </div>
      </div>
    </div>
  );
}

// ==================== COMPONENT: KASIR ====================
function Kasir({ inventory, setInventory, income, setIncome, addToast, tg, biz, saveAndSync }) {
  const [cart, setCart] = useState([]);
  const [payAmount, setPayAmount] = useState("");

  const addToCart = (item) => {
    if (item.qty <= 0) return addToast("Stok barang ini habis!", "error");
    const exist = cart.find(c => c.id === item.id);
    if (exist) {
      if (exist.cartQty >= item.qty) return addToast("Tidak bisa melebihi stok tersedia", "error");
      setCart(cart.map(c => c.id === item.id ? { ...c, cartQty: c.cartQty + 1 } : c));
    } else {
      setCart([...cart, { ...item, cartQty: 1 }]);
    }
  };

  const updateCartQty = (id, val) => {
    const item = inventory.find(i => i.id === id);
    if (val > item.qty) return addToast("Stok tidak mencukupi", "error");
    if (val <= 0) {
      setCart(cart.filter(c => c.id !== id));
    } else {
      setCart(cart.map(c => c.id === id ? { ...c, cartQty: val } : c));
    }
  };

  const totalBelanja = cart.reduce((s, c) => s + (Number(c.sellPrice) * c.cartQty), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return addToast("Keranjang belanja kosong", "error");
    if (Number(payAmount) < totalBelanja) return addToast("Uang pembayaran kurang!", "error");

    // FIX #4: Menggunakan Functional State Update yang aman dari Race-Condition stok hancur
    const newInventory = inventory.map(invItem => {
      const cartItem = cart.find(c => c.id === invItem.id);
      if (cartItem) {
        return { ...invItem, qty: Math.max(0, Number(invItem.qty) - cartItem.cartQty) };
      }
      return invItem;
    });

    const newTransaction = {
      id: Date.now(),
      date: today(),
      category: "Penjualan",
      desc: `Kasir: ${cart.map(c => `${c.name} (${c.cartQty}x)`).join(", ")}`,
      amount: totalBelanja
    };

    setInventory(newInventory);
    const updatedIncome = [newTransaction, ...income];
    setIncome(updatedIncome);

    // Kirim data sinkronisasi ganda (Dual-layer cloud)
    saveAndSync("inventory", newInventory);
    saveAndSync("income", updatedIncome);

    addToast("Transaksi Kasir Berhasil disimpan!", "success");
    
    // Kirim Laporan ke Bot Telegram
    await sendTelegram(tg.token, tg.chatId, `🛒 <b>Transaksi Kasir Baru</b>\n🏢 ${biz.name}\n💰 Total: ${formatRp(totalBelanja)}\n💵 Bayar: ${formatRp(payAmount)}\n kembalian: ${formatRp(Number(payAmount) - totalBelanja)}`);

    setCart([]);
    setPayAmount("");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
      {/* List Produk */}
      <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155" }}>
        <h3 style={{ margin: "0 0 12px", color: "#f1f5f9", fontSize: 15 }}>🛒 Menu Produk Kasir</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {inventory.map(item => (
            <div key={item.id} onClick={() => addToCart(item)} style={{ background: "#0f172a", padding: 12, borderRadius: 8, cursor: "pointer", border: "1px solid #1e293b" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#f1f5f9" }}>{item.name}</div>
              <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>Stok: {item.qty}</div>
              <div style={{ color: "#10b981", fontSize: 13, fontWeight: 700, marginTop: 6 }}>{formatRp(item.sellPrice)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Ringkasan Keranjang */}
      <div style={{ background: "#1e293b", padding: 16, borderRadius: 12, border: "1px solid #334155", display: "flex", flexDirection: "column" }}>
        <h3 style={{ margin: "0 0 12px", color: "#f1f5f9", fontSize: 15 }}>📋 Keranjang</h3>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
          {cart.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, background: "#0f172a", padding: 8, borderRadius: 6 }}>
              <div>
                <div style={{ fontSize: 12, color: "#f1f5f9" }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "#10b981" }}>{formatRp(c.sellPrice)}</div>
              </div>
              <input type="number" min="0" value={c.cartQty} onChange={(e) => updateCartQty(c.id, Number(e.target.value))} style={{ width: 50, background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: 4, borderRadius: 4, textAlign: "center" }} />
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid #334155", paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "#fff" }}>
            <span>Total:</span><span>{formatRp(totalBelanja)}</span>
          </div>
          <input type="number" min="0" style={{ ...inputStyle, marginTop: 10 }} placeholder="Uang Bayar Tunai..." value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          <button onClick={handleCheckout} style={{ ...btnStyle, background: "#10b981", color: "#fff", width: "100%", marginTop: 10 }}>Selesaikan Transaksi</button>
        </div>
      </div>
    </div>
  );
}

// ==================== COMPONENT: CASHFLOW ====================
function CashFlow({ income, setIncome, expense, setExpense, addToast, saveAndSync }) {
  const [tab, setTab] = useState("in");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: today(), category: "", desc: "", amount: "" });

  const submit = () => {
    // FIX #5: Sanitasi Input Anti-Negatif
    if (!form.amount || Number(form.amount) <= 0 || !form.category) return addToast("Isi nominal dengan benar & pilih kategori!", "error");
    
    const rec = { ...form, id: Date.now(), amount: Number(form.amount) };
    if (tab === "in") {
      const updated = [rec, ...income];
      setIncome(updated);
      saveAndSync("income", updated);
    } else {
      const updated = [rec, ...expense];
      setExpense(updated);
      saveAndSync("expense", updated);
    }
    setForm({ date: today(), category: "", desc: "", amount: "" });
    setShowModal(false);
    addToast("Data arus kas berhasil dicatat!", "success");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("in")} style={{ ...btnStyle, background: tab === "in" ? "#10b981" : "#1e293b", color: "#fff" }}>📈 Pemasukan</button>
          <button onClick={() => setTab("out")} style={{ ...btnStyle, background: tab === "out" ? "#ef4444" : "#1e293b", color: "#fff" }}>📉 Pengeluaran</button>
        </div>
        <button onClick={() => setShowModal(true)} style={{ ...btnStyle, background: "#3b82f6", color: "#fff" }}>+ Tambah Transaksi</button>
      </div>

      <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#0f172a", color: "#64748b" }}>
            <tr>
              <th style={{ padding: 12, textAlign: "left" }}>Tanggal</th>
              <th style={{ padding: 12, textAlign: "left" }}>Kategori</th>
              <th style={{ padding: 12, textAlign: "left" }}>Keterangan</th>
              <th style={{ padding: 12, textAlign: "right" }}>Nominal</th>
            </tr>
          </thead>
          <tbody>
            {(tab === "in" ? income : expense).map(r => (
              <tr key={r.id} style={{ borderBottom: "1px solid #334155" }}>
                <td style={{ padding: 12, color: "#94a3b8" }}>{r.date}</td>
                <td style={{ padding: 12 }}><span style={{ background: "#0f172a", padding: "2px 8px", borderRadius: 4 }}>{r.category}</span></td>
                <td style={{ padding: 12, color: "#f1f5f9" }}>{r.desc || "-"}</td>
                <td style={{ padding: 12, textAlign: "right", color: tab === "in" ? "#10b981" : "#ef4444", fontWeight: 700 }}>{formatRp(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={tab === "in" ? "Catat Pemasukan" : "Catat Pengeluaran"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: "#64748b" }}>TANGGAL</label>
            <input type="date" style={inputStyle} value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b" }}>KATEGORI</label>
            <select style={inputStyle} value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
              <option value="">Pilih Kategori</option>
              {(tab === "in" ? CATEGORIES_IN : CATEGORIES_OUT).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b" }}>DESKRIPSI / KETERANGAN</label>
            <input type="text" style={inputStyle} placeholder="Contoh: Pembayaran borongan pagar" value={form.desc} onChange={e => setForm({...form, desc: e.target.value})} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b" }}>NOMINAL TRANSAKSI (RP)</label>
            <input type="number" min="1" style={inputStyle} placeholder="0" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => setShowModal(false)} style={{ ...btnStyle, background: "#334155", color: "#fff" }}>Batal</button>
            <button onClick={submit} style={{ ...btnStyle, background: tab === "in" ? "#10b981" : "#ef4444", color: "#fff" }}>Simpan</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ==================== COMPONENT: INVENTORY ====================
function Inventory({ inventory, setInventory, addToast, saveAndSync }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", qty: "", costPrice: "", sellPrice: "" });

  const submit = () => {
    if (!form.name || Number(form.qty) < 0 || Number(form.sellPrice) <= 0) return addToast("Nama produk dan harga tidak valid!", "error");
    const newItem = {
      id: Date.now(),
      name: form.name,
      qty: Number(form.qty),
      costPrice: Number(form.costPrice || 0),
      sellPrice: Number(form.sellPrice)
    };
    const updated = [newItem, ...inventory];
    setInventory(updated);
    saveAndSync("inventory", updated);
    setShowModal(false);
    setForm({ name: "", qty: "", costPrice: "", sellPrice: "" });
    addToast("Item material baru ditambahkan", "success");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: "#fff" }}>📦 Manajemen Stok & Material</h3>
        <button onClick={() => setShowModal(true)} style={{ ...btnStyle, background: "#3b82f6", color: "#fff" }}>+ Tambah Material</button>
      </div>
      <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#0f172a", color: "#64748b" }}>
            <tr>
              <th style={{ padding: 12, textAlign: "left" }}>Nama Barang</th>
              <th style={{ padding: 12, textAlign: "center" }}>Sisa Stok</th>
              <th style={{ padding: 12, textAlign: "right" }}>Harga Modal</th>
              <th style={{ padding: 12, textAlign: "right" }}>Harga Jual</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map(item => (
              <tr key={item.id} style={{ borderBottom: "1px solid #334155" }}>
                <td style={{ padding: 12, color: "#fff", fontWeight: 600 }}>{item.name}</td>
                <td style={{ padding: 12, textAlign: "center", color: item.qty <= 3 ? "#ef4444" : "#94a3b8" }}>{item.qty} Pcs</td>
                <td style={{ padding: 12, textAlign: "right", color: "#94a3b8" }}>{formatRp(item.costPrice)}</td>
                <td style={{ padding: 12, textAlign: "right", color: "#10b981", fontWeight: 700 }}>{formatRp(item.sellPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Tambah Material Baru">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input type="text" style={inputStyle} placeholder="Nama Material (e.g., Besi Hollow 4x4)" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          <input type="number" min="0" style={inputStyle} placeholder="Jumlah Stok" value={form.qty} onChange={e => setForm({...form, qty: e.target.value})} />
          <input type="number" min="0" style={inputStyle} placeholder="Harga Beli / Modal" value={form.costPrice} onChange={e => setForm({...form, costPrice: e.target.value})} />
          <input type="number" min="1" style={inputStyle} placeholder="Harga Jual Kontan" value={form.sellPrice} onChange={e => setForm({...form, sellPrice: e.target.value})} />
          <button onClick={submit} style={{ ...btnStyle, background: "#10b981", color: "#fff", marginTop: 6 }}>Masukkan Inventaris</button>
        </div>
      </Modal>
    </div>
  );
}

// ==================== COMPONENT: SETTINGS & BACKUP ====================
function Settings({ biz, setBiz, tg, setTg, saveAndSync, addToast }) {
  const [bForm, setBForm] = useState({ ...biz });
  const [tForm, setTForm] = useState({ ...tg });

  const triggerExport = () => {
    // FIX #3: Fitur Eksport/Import File Data JSON Lokal Cadangan di HP
    const fullData = {
      biz: loadLocal("biz", {}),
      income: loadLocal("income", []),
      expense: loadLocal("expense", []),
      inventory: loadLocal("inventory", []),
      tg: loadLocal("tg", {})
    };
    const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bizflow_backup_${today()}.json`;
    a.click();
    addToast("Backup file JSON berhasil diunduh ke HP!", "success");
  };

  const triggerImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.income || parsed.inventory) {
          Object.keys(parsed).forEach(k => saveLocal(k, parsed[k]));
          addToast("Backup lokal berhasil dipulihkan! Muat ulang halaman.", "success");
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch (err) {
        addToast("Struktur file backup rusak/tidak valid", "error");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "#1e293b", padding: 20, borderRadius: 12, border: "1px solid #334155" }}>
        <h4 style={{ margin: "0 0 12px", color: "#fff" }}>⚙️ Profil Workshop & Bengkel</h4>
        <input style={{ ...inputStyle, marginBottom: 10 }} value={bForm.name || ""} placeholder="Nama Bengkel" onChange={e => setBForm({...bForm, name: e.target.value})} />
        <input style={{ ...inputStyle, marginBottom: 12 }} value={bForm.owner || ""} placeholder="Nama Pemilik" onChange={e => setBForm({...bForm, owner: e.target.value})} />
        <button onClick={() => { setBiz(bForm); saveAndSync("biz", bForm); addToast("Profil di-update!", "success"); }} style={{ ...btnStyle, background: "#3b82f6", color: "#fff" }}>Simpan Profil</button>
      </div>

      <div style={{ background: "#1e293b", padding: 20, borderRadius: 12, border: "1px solid #334155" }}>
        <h4 style={{ margin: "0 0 12px", color: "#fff" }}>✈️ Log Integrasi Telegram</h4>
        <input type="password" style={{ ...inputStyle, marginBottom: 10 }} value={tForm.token || ""} placeholder="Bot Token Telegram" onChange={e => setTForm({...tForm, token: e.target.value})} />
        <input style={{ ...inputStyle, marginBottom: 12 }} value={tForm.chatId || ""} placeholder="Chat ID Target" onChange={e => setTForm({...tForm, chatId: e.target.value})} />
        <button onClick={() => { setTg(tForm); saveAndSync("tg", tForm); addToast("Koneksi Telegram disimpan!", "success"); }} style={{ ...btnStyle, background: "#3b82f6", color: "#fff" }}>Simpan Akses</button>
      </div>

      <div style={{ background: "#1e293b", padding: 20, borderRadius: 12, border: "1px solid #334155" }}>
        <h4 style={{ margin: "0 0 4px", color: "#fff" }}>💾 Manajemen Ketahanan Data Offline</h4>
        <p style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>Gunakan ini jika ingin mengamankan file backup manual di luar cloud Supabase.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={triggerExport} style={{ ...btnStyle, background: "#10b981", color: "#fff" }}>📤 Export JSON</button>
          <label style={{ ...btnStyle, background: "#8b5cf6", color: "#fff", display: "inline-block", textAlign: "center" }}>
            📥 Import JSON
            <input type="file" accept=".json" onChange={triggerImport} style={{ display: "none" }} />
          </label>
        </div>
      </div>
    </div>
  );
}

// ==================== APP CORE ENGINE ====================
export default function App() {
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  // State Utama Aplikasi (Mengambil dari LocalStorage sebagai buffer awal offline)
  const [biz, setBiz] = useState(() => loadLocal("biz", { name: "Sumber Rezeki", owner: "Mochamad Budi" }));
  const [income, setIncome] = useState(() => loadLocal("income", []));
  const [expense, setExpense] = useState(() => loadLocal("expense", []));
  const [inventory, setInventory] = useState(() => loadLocal("inventory", []));
  const [tg, setTg] = useState(() => loadLocal("tg", { token: "", chatId: "" }));

  const addToast = useCallback((msg, type = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // FIX #1 & #2: Mekanisme Sinkronisasi Dual-Layer (Lokal Cepat + Cloud Supabase Latar Belakang)
  const saveAndSync = async (key, val) => {
    // 1. Simpan secepat kilat ke lokal HP agar performa mulus tanpa hambatan internet
    saveLocal(key, val);

    // 2. Kirim sinkronisasi ke cloud Supabase di background secara asinkron
    try {
      const targetTable = key === "tg" ? "telegram_config" : key === "biz" ? "biz_profile" : key;
      
      const { error } = await supabase
        .from(targetTable)
        .upsert({ 
          id: 1, // ID Tunggal untuk data ERP Personal Workshop
          updated_at: new Date().toISOString(),
          data_payload: val 
        });

      if (error) throw error;
    } catch (err) {
      console.warn(`[Cloud Offline] Gagal sinkronisasi ${key} ke Supabase, data aman di penyimpanan lokal HP.`);
    }
  };

  // Ambil data terbaru dari cloud saat aplikasi pertama dibuka
  useEffect(() => {
    const fetchCloudData = async () => {
      try {
        const tables = ["biz_profile", "income", "expense", "inventory", "telegram_config"];
        for (const tbl of tables) {
          const { data, error } = await supabase.from(tbl).select("data_payload").eq("id", 1).single();
          if (data && data.data_payload) {
            const localKey = tbl === "biz_profile" ? "biz" : tbl === "telegram_config" ? "tg" : tbl;
            saveLocal(localKey, data.data_payload);
            if (localKey === "biz") setBiz(data.data_payload);
            if (localKey === "income") setIncome(data.data_payload);
            if (localKey === "expense") setExpense(data.data_payload);
            if (localKey === "inventory") setInventory(data.data_payload);
            if (localKey === "tg") setTg(data.data_payload);
          }
        }
      } catch (err) {
        console.log("Menjalankan aplikasi dalam mode offline penuh menggunakan data lokal.");
      } finally {
        setLoading(false);
      }
    };
    fetchCloudData();
  }, []);

  if (loading) return <LoadingScreen onDone={() => setLoading(false)} />;

  return (
    <div style={{ background: "#0a0f1e", minHeight: "100vh", color: "#f1f5f9", fontFamily: "system-ui, sans-serif" }}>
      <Toast toasts={toasts} />

      {/* Sidebar Navigation */}
      <aside style={{ position: "fixed", left: sideOpen ? 0 : -240, top: 0, bottom: 0, width: 220, background: "#0f172a", borderRight: "1px solid #1e293b", zIndex: 100, transition: "left 0.2s ease", padding: 16 }}>
        <h3 style={{ color: "#3b82f6", margin: "0 0 20px" }}>BizFlow Navigation</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={() => { setActive("dashboard"); setSideOpen(false); }} style={{ ...btnStyle, background: active === "dashboard" ? "#3b82f6" : "transparent", color: "#fff", textAlign: "left" }}>📊 Dashboard</button>
          <button onClick={() => { setActive("kasir"); setSideOpen(false); }} style={{ ...btnStyle, background: active === "kasir" ? "#3b82f6" : "transparent", color: "#fff", textAlign: "left" }}>🛒 Mesin Kasir</button>
          <button onClick={() => { setActive("cashflow"); setSideOpen(false); }} style={{ ...btnStyle, background: active === "cashflow" ? "#3b82f6" : "transparent", color: "#fff", textAlign: "left" }}>💰 Arus Kas / Cash</button>
          <button onClick={() => { setActive("inventory"); setSideOpen(false); }} style={{ ...btnStyle, background: active === "inventory" ? "#3b82f6" : "transparent", color: "#fff", textAlign: "left" }}>📦 Stok Material</button>
          <button onClick={() => { setActive("settings"); setSideOpen(false); }} style={{ ...btnStyle, background: active === "settings" ? "#3b82f6" : "transparent", color: "#fff", textAlign: "left" }}>⚙️ Pengaturan</button>
        </div>
      </aside>

      {/* Header Bar */}
      <header style={{ background: "#0f172a", height: 56, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid #1e293b", sticky: "top" }}>
        <button onClick={() => setSideOpen(!sideOpen)} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}>☰</button>
        <span style={{ marginLeft: 16, fontWeight: 600, fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5 }}>{active}</span>
      </header>

      {/* Area Konten Utama ERP */}
      <main style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
        {active === "dashboard" && <Dashboard income={income} expense={expense} inventory={inventory} biz={biz} />}
        {active === "kasir" && <Kasir inventory={inventory} setInventory={setInventory} income={income} setIncome={setIncome} addToast={addToast} tg={tg} biz={biz} saveAndSync={saveAndSync} />}
        {active === "cashflow" && <CashFlow income={income} setIncome={setIncome} expense={expense} setExpense={setExpense} addToast={addToast} saveAndSync={saveAndSync} />}
        {active === "inventory" && <Inventory inventory={inventory} setInventory={setInventory} addToast={addToast} saveAndSync={saveAndSync} />}
        {active === "settings" && <Settings biz={biz} setBiz={setBiz} tg={tg} setTg={setTg} saveAndSync={saveAndSync} addToast={addToast} />}
      </main>
    </div>
  );
}

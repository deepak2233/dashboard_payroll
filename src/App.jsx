import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "./supabase";

const PROJECTS = ["I-Genie", "Lenovo", "Persistent"];
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const fmt = (a) => "\u20B9" + Number(a || 0).toLocaleString("en-IN");
const fmtD = (s) => {
  try {
    return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return s;
  }
};
const fmtTime = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

const workDays = (yr, mo, holidays = []) => {
  let c = 0;
  const d = new Date(yr, mo - 1, 1);
  while (d.getMonth() === mo - 1) {
    const w = d.getDay();
    const ds = `${yr}-${String(mo).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (w !== 0 && w !== 6 && !holidays.includes(ds)) c++;
    d.setDate(d.getDate() + 1);
  }
  return c;
};

const effDays = (yr, mo, join, exit, holidays = []) => {
  let c = 0;
  const d = new Date(yr, mo - 1, 1);
  const j = join ? new Date(join) : null;
  const e = exit ? new Date(exit) : null;
  while (d.getMonth() === mo - 1) {
    const w = d.getDay();
    const ds = `${yr}-${String(mo).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (w !== 0 && w !== 6 && !holidays.includes(ds) && (!j || d >= j) && (!e || d <= e)) c++;
    d.setDate(d.getDate() + 1);
  }
  return c;
};

const INIT = {
  employees: [],
  attendance: {},
  reports: [],
  alerts: [],
  holidays: [],
  config: { hrBudget: 0, email: "", phone: "", pin: "1205" },
};
const SK = "projecthub_data";
const PC = { "I-Genie": "#a78bfa", Lenovo: "#fb923c", Persistent: "#34d399" };
const SC = { present: "#22c55e", absent: "#ef4444", leave: "#eab308", halfday: "#06b6d4", wfh: "#ec4899" };
const SL = { present: "P", absent: "A", leave: "L", halfday: "\u00BD", wfh: "W" };
const SCYCLE = [undefined, "present", "absent", "leave", "halfday", "wfh"];

/* ── Storage helpers (localStorage only) ── */
function loadFromStorage() {
  // Try multiple keys for migration
  const keys = [SK, "phub4", "phub3", "hub-data-v2", "hub-data"];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const d = JSON.parse(raw);
      if (d && d.employees) {
        if (!d.config) d.config = { ...INIT.config };
        if (d.config.pin === "1234" || !d.config.pin) d.config.pin = "1205";
        if (!d.alerts) d.alerts = [];
        if (!d.holidays) d.holidays = [];
        if (!d.attendance) d.attendance = {};
        if (!d.reports) d.reports = [];
        d.employees = (d.employees || []).map((e) => ({
          ...e,
          salary: e.salary || e.monthlySalary || 0,
          code: e.code || uid().slice(0, 4),
        }));
        // Migrate to canonical key
        if (key !== SK) {
          try { localStorage.setItem(SK, JSON.stringify(d)); } catch { }
        }
        return d;
      }
    } catch { }
  }
  return { ...INIT };
}

function saveToStorage(data) {
  try {
    localStorage.setItem(SK, JSON.stringify(data));
  } catch (e) {
    console.error("Save failed:", e);
  }
}

/* ── Main App ── */
export default function App() {
  const [D, setD] = useState(null);
  const [role, setRole] = useState(null);
  const [candId, setCandId] = useState(null);
  const [toast, setToast] = useState(null);
  const [dbError, setDbError] = useState(null);
  const tt = useRef();

  // Sync with Supabase
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setD(loadFromStorage());
      return;
    }

    const channel = supabase
      .channel('db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settings',
          filter: 'id=eq.projecthub'
        },
        (payload) => {
          if (payload.new && payload.new.data) {
            setD(payload.new.data);
            saveToStorage(payload.new.data);
          }
        }
      )
      .subscribe();

    async function init() {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('data')
          .eq('id', 'projecthub')
          .single();

        if (error) {
          if (error.code === 'PGRST116') { // Not found row
            const initial = loadFromStorage();
            setD(initial);
            await supabase.from('settings').upsert({ id: 'projecthub', data: initial });
          } else if (error.code === 'PGRST205') { // Table not found
            console.error("Supabase table missing:", error);
            setDbError("TABLE_MISSING");
            setD(loadFromStorage());
          } else {
            console.error("Supabase fetch error:", error);
            setD(loadFromStorage());
          }
        } else if (data && data.data) {
          setD(data.data);
          saveToStorage(data.data);
        }
      } catch (e) {
        console.error("Supabase init error:", e);
        setD(loadFromStorage());
      }
    }

    init();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const save = useCallback(async (nd) => {
    setD(nd);
    saveToStorage(nd); // Local fallback
    if (!isSupabaseConfigured) return;

    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ id: 'projecthub', data: nd });
      if (error) console.error("Cloud save error:", error);
    } catch (e) {
      console.error("Cloud save failed:", e);
    }
  }, []);

  const notify = (msg, type = "ok") => {
    clearTimeout(tt.current);
    setToast({ msg, type });
    tt.current = setTimeout(() => setToast(null), 2800);
  };

  const pushAlert = (d, alert) => ({
    ...d,
    alerts: [{ ...alert, id: uid(), ts: new Date().toISOString(), read: false }, ...(d.alerts || [])],
  });

  if (dbError === "TABLE_MISSING") return <SqlSetupGuide />;
  if (!D) return <LoadingScreen />;
  if (!role)
    return <LoginScreen D={D} save={save} setRole={setRole} setCandId={setCandId} notify={notify} />;
  if (role === "candidate")
    return (
      <CandidatePortal
        D={D} save={save} candId={candId} pushAlert={pushAlert}
        notify={notify} setRole={setRole} setCandId={setCandId} toast={toast}
      />
    );
  return <OwnerPanel D={D} save={save} pushAlert={pushAlert} notify={notify} setRole={setRole} toast={toast} />;
}

/* ════════════════════════════════════════ */
/*  LOADING                               */
/* ════════════════════════════════════════ */
/* ════════════════════════════════════════ */
/*  SQL SETUP GUIDE                       */
/* ════════════════════════════════════════ */
function SqlSetupGuide() {
  const sql = `create table settings (id text primary key, data jsonb);
alter publication supabase_realtime add table settings;`;

  return (
    <div style={{ padding: "40px 20px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#080c14", color: "#e8edf5", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 500, width: "100%", background: "#0f1520", border: "1px solid #1c2640", borderRadius: 16, padding: 32, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "#6366f120", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 32 }}>🛠</div>
        <h2 style={{ margin: "0 0 12px", fontSize: 24, fontWeight: 700 }}>Finish Project Sync</h2>
        <p style={{ color: "#8899b4", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>Credentials are correct ✅, now just run the SQL command to create the data table.</p>

        <div style={{ textAlign: "left", background: "#151d2e", borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#6366f1", marginBottom: 12 }}>Run this in Supabase SQL Editor:</div>
          <pre style={{ margin: 0, padding: 12, background: "#080c14", borderRadius: 6, fontSize: 11, color: "#34d399", overflowX: "auto", border: "1px solid #1c2640" }}>
            {sql}
          </pre>
          <div style={{ fontSize: 11, color: "#5a6b85", marginTop: 12 }}>1. Go to your Supabase Dashboard → <b>SQL Editor</b><br />2. Paste the code above and click <b>Run</b>.</div>
        </div>

        <button onClick={() => window.location.reload()} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>I've run the SQL, continue</button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#080c14", color: "#8899b4", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 36, height: 36, border: "3px solid #1c2640", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin .7s linear infinite", margin: "0 auto 14px" }} />
        <p>Loading...</p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════ */
/*  LOGIN                                 */
/* ════════════════════════════════════════ */
function LoginScreen({ D, save, setRole, setCandId, notify }) {
  const [mode, setMode] = useState(null);
  const [pin, setPin] = useState("");
  const [selEmp, setSelEmp] = useState("");
  const [empCode, setEmpCode] = useState("");
  const [pinErr, setPinErr] = useState(false);
  const E = D.employees || [];

  const ownerLogin = () => {
    if (pin === (D.config?.pin || "1205")) setRole("owner");
    else { setPinErr(true); setTimeout(() => setPinErr(false), 1500); }
  };

  const candLogin = () => {
    const emp = E.find((e) => e.id === selEmp);
    if (emp && empCode === (emp.code || emp.id.slice(0, 4))) { setCandId(emp.id); setRole("candidate"); }
    else { setPinErr(true); setTimeout(() => setPinErr(false), 1500); }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#080c14", fontFamily: "'DM Sans',sans-serif", color: "#e8edf5" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
button:hover{filter:brightness(1.12);}`}</style>
      <div style={{ width: 400, animation: "fadeIn .4s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "linear-gradient(135deg,#6366f1,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 28, fontWeight: 700 }}>P</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: -.5 }}>ProjectHub</h1>
          <p style={{ color: "#5a6b85", fontSize: 13, marginTop: 6 }}>Workforce Management Platform</p>
        </div>
        {!mode && (
          <div>
            <button onClick={() => setMode("owner")} style={{ width: "100%", padding: "18px 20px", borderRadius: 12, border: "1px solid #1c2640", background: "#0f1520", color: "#e8edf5", cursor: "pointer", marginBottom: 12, display: "flex", alignItems: "center", gap: 14, textAlign: "left", fontFamily: "inherit" }}>
              <span style={{ width: 44, height: 44, borderRadius: 10, background: "#6366f120", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>👑</span>
              <div><div style={{ fontSize: 15, fontWeight: 600 }}>Owner / Admin</div><div style={{ fontSize: 11, color: "#5a6b85", marginTop: 2 }}>Full access — Dashboard, People, Payroll, Alerts</div></div>
            </button>
            <button onClick={() => setMode("candidate")} style={{ width: "100%", padding: "18px 20px", borderRadius: 12, border: "1px solid #1c2640", background: "#0f1520", color: "#e8edf5", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, textAlign: "left", fontFamily: "inherit" }}>
              <span style={{ width: 44, height: 44, borderRadius: 10, background: "#22c55e20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>👤</span>
              <div><div style={{ fontSize: 15, fontWeight: 600 }}>Team Member</div><div style={{ fontSize: 11, color: "#5a6b85", marginTop: 2 }}>Mark attendance & submit weekly reports only</div></div>
            </button>
          </div>
        )}
        {mode === "owner" && (
          <div style={{ background: "#0f1520", borderRadius: 14, border: "1px solid #1c2640", padding: 24, animation: pinErr ? "shake .3s" : "fadeIn .3s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <button onClick={() => setMode(null)} style={{ background: "none", border: "none", color: "#5a6b85", cursor: "pointer", fontSize: 16 }}>&larr;</button>
              <h3 style={{ margin: 0, fontSize: 16 }}>👑 Owner Login</h3>
            </div>
            <label style={{ display: "block", fontSize: 12, color: "#8899b4", marginBottom: 4 }}>Admin PIN</label>
            <input type="password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ownerLogin()} placeholder="Enter PIN" style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: `1px solid ${pinErr ? "#ef4444" : "#1c2640"}`, background: "#151d2e", color: "#e8edf5", fontSize: 16, letterSpacing: 4, textAlign: "center", outline: "none", boxSizing: "border-box", marginBottom: 4 }} />
            {pinErr && <p style={{ color: "#ef4444", fontSize: 11, margin: "4px 0 0", textAlign: "center" }}>Incorrect PIN</p>}
            <button onClick={ownerLogin} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 14, fontFamily: "inherit" }}>Login</button>
          </div>
        )}
        {mode === "candidate" && (
          <div style={{ background: "#0f1520", borderRadius: 14, border: "1px solid #1c2640", padding: 24, animation: pinErr ? "shake .3s" : "fadeIn .3s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <button onClick={() => setMode(null)} style={{ background: "none", border: "none", color: "#5a6b85", cursor: "pointer", fontSize: 16 }}>&larr;</button>
              <h3 style={{ margin: 0, fontSize: 16 }}>👤 Team Member Login</h3>
            </div>
            {E.length === 0 ? (
              <p style={{ color: "#5a6b85", fontSize: 13, textAlign: "center", padding: 20 }}>No team members registered yet. Ask your admin to add you first.</p>
            ) : (
              <>
                <label style={lblStyle}>Select Your Name</label>
                <select value={selEmp} onChange={(e) => setSelEmp(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 14 }}>
                  <option value="">— Choose —</option>
                  {E.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.project})</option>)}
                </select>
                <label style={lblStyle}>Access Code</label>
                <input value={empCode} onChange={(e) => setEmpCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && candLogin()} placeholder="Your access code" style={{ ...inputStyle, width: "100%", textAlign: "center" }} />
                {pinErr && <p style={{ color: "#ef4444", fontSize: 11, margin: "4px 0 0", textAlign: "center" }}>Invalid code</p>}
                <button onClick={candLogin} disabled={!selEmp} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#22c55e", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 14, fontFamily: "inherit", opacity: selEmp ? 1 : 0.5 }}>Login</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════ */
/*  CANDIDATE PORTAL                      */
/* ════════════════════════════════════════ */
function CandidatePortal({ D, save, candId, pushAlert, notify, setRole, setCandId, toast }) {
  const [ctab, setCtab] = useState("attendance");
  const [mo, setMo] = useState(monthKey());
  const emp = (D.employees || []).find((e) => e.id === candId);
  const hols = (D.holidays || []).map((h) => h.date);

  if (!emp) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#080c14", color: "#8899b4", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <p>Account not found. Contact admin.</p>
        <button onClick={() => { setRole(null); setCandId(null); }} style={{ marginTop: 12, padding: "10px 24px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Back</button>
      </div>
    </div>
  );

  const getMyStats = (mk) => {
    const [y, m] = mk.split("-").map(Number);
    const dim = new Date(y, m, 0).getDate();
    let p = 0, a = 0, l = 0, h = 0, w = 0;
    for (let d = 1; d <= dim; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const v = D.attendance[`${candId}_${ds}`];
      if (v === "present") p++; else if (v === "absent") a++; else if (v === "leave") l++; else if (v === "halfday") h++; else if (v === "wfh") w++;
    }
    return { present: p, absent: a, leave: l, halfday: h, wfh: w, effective: p + w + h * 0.5 };
  };

  const markAtt = (date, status) => {
    const att = { ...D.attendance };
    const k = `${candId}_${date}`;
    if (!status) delete att[k]; else att[k] = status;
    let nd = { ...D, attendance: att };
    const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Cleared";
    nd = pushAlert(nd, {
      type: "cand_attendance", icon: status === "present" ? "✅" : status === "absent" ? "🚨" : status === "leave" ? "📋" : status === "wfh" ? "🏠" : "📌",
      title: `${emp.name} marked ${label}`,
      msg: `${emp.name} (${emp.project}) self-marked as ${label} on ${fmtD(date)} at ${fmtTime()}.`,
      sev: status === "absent" ? "high" : status === "leave" ? "med" : "info",
      project: emp.project, hasEmail: true, hasSMS: true,
      emailSubject: `[ProjectHub] ${emp.name} — ${label} on ${fmtD(date)}`,
      emailBody: `Hi,\n\n${emp.name} (${emp.role || "Team Member"}, ${emp.project}) has self-marked attendance.\n\nStatus: ${label}\nDate: ${fmtD(date)}\nTime: ${fmtTime()}\n\n— ProjectHub`,
      smsBody: `ProjectHub: ${emp.name} (${emp.project}) marked ${label} on ${fmtD(date)} at ${fmtTime()}.`,
    });
    save(nd);
    notify(`Marked ${label} — Admin notified`);
  };

  const submitReport = (r) => {
    const today = todayStr();
    const id = uid();
    const nd = { ...D, reports: [...(D.reports || []), { ...r, id, empId: candId, date: fmtD(today), ts: new Date().toISOString() }] };

    // Alert for owner
    const emp = D.employees.find(e => e.id === candId);
    nd.alerts = [{
      id: uid(), ts: new Date().toISOString(), type: 'report', icon: '📝',
      title: `Report: ${emp.name}`,
      msg: r.attachment ? `Attached: ${r.attachmentName}` : `Summary: ${r.summary.slice(0, 100)}...`,
      read: false
    }, ...(nd.alerts || [])];

    save(nd);
    notify("Report submitted!");
  };

  const CandAttendance = () => {
    const [y, m] = mo.split("-").map(Number);
    const dim = new Date(y, m, 0).getDate();
    const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const holSet = new Set(hols);
    const stats = getMyStats(mo);
    const wd = workDays(y, m, hols);
    const days = Array.from({ length: dim }, (_, i) => {
      const dt = new Date(y, m - 1, i + 1);
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return { date: ds, day: i + 1, dn: DN[dt.getDay()], isWE: dt.getDay() === 0 || dt.getDay() === 6, isHol: holSet.has(ds) };
    });

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="month" value={mo} onChange={(e) => setMo(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 11, color: "#5a6b85" }}>{wd} working days</span>
          </div>
          <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
            {Object.entries(SC).map(([k, c]) => <span key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{k}</span>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {[["Present", stats.present, SC.present], ["WFH", stats.wfh, SC.wfh], ["Half Day", stats.halfday, SC.halfday], ["Leave", stats.leave, SC.leave], ["Absent", stats.absent, SC.absent], ["Effective", stats.effective, "#6366f1"]].map(([l, v, c]) => (
            <div key={l} style={{ background: "#0f1520", border: "1px solid #1c2640", borderRadius: 10, padding: "10px 16px", textAlign: "center", minWidth: 70 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
              <div style={{ fontSize: 10, color: "#5a6b85", marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
          {DN.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 10, color: "#5a6b85", fontWeight: 600, padding: 4 }}>{d}</div>)}
          {Array.from({ length: new Date(y, m - 1, 1).getDay() }, (_, i) => <div key={`e${i}`} />)}
          {days.map((d) => {
            const v = D.attendance[`${candId}_${d.date}`];
            const isToday = d.date === todayStr();
            const isOff = d.isWE || d.isHol;
            return (
              <button key={d.day} onClick={() => { if (!d.isWE) { const nx = SCYCLE[(SCYCLE.indexOf(v) + 1) % SCYCLE.length]; markAtt(d.date, nx); } }}
                style={{ padding: "10px 4px", borderRadius: 10, border: isToday ? "2px solid #6366f1" : `1px solid ${isOff ? "#1c264040" : "#1c2640"}`, background: v ? SC[v] + "15" : isOff ? "#0a0e17" : "#0f1520", cursor: d.isWE ? "default" : "pointer", textAlign: "center", fontFamily: "inherit", opacity: isOff && !v ? 0.35 : 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: v ? SC[v] : "#e8edf5" }}>{d.day}</div>
                <div style={{ fontSize: 9, marginTop: 2, fontWeight: 700, color: v ? SC[v] : d.isHol ? "#ec4899" : "#5a6b85" }}>{v ? SL[v] : d.isHol ? "HOL" : ""}</div>
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 10, color: "#5a6b85", marginTop: 12, textAlign: "center" }}>Tap date to cycle: Present → Absent → Leave → Half Day → WFH → Clear</p>
      </div>
    );
  };

  const CandReport = () => {
    const [f, sF] = useState({ project: emp.project, weekOf: "", summary: "", blockers: "", nextWeek: "", hours: "", attachment: null, attachmentName: "" });
    const [submitted, setSubmitted] = useState(false);
    const [mode, setMode] = useState("write"); // 'write' or 'upload'
    const myReports = (D.reports || []).filter((r) => r.empId === candId);

    const handleFile = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return notify("File too large (max 2MB)", "error");
      const reader = new FileReader();
      reader.onloadend = () => sF({ ...f, attachment: reader.result, attachmentName: file.name });
      reader.readAsDataURL(file);
    };

    if (submitted) return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h3 style={{ color: "#22c55e", margin: "0 0 8px" }}>Report Submitted!</h3>
        <p style={{ color: "#8899b4", fontSize: 13 }}>Admin notified via dashboard.</p>
        <button onClick={() => setSubmitted(false)} style={{ marginTop: 16, padding: "10px 24px", borderRadius: 8, border: "1px solid #1c2640", background: "transparent", color: "#8899b4", cursor: "pointer", fontFamily: "inherit" }}>Submit Another</button>
      </div>
    );

    return (
      <div>
        <div style={{ background: "#0f1520", border: "1px solid #1c2640", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h4 style={{ margin: "0 0 14px", color: "#e8edf5", fontSize: 14 }}>Submit Weekly Report</h4>

          <div style={{ display: "flex", gap: 8, marginBottom: 20, background: "#0a0e17", padding: 4, borderRadius: 8 }}>
            <button onClick={() => setMode("write")} style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", background: mode === "write" ? "#1c2640" : "transparent", color: mode === "write" ? "#fff" : "#8899b4", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>✍️ Write Report</button>
            <button onClick={() => setMode("upload")} style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", background: mode === "upload" ? "#1c2640" : "transparent", color: mode === "upload" ? "#fff" : "#8899b4", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>📎 Upload Report</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <div style={{ marginBottom: 12 }}><label style={lblStyle}>Project</label><select value={f.project} onChange={(e) => sF({ ...f, project: e.target.value })} style={{ ...inputStyle, width: "100%" }}>{PROJECTS.map((p) => <option key={p}>{p}</option>)}</select></div>
            <div style={{ marginBottom: 12 }}><label style={lblStyle}>Week Of *</label><input type="date" value={f.weekOf} onChange={(e) => sF({ ...f, weekOf: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></div>
          </div>
          <div style={{ marginBottom: 12 }}><label style={lblStyle}>Hours Worked</label><input type="number" value={f.hours} onChange={(e) => sF({ ...f, hours: e.target.value })} placeholder="40" style={{ ...inputStyle, width: "100%" }} /></div>

          {mode === "write" ? (
            <>
              <div style={{ marginBottom: 12 }}><label style={lblStyle}>Work Summary *</label><textarea rows={4} value={f.summary} onChange={(e) => sF({ ...f, summary: e.target.value })} placeholder="What you accomplished..." style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }} /></div>
              <div style={{ marginBottom: 12 }}><label style={lblStyle}>Blockers</label><textarea rows={2} value={f.blockers} onChange={(e) => sF({ ...f, blockers: e.target.value })} placeholder="Issues..." style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }} /></div>
              <div style={{ marginBottom: 12 }}><label style={lblStyle}>Next Week</label><textarea rows={2} value={f.nextWeek} onChange={(e) => sF({ ...f, nextWeek: e.target.value })} placeholder="Plans..." style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }} /></div>
            </>
          ) : (
            <div style={{ marginBottom: 20, padding: 20, border: "2px dashed #1c2640", borderRadius: 12, textAlign: "center" }}>
              <input type="file" onChange={handleFile} style={{ display: "none" }} id="file-upload" accept="image/*,.pdf,.doc,.docx" />
              <label htmlFor="file-upload" style={{ cursor: "pointer" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e8edf5" }}>{f.attachmentName || "Click to upload file"}</div>
                <div style={{ fontSize: 11, color: "#5a6b85", marginTop: 4 }}>PDF, Images or Documents (Max 2MB)</div>
              </label>
            </div>
          )}

          <button onClick={() => { if ((f.summary || f.attachment) && f.weekOf) { submitReport(f); setSubmitted(true); } }} disabled={(!f.summary && !f.attachment) || !f.weekOf}
            style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: (f.summary || f.attachment) && f.weekOf ? 1 : 0.5 }}>📤 Submit Report</button>
        </div>
        {myReports.length > 0 && (
          <div>
            <h4 style={{ color: "#e8edf5", fontSize: 14, margin: "0 0 12px" }}>My Past Reports ({myReports.length})</h4>
            {[...myReports].reverse().slice(0, 5).map((r) => (
              <div key={r.id} style={{ background: "#0f1520", border: "1px solid #1c2640", borderRadius: 10, padding: 14, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#e8edf5" }}>Week of {r.weekOf}</span>
                  <span style={{ fontSize: 10, color: "#5a6b85" }}>{r.date}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "#8899b4", lineHeight: 1.5 }}>{r.summary?.slice(0, 200)}{r.summary?.length > 200 ? "..." : ""}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'DM Sans',sans-serif", background: "#080c14", color: "#e8edf5" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
button:hover{filter:brightness(1.1);}input:focus,select:focus,textarea:focus{border-color:#6366f1!important;}
*{scrollbar-width:thin;scrollbar-color:#1c2640 transparent;}`}</style>
      <div style={{ background: "#0f1520", borderBottom: "1px solid #1c2640", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "#22c55e20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👤</div>
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>{emp.name}</div><div style={{ fontSize: 10, color: "#5a6b85" }}>{emp.role || "Team Member"} · <span style={{ color: PC[emp.project] }}>{emp.project}</span></div></div>
        </div>
        <button onClick={() => { setRole(null); setCandId(null); }} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #1c2640", background: "transparent", color: "#8899b4", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>Logout</button>
      </div>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1c2640", background: "#0a0e17" }}>
        {[["attendance", "📅 Attendance"], ["report", "📋 Weekly Report"]].map(([k, l]) => (
          <button key={k} onClick={() => setCtab(k)} style={{ flex: 1, padding: "12px", border: "none", borderBottom: ctab === k ? "2px solid #6366f1" : "2px solid transparent", background: "transparent", color: ctab === k ? "#6366f1" : "#8899b4", fontWeight: ctab === k ? 600 : 400, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", animation: "fadeIn .2s ease" }} key={ctab}>
          {ctab === "attendance" ? <CandAttendance /> : <CandReport />}
        </div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: toast.type === "ok" ? "#22c55e" : "#ef4444", color: "#fff", padding: "10px 24px", borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: "0 6px 20px rgba(0,0,0,.4)" }}>{toast.msg}</div>}
    </div>
  );
}

/* ════════════════════════════════════════ */
/*  OWNER PANEL                           */
/* ════════════════════════════════════════ */
function OwnerPanel({ D, save, pushAlert, notify, setRole, toast }) {
  const OTABS = ["Dashboard", "People", "Attendance", "Reports", "Payroll", "Alerts"];
  const [tab, setTab] = useState("Dashboard");
  const [modal, setModal] = useState(null);
  const [mdata, setMdata] = useState(null);
  const [proj, setProj] = useState("All");
  const [mo, setMo] = useState(monthKey());
  const [side, setSide] = useState(true);

  const E = D.employees || [];
  const FE = proj === "All" ? E : E.filter((e) => e.project === proj);
  const hols = (D.holidays || []).map((h) => h.date);

  const addEmp = (emp) => { save({ ...D, employees: [...E, { ...emp, id: uid(), joinDate: emp.joinDate || todayStr(), code: uid().slice(0, 4) }] }); notify(emp.name + " added"); };
  const delEmp = (id) => { const n = E.find((e) => e.id === id)?.name; save({ ...D, employees: E.filter((e) => e.id !== id) }); notify(n + " removed"); };
  const updEmp = (id, u) => { save({ ...D, employees: E.map((e) => (e.id === id ? { ...e, ...u } : e)) }); notify("Updated"); };

  const markAtt = (eid, date, status) => {
    const att = { ...D.attendance };
    const k = `${eid}_${date}`;
    if (!status) delete att[k]; else att[k] = status;
    save({ ...D, attendance: att });
  };

  const addHoliday = (date, label) => { save({ ...D, holidays: [...(D.holidays || []), { date, label, id: uid() }] }); notify("Holiday added"); };

  const getStats = (eid, mk) => {
    const [y, m] = mk.split("-").map(Number);
    const dim = new Date(y, m, 0).getDate();
    let p = 0, a = 0, l = 0, h = 0, w = 0;
    for (let d = 1; d <= dim; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const v = D.attendance[`${eid}_${ds}`];
      if (v === "present") p++; else if (v === "absent") a++; else if (v === "leave") l++; else if (v === "halfday") h++; else if (v === "wfh") w++;
    }
    return { present: p, absent: a, leave: l, halfday: h, wfh: w, effective: p + w + h * 0.5 };
  };

  const calcPay = (emp, mk) => {
    const [y, m] = mk.split("-").map(Number);
    const totalWD = workDays(y, m, hols);
    const empWD = effDays(y, m, emp.joinDate, emp.exitDate, hols);
    const stats = getStats(emp.id, mk);
    const perDay = totalWD > 0 ? (emp.salary || 0) / totalWD : 0;
    const earned = Math.round(perDay * stats.effective);
    const deductions = Math.round(perDay * stats.absent);
    const isProRata = empWD < totalWD;
    const attPct = empWD > 0 ? Math.round((stats.effective / empWD) * 100) : 0;
    return { totalWD, empWD, ...stats, perDay: Math.round(perDay), earned, deductions, net: Math.max(0, earned), isProRata, attPct };
  };

  const triggerPayReminder = () => {
    const [y, m] = mo.split("-").map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    const MN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const totalNet = E.reduce((s, e) => s + calcPay(e, mo).net, 0);
    const hr = D.config?.hrBudget || 0;
    const grand = totalNet + hr;
    let nd = pushAlert(D, {
      type: "payment", icon: "💰",
      title: `Payment Reminder — 15th ${MN[nm]} ${ny}`,
      msg: `Total: ${fmt(grand)} for ${E.length} people.\n${PROJECTS.map((p) => `• ${p}: ${fmt(E.filter((e) => e.project === p).reduce((s, e) => s + calcPay(e, mo).net, 0))}`).join("\n")}${hr > 0 ? `\n• HR: ${fmt(hr)}` : ""}`,
      sev: "high", project: "All", hasEmail: true, hasSMS: true,
      emailSubject: `[ProjectHub] PAYMENT DUE 15th ${MN[nm]} ${ny} — ${fmt(grand)}`,
      emailBody: `Hi,\n\nSalary due on 15th ${MN[nm]} ${ny}.\n\nMonth: ${MN[m]} ${y}\n\n${E.map((e) => { const s = calcPay(e, mo); return `${e.name} (${e.project}): ${fmt(s.net)} [${s.effective}/${s.empWD} days]`; }).join("\n")}${hr > 0 ? `\n\nHR Budget: ${fmt(hr)}` : ""}\n\nGRAND TOTAL: ${fmt(grand)}\n\n— ProjectHub`,
      smsBody: `ProjectHub: Payment due 15th ${MN[nm]}. Total: ${fmt(grand)} for ${E.length} people.`,
    });
    save(nd);
    notify("Reminder created!");
  };

  // UI helpers
  const Bg = ({ color, children, s = {} }) => <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 14, fontSize: 10, fontWeight: 600, background: color + "1a", color, ...s }}>{children}</span>;
  const Bt = ({ children, onClick, v = "p", s = {}, ...p }) => {
    const vs = { p: { background: "#6366f1", color: "#fff" }, g: { background: "transparent", color: "#8899b4", border: "1px solid #1c2640" }, d: { background: "#ef444420", color: "#ef4444" }, ok: { background: "#22c55e20", color: "#22c55e" } };
    return <button onClick={onClick} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", fontFamily: "inherit", ...vs[v], ...s }} {...p}>{children}</button>;
  };
  const Cd = ({ children, s = {} }) => <div style={{ background: "#0f1520", border: "1px solid #1c2640", borderRadius: 12, padding: 20, ...s }}>{children}</div>;
  const Inp = ({ label, ...p }) => <div style={{ marginBottom: 12 }}>{label && <label style={lblStyle}>{label}</label>}<input style={{ ...inputStyle, width: "100%" }} {...p} /></div>;
  const Txt = ({ label, ...p }) => <div style={{ marginBottom: 12 }}>{label && <label style={lblStyle}>{label}</label>}<textarea style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }} {...p} /></div>;
  const Sl = ({ label, opts, ...p }) => <div style={{ marginBottom: 12 }}>{label && <label style={lblStyle}>{label}</label>}<select style={{ ...inputStyle, width: "100%" }} {...p}>{opts.map((o) => <option key={typeof o === "string" ? o : o.v} value={typeof o === "string" ? o : o.v}>{typeof o === "string" ? o : o.l}</option>)}</select></div>;
  const Mod = ({ title, children, onClose, wide }) => <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.6)", backdropFilter: "blur(5px)" }} onClick={onClose}><div onClick={(e) => e.stopPropagation()} style={{ background: "#0f1520", border: "1px solid #1c2640", borderRadius: 14, padding: 24, width: wide ? 600 : 420, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><h3 style={{ margin: 0, color: "#e8edf5", fontSize: 16 }}>{title}</h3><button onClick={onClose} style={{ background: "none", border: "none", color: "#5a6b85", fontSize: 20, cursor: "pointer" }}>×</button></div>{children}</div></div>;
  const PF = () => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{["All", ...PROJECTS].map((p) => <button key={p} onClick={() => setProj(p)} style={{ padding: "5px 13px", borderRadius: 18, border: proj === p ? "none" : "1px solid #1c2640", background: proj === p ? (p === "All" ? "#6366f1" : PC[p]) : "transparent", color: proj === p ? "#fff" : "#8899b4", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{p}</button>)}</div>;

  // Dashboard
  const rDash = () => {
    const td = todayStr(); const tp = E.filter((e) => { const s = D.attendance[`${e.id}_${td}`]; return s === "present" || s === "wfh"; }).length;
    const unread = (D.alerts || []).filter((a) => !a.read).length;
    return (<div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 22 }}>
        {[["People", E.length, "#6366f1"], ["Present", tp, "#22c55e"], ["Payroll", fmt(E.reduce((s, e) => s + (e.salary || 0), 0)), "#eab308"], ["Alerts", unread, unread ? "#ef4444" : "#5a6b85"]].map(([l, v, c], i) => (
          <Cd key={i} s={{ flex: 1, minWidth: 140 }}><div style={{ fontSize: 10, color: "#5a6b85", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{l}</div><div style={{ fontSize: 26, fontWeight: 700, color: c }}>{v}</div></Cd>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Cd><h4 style={{ margin: "0 0 12px", color: "#e8edf5", fontSize: 14 }}>Projects</h4>
          {PROJECTS.map((p) => { const c = E.filter((e) => e.project === p).length; const pct = E.length ? (c / E.length * 100) : 0; return (<div key={p} style={{ marginBottom: 14 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}><span style={{ fontSize: 12, color: "#8899b4" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: PC[p], marginRight: 6 }} />{p}</span><span style={{ fontSize: 12, color: "#e8edf5", fontWeight: 600 }}>{c}</span></div><div style={{ height: 4, background: "#1c2640", borderRadius: 2 }}><div style={{ height: "100%", width: `${pct}%`, background: PC[p], borderRadius: 2 }} /></div></div>); })}
        </Cd>
        <Cd><h4 style={{ margin: "0 0 12px", color: "#e8edf5", fontSize: 14 }}>Recent Alerts</h4>
          {(D.alerts || []).slice(0, 5).map((a) => (<div key={a.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid #1c2640" }}><span>{a.icon}</span><div style={{ flex: 1 }}><div style={{ fontSize: 11, color: "#e8edf5", fontWeight: 500 }}>{a.title}</div><div style={{ fontSize: 9, color: "#5a6b85" }}>{new Date(a.ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</div></div>{!a.read && <span style={{ width: 5, height: 5, borderRadius: 3, background: "#6366f1", marginTop: 5 }} />}</div>))}
          {!(D.alerts || []).length && <p style={{ color: "#5a6b85", fontSize: 12 }}>No alerts</p>}
        </Cd>
      </div>
      {E.length > 0 && <Cd s={{ marginTop: 16 }}><h4 style={{ margin: "0 0 10px", color: "#e8edf5", fontSize: 14 }}>🔑 Access Codes <span style={{ fontWeight: 400, fontSize: 11, color: "#5a6b85" }}>(share with team)</span></h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>
          {E.map((e) => <div key={e.id} style={{ padding: "8px 12px", background: "#151d2e", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: 12, color: "#e8edf5" }}>{e.name}</span><code style={{ fontSize: 13, color: "#6366f1", fontWeight: 700, background: "#6366f115", padding: "2px 8px", borderRadius: 4 }}>{e.code || e.id.slice(0, 4)}</code></div>)}
        </div>
      </Cd>}
    </div>);
  };

  // People
  const rPeople = () => {
    const Form = ({ init, onSave, btn }) => {
      const [f, sF] = useState(init || { name: "", role: "", project: PROJECTS[0], salary: "", email: "", phone: "", joinDate: todayStr(), exitDate: "" });
      return (<div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}><Inp label="Name *" value={f.name} onChange={(e) => sF({ ...f, name: e.target.value })} /><Inp label="Role" value={f.role} onChange={(e) => sF({ ...f, role: e.target.value })} /></div>
        <Sl label="Project *" opts={PROJECTS} value={f.project} onChange={(e) => sF({ ...f, project: e.target.value })} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}><Inp label="Salary (₹) *" type="number" value={f.salary} onChange={(e) => sF({ ...f, salary: e.target.value })} /><Inp label="Join Date" type="date" value={f.joinDate} onChange={(e) => sF({ ...f, joinDate: e.target.value })} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}><Inp label="Email" value={f.email} onChange={(e) => sF({ ...f, email: e.target.value })} /><Inp label="Phone" value={f.phone} onChange={(e) => sF({ ...f, phone: e.target.value })} /></div>
        <Inp label="Exit Date" type="date" value={f.exitDate} onChange={(e) => sF({ ...f, exitDate: e.target.value })} />
        <Bt onClick={() => { if (f.name && f.salary) onSave({ ...f, salary: Number(f.salary) || 0 }); }} s={{ width: "100%", marginTop: 6 }}>{btn || "Save"}</Bt>
      </div>);
    };
    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}><PF /><Bt onClick={() => setModal("addEmp")}>+ Add Person</Bt></div>
      {!FE.length ? <Cd s={{ textAlign: "center", padding: 40 }}><p style={{ color: "#5a6b85" }}>No people yet.</p></Cd> :
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr 1fr .7fr .5fr", padding: "4px 14px", fontSize: 10, color: "#5a6b85", textTransform: "uppercase" }}><span>Name</span><span>Role</span><span>Project</span><span>Salary</span><span>Code</span><span></span></div>
          {FE.map((e) => (<div key={e.id} style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr 1fr .7fr .5fr", alignItems: "center", padding: "10px 14px", background: "#0f1520", border: "1px solid #1c2640", borderRadius: 10 }}>
            <div><div style={{ fontSize: 13, fontWeight: 600, color: "#e8edf5" }}>{e.name}</div>{e.email && <div style={{ fontSize: 10, color: "#5a6b85" }}>{e.email}</div>}</div>
            <span style={{ fontSize: 12, color: "#8899b4" }}>{e.role || "—"}</span>
            <Bg color={PC[e.project]}>{e.project}</Bg>
            <span style={{ fontSize: 13, color: "#e8edf5", fontWeight: 500 }}>{fmt(e.salary)}</span>
            <code style={{ fontSize: 12, color: "#6366f1", fontWeight: 700 }}>{e.code || e.id.slice(0, 4)}</code>
            <div style={{ display: "flex", gap: 4 }}><button onClick={() => { setMdata(e); setModal("editEmp"); }} style={{ background: "none", border: "none", color: "#5a6b85", cursor: "pointer", fontSize: 12 }}>✏️</button><button onClick={() => delEmp(e.id)} style={{ background: "none", border: "none", color: "#5a6b85", cursor: "pointer", fontSize: 12 }}>🗑</button></div>
          </div>))}
        </div>}
      {modal === "addEmp" && <Mod title="Add Person" onClose={() => setModal(null)}><Form onSave={(e) => { addEmp(e); setModal(null); }} btn="Add" /></Mod>}
      {modal === "editEmp" && mdata && <Mod title={`Edit — ${mdata.name}`} onClose={() => { setModal(null); setMdata(null); }}><Form init={{ ...mdata, salary: String(mdata.salary) }} onSave={(u) => { updEmp(mdata.id, u); setModal(null); setMdata(null); }} btn="Update" /></Mod>}
    </div>);
  };

  // Attendance
  const rAtt = () => {
    const [y, m] = mo.split("-").map(Number); const dim = new Date(y, m, 0).getDate(); const wd = workDays(y, m, hols);
    const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; const holSet = new Set(hols);
    const dates = Array.from({ length: dim }, (_, i) => { const dt = new Date(y, m - 1, i + 1); const ds = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`; return { date: ds, day: i + 1, dn: DN[dt.getDay()], isWE: dt.getDay() === 0 || dt.getDay() === 6, isHol: holSet.has(ds) }; });
    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="month" value={mo} onChange={(e) => setMo(e.target.value)} style={inputStyle} /><span style={{ fontSize: 11, color: "#5a6b85" }}>{wd} days</span><Bt v="g" s={{ fontSize: 10, padding: "5px 10px" }} onClick={() => setModal("addHol")}>+ Holiday</Bt></div>
        <div style={{ display: "flex", gap: 8, fontSize: 10 }}>{Object.entries(SC).map(([k, c]) => <span key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{k}</span>)}</div>
      </div>
      {!FE.length ? <Cd s={{ textAlign: "center", padding: 30 }}><p style={{ color: "#5a6b85" }}>Add people first.</p></Cd> :
        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #1c2640" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead><tr style={{ background: "#151d2e" }}><th style={{ position: "sticky", left: 0, background: "#151d2e", zIndex: 2, padding: "6px 10px", textAlign: "left", color: "#5a6b85", minWidth: 110, fontSize: 9 }}>Name</th>
            {dates.map((d) => <th key={d.day} style={{ padding: "3px 1px", textAlign: "center", color: d.isWE ? "#5a6b8530" : d.isHol ? "#ec4899" : "#8899b4", minWidth: 28, fontSize: 8 }}><div>{d.dn[0]}</div><div style={{ fontWeight: 700, fontSize: 10 }}>{d.day}</div></th>)}
            <th style={{ padding: "5px", textAlign: "center", color: "#22c55e", minWidth: 30, fontSize: 9, position: "sticky", right: 0, background: "#151d2e" }}>Eff</th>
          </tr></thead>
          <tbody>{FE.map((emp, ei) => {
            const st = getStats(emp.id, mo); return (<tr key={emp.id} style={{ background: ei % 2 === 0 ? "#0f1520" : "#080c14" }}>
              <td style={{ position: "sticky", left: 0, background: ei % 2 === 0 ? "#0f1520" : "#080c14", zIndex: 1, padding: "6px 10px", fontWeight: 500, color: "#e8edf5", fontSize: 11 }}>{emp.name}<div style={{ fontSize: 8, color: "#5a6b85" }}>{emp.project}</div></td>
              {dates.map((d) => { const v = D.attendance[`${emp.id}_${d.date}`]; const isOff = d.isWE || d.isHol; return (<td key={d.day} style={{ textAlign: "center", padding: 1, opacity: isOff && !v ? 0.2 : 1 }}><button onClick={() => { if (!d.isWE) markAtt(emp.id, d.date, SCYCLE[(SCYCLE.indexOf(v) + 1) % SCYCLE.length]); }} style={{ width: 22, height: 22, borderRadius: 3, border: d.isHol && !v ? "1px dashed #ec4899" : "none", cursor: d.isWE ? "default" : "pointer", fontSize: 8, fontWeight: 700, background: v ? SC[v] + "20" : "transparent", color: v ? SC[v] : "#5a6b85", padding: 0, lineHeight: "22px" }}>{v ? SL[v] : d.isHol ? "H" : "·"}</button></td>); })}
              <td style={{ textAlign: "center", fontWeight: 700, color: "#22c55e", fontSize: 12, position: "sticky", right: 0, background: ei % 2 === 0 ? "#0f1520" : "#080c14" }}>{st.effective}</td>
            </tr>);
          })}</tbody>
        </table></div>}
      {modal === "addHol" && <Mod title="Add Holiday" onClose={() => setModal(null)}><Inp label="Date" type="date" id="hd" /><Inp label="Name" id="hn" placeholder="Diwali..." /><Bt onClick={() => { const d = document.getElementById("hd").value; const n = document.getElementById("hn").value; if (d && n) { addHoliday(d, n); setModal(null); } }} s={{ width: "100%" }}>Add</Bt></Mod>}
    </div>);
  };

  // Reports
  const rRpt = () => {
    const rr = proj === "All" ? D.reports : D.reports.filter((r) => r.project === proj);
    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><PF /></div>
      {!rr.length ? <Cd s={{ textAlign: "center", padding: 40 }}><p style={{ color: "#5a6b85" }}>No reports yet. Team members submit from their portal.</p></Cd> :
        <div style={{ display: "grid", gap: 10 }}>{[...rr].reverse().map((r) => {
          const emp = E.find((e) => e.id === r.empId);
          return (<Cd key={r.id}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div><div style={{ fontSize: 13, fontWeight: 600, color: "#e8edf5" }}>{emp?.name || "?"}</div><div style={{ fontSize: 10, color: "#5a6b85" }}>{r.date} · Week of {r.weekOf}{r.hours ? ` · ${r.hours}h` : ""}</div></div>
              <div style={{ display: "flex", gap: 6, alignItems: 'center' }}>
                {r.attachment && (
                  <button onClick={() => { setMdata(r); setModal("viewAttach"); }} style={{ background: "#6366f120", border: "1px solid #6366f140", borderRadius: 4, padding: "2px 8px", color: "#6366f1", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>📎 Attachment</button>
                )}
                <Bg color={PC[r.project]}>{r.project}</Bg>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#8899b4", lineHeight: 1.6 }}>
              {r.summary && <div style={{ marginBottom: 4 }}><strong style={{ color: "#e8edf5" }}>Done:</strong> {r.summary}</div>}
              {r.blockers && <div style={{ marginBottom: 4 }}><strong style={{ color: "#ef4444" }}>Blockers:</strong> {r.blockers}</div>}
              {r.nextWeek && <div><strong style={{ color: "#6366f1" }}>Next:</strong> {r.nextWeek}</div>}
              {!r.summary && r.attachment && <div style={{ color: "#6366f1", fontSize: 11, fontStyle: 'italic' }}>Report submitted via attachment only.</div>}
            </div>
          </Cd>);
        })}</div>}

      {modal === "viewAttach" && mdata && (
        <Mod title={`📎 Attachment: ${mdata.attachmentName}`} onClose={() => { setModal(null); setMdata(null); }} wide>
          <div style={{ background: "#080c14", borderRadius: 8, padding: 10, textAlign: 'center', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {mdata.attachment?.startsWith("data:image/") ? (
              <img src={mdata.attachment} style={{ maxWidth: '100%', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,.5)' }} />
            ) : (
              <div style={{ padding: 40 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                <div style={{ color: '#e8edf5', fontSize: 14, marginBottom: 16 }}>{mdata.attachmentName}</div>
                <a href={mdata.attachment} download={mdata.attachmentName} style={{ display: 'inline-block', padding: '10px 20px', background: '#6366f1', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 13 }}>Download File</a>
              </div>
            )}
          </div>
        </Mod>
      )}
    </div>);
  };

  // Payroll
  const rPay = () => {
    const [y, m] = mo.split("-").map(Number); const wd = workDays(y, m, hols);
    const all = E.map((e) => ({ e, s: calcPay(e, mo) })); const totalNet = all.reduce((s, x) => s + x.s.net, 0); const hr = D.config?.hrBudget || 0; const grand = totalNet + hr;
    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <input type="month" value={mo} onChange={(e) => setMo(e.target.value)} style={inputStyle} />
        <div style={{ display: "flex", gap: 6 }}><Bt v="g" s={{ fontSize: 11 }} onClick={() => setModal("payConf")}>⚙ Config</Bt><Bt v="ok" s={{ fontSize: 11 }} onClick={triggerPayReminder}>🔔 15th Reminder</Bt></div>
      </div>
      <div style={{ background: "linear-gradient(135deg,#1e1b4b,#0f1520 70%)", borderRadius: 12, padding: 18, marginBottom: 16, border: "1px solid #1c2640", display: "flex", justifyContent: "space-around", textAlign: "center", flexWrap: "wrap", gap: 12 }}>
        {[["Working Days", wd, "#6366f1"], ["Earned", fmt(totalNet), "#22c55e"], hr > 0 && ["HR", fmt(hr), "#ec4899"], ["Total", fmt(grand), "#eab308"]].filter(Boolean).map(([l, v, c], i) => (<div key={i}><div style={{ fontSize: 9, color: "#5a6b85", textTransform: "uppercase", letterSpacing: 1 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: c, marginTop: 3 }}>{v}</div></div>))}
      </div>
      {PROJECTS.map((pr) => {
        const pe = all.filter((x) => x.e.project === pr); if (!pe.length) return null; const pt = pe.reduce((s, x) => s + x.s.net, 0); const hs = hr > 0 ? Math.round(hr / PROJECTS.length) : 0;
        return (<Cd key={pr} s={{ marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h4 style={{ margin: 0, color: "#e8edf5", fontSize: 13 }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: PC[pr], marginRight: 6 }} />{pr} ({pe.length})</h4>
          <span style={{ fontSize: 12, color: "#8899b4" }}>Pay: <strong style={{ color: "#22c55e" }}>{fmt(pt)}</strong>{hs > 0 && <span style={{ color: "#5a6b85", fontSize: 10 }}> +HR {fmt(hs)}</span>}</span>
        </div>
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr>{["Name", "Gross", "Days", "Attendance", "Per Day", "Net", "Flags"].map((h) => <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: "#5a6b85", fontSize: 9, textTransform: "uppercase", borderBottom: "1px solid #1c2640" }}>{h}</th>)}</tr></thead>
            <tbody>{pe.map(({ e: emp, s: sal }) => (<tr key={emp.id} style={{ borderBottom: "1px solid #1c2640" }}>
              <td style={{ padding: "8px", color: "#e8edf5", fontWeight: 500, fontSize: 12 }}>{emp.name}</td>
              <td style={{ padding: "8px", color: "#8899b4" }}>{fmt(emp.salary)}</td>
              <td style={{ padding: "8px" }}><span style={{ color: "#22c55e", fontWeight: 600 }}>{sal.effective}</span><span style={{ color: "#5a6b85" }}>/{sal.empWD}</span></td>
              <td style={{ padding: "8px" }}><div style={{ display: "flex", gap: 3, fontSize: 9 }}>
                {sal.present > 0 && <span style={{ color: SC.present }}>{sal.present}P</span>}{sal.wfh > 0 && <span style={{ color: SC.wfh }}>{sal.wfh}W</span>}{sal.halfday > 0 && <span style={{ color: SC.halfday }}>{sal.halfday}H</span>}{sal.absent > 0 && <span style={{ color: SC.absent }}>{sal.absent}A</span>}{sal.leave > 0 && <span style={{ color: SC.leave }}>{sal.leave}L</span>}
              </div><div style={{ height: 3, background: "#1c2640", borderRadius: 2, marginTop: 3, width: 55 }}><div style={{ height: "100%", width: `${sal.attPct}%`, background: sal.attPct >= 90 ? "#22c55e" : sal.attPct >= 70 ? "#eab308" : "#ef4444", borderRadius: 2 }} /></div></td>
              <td style={{ padding: "8px", color: "#8899b4" }}>{fmt(sal.perDay)}</td>
              <td style={{ padding: "8px", color: "#22c55e", fontWeight: 700 }}>{fmt(sal.net)}</td>
              <td style={{ padding: "8px" }}><div style={{ display: "flex", gap: 3 }}>
                {sal.isProRata && <Bg color="#06b6d4" s={{ fontSize: 8, padding: "1px 5px" }}>Pro-rata</Bg>}
                {sal.attPct > 0 && sal.attPct < 70 && <Bg color="#ef4444" s={{ fontSize: 8, padding: "1px 5px" }}>Low</Bg>}
              </div></td>
            </tr>))}</tbody>
          </table></div></Cd>);
      })}
      {modal === "payConf" && <Mod title="⚙ Payroll Config" onClose={() => setModal(null)}>
        <Inp label="Your Email" defaultValue={D.config?.email || ""} id="cfe" placeholder="deepak@company.com" />
        <Inp label="Phone (SMS)" defaultValue={D.config?.phone || ""} id="cfp" placeholder="+91 98765 43210" />
        <Inp label="HR Budget (₹/month)" type="number" defaultValue={D.config?.hrBudget || ""} id="cfh" />
        <Inp label="Admin PIN" defaultValue={D.config?.pin || "1205"} id="cfpin" />
        <Bt onClick={() => { save({ ...D, config: { ...D.config, email: document.getElementById("cfe").value, phone: document.getElementById("cfp").value, hrBudget: Number(document.getElementById("cfh").value) || 0, pin: document.getElementById("cfpin").value || "1205" } }); setModal(null); notify("Saved!"); }} s={{ width: "100%" }}>Save Config</Bt>
      </Mod>}
    </div>);
  };

  // Alerts
  const rAlerts = () => {
    const alerts = D.alerts || []; const unread = alerts.filter((a) => !a.read).length;
    const sevC = { high: "#ef4444", med: "#eab308", info: "#6366f1" };
    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#8899b4" }}>{unread} unread</span>
        <div style={{ display: "flex", gap: 6 }}>
          <Bt v="g" s={{ fontSize: 10, padding: "5px 12px" }} onClick={() => save({ ...D, alerts: alerts.map((a) => ({ ...a, read: true })) })}>Mark Read</Bt>
          <Bt v="g" s={{ fontSize: 10, padding: "5px 12px" }} onClick={() => { save({ ...D, alerts: [] }); notify("Cleared"); }}>Clear</Bt>
        </div>
      </div>
      {!alerts.length ? <Cd s={{ textAlign: "center", padding: 40 }}><p style={{ color: "#5a6b85" }}>Alerts appear when team members mark attendance or submit reports.</p></Cd> :
        <div style={{ display: "grid", gap: 8 }}>{alerts.map((a) => (<Cd key={a.id} s={{ borderLeft: `3px solid ${sevC[a.sev] || "#6366f1"}`, opacity: a.read ? .6 : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><span>{a.icon}</span><span style={{ fontSize: 13, fontWeight: 600, color: "#e8edf5" }}>{a.title}</span>{!a.read && <span style={{ width: 5, height: 5, borderRadius: 3, background: "#6366f1" }} />}</div>
              <p style={{ margin: 0, fontSize: 12, color: "#8899b4", lineHeight: 1.5, whiteSpace: "pre-line" }}>{a.msg}</p>
              <div style={{ fontSize: 10, color: "#5a6b85", marginTop: 4 }}>{new Date(a.ts).toLocaleString("en-IN")}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
              {a.hasEmail && <Bt v="g" s={{ fontSize: 10, padding: "4px 10px" }} onClick={() => { setMdata(a); setModal("emailPrev"); }}>📧 Email</Bt>}
              {a.hasSMS && <Bt v="g" s={{ fontSize: 10, padding: "4px 10px" }} onClick={() => { setMdata(a); setModal("smsPrev"); }}>💬 SMS</Bt>}
            </div>
          </div>
        </Cd>))}</div>}
      {modal === "emailPrev" && mdata && <Mod title="📧 Email Preview" onClose={() => { setModal(null); setMdata(null); }} wide>
        <div style={{ background: "#151d2e", borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#5a6b85", marginBottom: 3 }}>TO: {D.config?.email || "(set in Config)"}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8edf5", paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid #1c2640" }}>Subject: {mdata.emailSubject}</div>
          <pre style={{ fontSize: 12, color: "#8899b4", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{mdata.emailBody}</pre>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Bt v="g" onClick={() => { setModal(null); setMdata(null); }}>Close</Bt>
          <Bt onClick={() => { window.open(`mailto:${D.config?.email || ""}?subject=${encodeURIComponent(mdata.emailSubject)}&body=${encodeURIComponent(mdata.emailBody)}`, "_blank"); notify("Mail opened!"); }}>📧 Send</Bt>
        </div>
      </Mod>}
      {modal === "smsPrev" && mdata && <Mod title="💬 SMS Preview" onClose={() => { setModal(null); setMdata(null); }}>
        <div style={{ background: "#151d2e", borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#5a6b85", marginBottom: 6 }}>TO: {D.config?.phone || "(set in Config)"}</div>
          <p style={{ margin: 0, fontSize: 14, color: "#e8edf5", lineHeight: 1.6 }}>{mdata.smsBody}</p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Bt v="g" onClick={() => { setModal(null); setMdata(null); }}>Close</Bt>
          <Bt onClick={() => { window.open(`sms:${D.config?.phone || ""}?body=${encodeURIComponent(mdata.smsBody)}`, "_blank"); notify("SMS opened!"); }}>💬 Send</Bt>
        </div>
      </Mod>}
    </div>);
  };

  const content = { Dashboard: rDash, People: rPeople, Attendance: rAtt, Reports: rRpt, Payroll: rPay, Alerts: rAlerts };
  const icons = { Dashboard: "◈", People: "◉", Attendance: "◫", Reports: "◧", Payroll: "◆", Alerts: "◎" };
  const unread = (D.alerts || []).filter((a) => !a.read).length;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans',sans-serif", background: "#080c14", color: "#e8edf5", overflow: "hidden" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
button:hover{filter:brightness(1.1);}input:focus,select:focus,textarea:focus{border-color:#6366f1!important;}
*{scrollbar-width:thin;scrollbar-color:#1c2640 transparent;}`}</style>
      <div style={{ width: side ? 210 : 50, background: "#0f1520", borderRight: "1px solid #1c2640", display: "flex", flexDirection: "column", transition: "width .2s", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ padding: "16px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #1c2640" }}>
          <button onClick={() => setSide(!side)} style={{ background: "none", border: "none", color: "#e8edf5", fontSize: 16, cursor: "pointer", flexShrink: 0, width: 24, textAlign: "center" }}>{side ? "\u27E8" : "\u27E9"}</button>
          {side && <div><div style={{ fontSize: 14, fontWeight: 700 }}>ProjectHub</div><div style={{ fontSize: 8, color: "#5a6b85" }}>👑 OWNER</div></div>}
        </div>
        <div style={{ padding: "8px 5px", flex: 1 }}>
          {OTABS.map((t) => (<button key={t} onClick={() => setTab(t)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 7, border: "none", background: tab === t ? "#6366f120" : "transparent", color: tab === t ? "#6366f1" : "#8899b4", fontSize: 12, fontWeight: tab === t ? 600 : 400, cursor: "pointer", marginBottom: 1, textAlign: "left", position: "relative", fontFamily: "inherit" }}>
            <span style={{ fontSize: 13, flexShrink: 0, width: 18, textAlign: "center", opacity: tab === t ? 1 : .5 }}>{icons[t]}</span>
            {side && <span>{t}</span>}
            {t === "Alerts" && unread > 0 && <span style={{ position: "absolute", right: side ? 8 : 2, top: side ? "50%" : 2, transform: side ? "translateY(-50%)" : "none", background: "#ef4444", color: "#fff", fontSize: 8, fontWeight: 700, borderRadius: 8, padding: "1px 5px" }}>{unread}</span>}
          </button>))}
        </div>
        {side && <div style={{ padding: "12px", borderTop: "1px solid #1c2640" }}>
          <button onClick={() => setRole(null)} style={{ width: "100%", padding: "8px", borderRadius: 6, border: "1px solid #1c2640", background: "transparent", color: "#5a6b85", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>Logout</button>
        </div>}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "22px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{tab}</h2>
            <span style={{ fontSize: 11, color: "#5a6b85" }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          </div>
          <div style={{ animation: "fadeIn .2s ease" }} key={tab}>{content[tab]()}</div>
        </div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 18, right: 18, background: toast.type === "ok" ? "#22c55e" : "#ef4444", color: "#fff", padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, zIndex: 9999, boxShadow: "0 6px 20px rgba(0,0,0,.3)" }}>{toast.msg}</div>}
    </div>
  );
}

const inputStyle = { padding: "9px 12px", borderRadius: 8, border: "1px solid #1c2640", background: "#151d2e", color: "#e8edf5", fontSize: 13, outline: "none", boxSizing: "border-box" };
const lblStyle = { display: "block", fontSize: 12, color: "#8899b4", marginBottom: 3, fontWeight: 500 };


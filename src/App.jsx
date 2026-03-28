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
const getWeekStart = (d = new Date()) => {
  const dt = new Date(d);
  const day = dt.getDay() || 7;
  if (day !== 1) dt.setHours(-24 * (day - 1));
  return dt.toISOString().split('T')[0];
};
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
  attendanceApprovals: {},
  config: { hrBudgets: { "I-Genie": 7000, "Lenovo": 10000, "Persistent": 10000 }, email: "", phone: "", pin: "1205" },
};
const SK = "projecthub_data";
const PC = { "I-Genie": "#a78bfa", Lenovo: "#fb923c", Persistent: "#34d399" };
const SC = { present: "#22c55e", absent: "#ef4444", leave: "#eab308", halfday: "#06b6d4", wfh: "#ec4899" };
const SL = { present: "P", absent: "A", leave: "L", halfday: "\u00BD", wfh: "W" };
const SCYCLE = [undefined, "present", "absent", "leave", "halfday", "wfh"];

const inputStyle = { padding: "9px 12px", borderRadius: 8, border: "1px solid #1c2640", background: "#151d2e", color: "#e8edf5", fontSize: 13, outline: "none", boxSizing: "border-box" };
const lblStyle = { display: "block", fontSize: 12, color: "#8899b4", marginBottom: 3, fontWeight: 500 };

/* ── Storage helpers (localStorage only) ── */
function loadFromStorage() {
  const keys = [SK, "phub4", "phub3", "hub-data-v2", "hub-data"];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const d = JSON.parse(raw);
      if (d && d.employees) {
        if (!d.config) d.config = { ...INIT.config };
        if (d.config.hrBudget !== undefined && !d.config.hrBudgets) {
          d.config.hrBudgets = { "I-Genie": d.config.hrBudget, "Lenovo": 10000, "Persistent": 10000 };
          delete d.config.hrBudget;
        }
        if (!d.config.hrBudgets) d.config.hrBudgets = { ...INIT.config.hrBudgets };
        if (d.config.pin === "1234" || !d.config.pin) d.config.pin = "1205";
        if (!d.alerts) d.alerts = [];
        if (!d.holidays) d.holidays = [];
        if (!d.attendance) d.attendance = {};
        if (!d.attendanceApprovals) d.attendanceApprovals = {};
        if (!d.reports) d.reports = [];
        d.reports = d.reports.map(r => ({ ...r, status: r.status || "approved" }));
        d.employees = (d.employees || []).map((e) => ({
          ...e,
          salary: e.salary || e.monthlySalary || 0,
          code: e.code || uid().slice(0, 4),
        }));
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

/* ── Utilities Shareable ── */
const getStats = (eid, mk, D) => {
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

const calcPay = (emp, mk, D, hols) => {
  const [y, m] = mk.split("-").map(Number);
  const totalWD = workDays(y, m, hols);
  const empWD = effDays(y, m, emp.joinDate, emp.exitDate, hols);
  const stats = getStats(emp.id, mk, D);
  const perDay = totalWD > 0 ? (emp.salary || 0) / totalWD : 0;
  const earned = Math.round(perDay * stats.effective);
  const isProRata = empWD < totalWD;
  const attPct = empWD > 0 ? Math.round((stats.effective / empWD) * 100) : 0;

  const weeks = [];
  const firstDay = new Date(y, m - 1, 1);
  while (firstDay.getMonth() === m - 1) {
    if (firstDay.getDay() === 1 || firstDay.getDate() === 1) {
      weeks.push(getWeekStart(firstDay));
    }
    firstDay.setDate(firstDay.getDate() + 7);
  }
  const uniqWeeks = [...new Set(weeks)];
  const approvedWeeks = uniqWeeks.filter(ws => {
    const isAttApproved = D.attendanceApprovals?.[`${emp.id}_${ws}`];
    const hasApprovedReport = D.reports?.some(r => r.empId === emp.id && r.weekOf === ws && r.status === "approved");
    return isAttApproved && hasApprovedReport;
  });

  const approvedPct = uniqWeeks.length > 0 ? approvedWeeks.length / uniqWeeks.length : 0;
  const approvedNet = Math.round(earned * approvedPct);

  return { totalWD, empWD, ...stats, perDay: Math.round(perDay), earned, net: Math.max(0, earned), approvedNet, isProRata, attPct, approvedWeeksCount: approvedWeeks.length, totalWeeksCount: uniqWeeks.length };
};

/* ── Main App ── */
export default function App() {
  const [D, setD] = useState(null);
  const [role, setRole] = useState(null);
  const [candId, setCandId] = useState(null);
  const [toast, setToast] = useState(null);
  const [dbError, setDbError] = useState(null);
  const tt = useRef();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setD(loadFromStorage());
      return;
    }
    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'id=eq.projecthub' }, (payload) => {
        if (payload.new && payload.new.data) {
          setD(payload.new.data);
          saveToStorage(payload.new.data);
        }
      })
      .subscribe();

    async function init() {
      try {
        const { data, error } = await supabase.from('settings').select('data').eq('id', 'projecthub').single();
        if (error) {
          if (error.code === 'PGRST116') {
            const initial = loadFromStorage();
            setD(initial);
            await supabase.from('settings').upsert({ id: 'projecthub', data: initial });
          } else {
            setD(loadFromStorage());
          }
        } else if (data && data.data) {
          setD(data.data);
          saveToStorage(data.data);
        }
      } catch (e) {
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
    saveToStorage(nd);
    if (!isSupabaseConfigured) return;
    try {
      await supabase.from('settings').upsert({ id: 'projecthub', data: nd });
    } catch (e) { console.error(e); }
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

  if (!D) return <div style={{ background: "#080c14", height: "100vh" }} />;
  if (!role) return <LoginScreen D={D} setRole={setRole} setCandId={setCandId} notify={notify} />;

  if (role === "candidate") return <CandidatePortal D={D} save={save} candId={candId} pushAlert={pushAlert} notify={notify} setRole={setRole} setCandId={setCandId} toast={toast} />;

  return <OwnerPanel D={D} save={save} pushAlert={pushAlert} notify={notify} setRole={setRole} toast={toast} />;
}

function LoginScreen({ D, setRole, setCandId, notify }) {
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
@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
      <div style={{ width: 400, animation: "fadeIn .4s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "linear-gradient(135deg,#6366f1,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 28, fontWeight: 700 }}>P</div>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>ProjectHub</h2>
        </div>
        {!mode ? (
          <div>
            <button onClick={() => setMode("owner")} style={{ width: "100%", padding: "18px", borderRadius: 12, border: "1px solid #1c2640", background: "#0f1520", color: "#e8edf5", cursor: "pointer", marginBottom: 12, textAlign: "left" }}>
              <div style={{ fontWeight: 600 }}>👑 Owner Login</div>
            </button>
            <button onClick={() => setMode("candidate")} style={{ width: "100%", padding: "18px", borderRadius: 12, border: "1px solid #1c2640", background: "#0f1520", color: "#e8edf5", cursor: "pointer", textAlign: "left" }}>
              <div style={{ fontWeight: 600 }}>👤 Team Member Login</div>
            </button>
          </div>
        ) : (
          <div style={{ background: "#0f1520", borderRadius: 14, border: "1px solid #1c2640", padding: 24, animation: pinErr ? "shake .3s" : "fadeIn .3s" }}>
            <button onClick={() => setMode(null)} style={{ background: "none", border: "none", color: "#5a6b85", cursor: "pointer", marginBottom: 12 }}>&larr; Back</button>
            {mode === "owner" ? (
              <>
                <label style={lblStyle}>Admin PIN</label>
                <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ownerLogin()} style={{ ...inputStyle, width: "100%", textAlign: "center", letterSpacing: 4 }} />
                <button onClick={ownerLogin} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", marginTop: 16, cursor: "pointer" }}>Login</button>
              </>
            ) : (
              <>
                <label style={lblStyle}>Name</label>
                <select value={selEmp} onChange={(e) => setSelEmp(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 12 }}>
                  <option value="">— Choose —</option>
                  {E.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <label style={lblStyle}>Access Code</label>
                <input value={empCode} onChange={(e) => setEmpCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && candLogin()} style={{ ...inputStyle, width: "100%", textAlign: "center" }} />
                <button onClick={candLogin} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#22c55e", color: "#fff", marginTop: 16, cursor: "pointer" }}>Login</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CandidatePortal({ D, save, candId, pushAlert, notify, setRole, setCandId, toast }) {
  const [ctab, setCtab] = useState("attendance");
  const [mo, setMo] = useState(monthKey());
  const emp = (D.employees || []).find((e) => e.id === candId);
  if (!emp) return null;
  const hols = (D.holidays || []).map((h) => h.date);

  const markAtt = (date, status) => {
    const att = { ...D.attendance };
    const k = `${candId}_${date}`;
    if (!status) delete att[k]; else att[k] = status;
    let nd = { ...D, attendance: att };
    nd = pushAlert(nd, { type: "cand_attendance", icon: "📌", title: `${emp.name} marked ${status}`, msg: `${emp.name} marked ${status} on ${date}`, project: emp.project });
    save(nd);
    notify("Attendance Marked");
  };

  const CandAttendance = () => {
    const [y, m] = mo.split("-").map(Number);
    const dim = new Date(y, m, 0).getDate();
    const days = Array.from({ length: dim }, (_, i) => ({ day: i + 1, date: `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}` }));
    return (
      <div>
        <input type="month" value={mo} onChange={(e) => setMo(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
          {days.map(d => {
            const v = D.attendance[`${candId}_${d.date}`];
            return (
              <button key={d.day} onClick={() => { const nx = SCYCLE[(SCYCLE.indexOf(v) + 1) % SCYCLE.length]; markAtt(d.date, nx); }} style={{ padding: 10, borderRadius: 8, background: v ? SC[v] + "20" : "#0f1520", border: "1px solid #1c2640", color: v ? SC[v] : "#e8edf5", cursor: "pointer" }}>
                <div>{d.day}</div><div style={{ fontSize: 8 }}>{v ? SL[v] : ""}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const CandReport = () => {
    const [f, sF] = useState({ weekOf: getWeekStart(), summary: "", blockers: "", nextWeek: "", hours: "" });
    const myReports = (D.reports || []).filter(r => r.empId === candId);
    const stats = calcPay(emp, mo, D, hols);

    const submit = () => {
      const nr = { ...f, id: uid(), date: todayStr(), time: fmtTime(), empId: candId, status: "pending", project: emp.project };
      save({ ...D, reports: [nr, ...(D.reports || [])] });
      notify("Report Submitted");
    };

    return (
      <div>
        <div style={{ background: "linear-gradient(135deg,#064e3b,#0f1520)", border: "1px solid #05966950", borderRadius: 12, padding: 18, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, color: "#10b981", fontWeight: 700, textTransform: "uppercase" }}>Money Earned (Approved)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>{fmt(stats.approvedNet)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#5a6b85" }}>MONTHLY POTENTIAL</div>
              <div style={{ fontSize: 14, color: "#8899b4" }}>{fmt(stats.net)}</div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#5a6b85", marginTop: 8 }}>{stats.approvedWeeksCount}/{stats.totalWeeksCount} weeks fully approved.</div>
        </div>
        <div style={{ background: "#0f1520", padding: 20, borderRadius: 12, border: "1px solid #1c2640" }}>
          <h3 style={{ margin: "0 0 12px" }}>Submit Weekly Report</h3>
          <label style={lblStyle}>Week Of</label>
          <input type="date" value={f.weekOf} onChange={e => sF({ ...f, weekOf: e.target.value })} style={{ ...inputStyle, width: "100%", marginBottom: 12 }} />
          <textarea value={f.summary} onChange={e => sF({ ...f, summary: e.target.value })} placeholder="Work summary..." style={{ ...inputStyle, width: "100%", height: 80, marginBottom: 12 }} />
          <button onClick={submit} style={{ width: "100%", padding: 12, background: "#6366f1", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer" }}>Submit Report</button>
        </div>
        <div style={{ marginTop: 24 }}>
          {myReports.slice(0, 5).map(r => (
            <div key={r.id} style={{ padding: 12, background: "#0f1520", borderRadius: 8, border: "1px solid #1c2640", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12 }}>Week of {r.weekOf}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: r.status === "approved" ? "#22c55e" : "#eab308" }}>{r.status.toUpperCase()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#080c14", color: "#e8edf5", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid #1c2640", display: "flex", justifyContent: "space-between" }}>
        <div><div style={{ fontWeight: 700 }}>{emp.name}</div><div style={{ fontSize: 10, color: "#5a6b85" }}>{emp.project}</div></div>
        <button onClick={() => setRole(null)} style={{ background: "none", border: "none", color: "#5a6b85", cursor: "pointer" }}>Logout</button>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #1c2640" }}>
        <button onClick={() => setCtab("attendance")} style={{ flex: 1, padding: 12, background: "none", border: "none", color: ctab === "attendance" ? "#6366f1" : "#5a6b85", borderBottom: ctab === "attendance" ? "2px solid #6366f1" : "none", cursor: "pointer" }}>Attendance</button>
        <button onClick={() => setCtab("report")} style={{ flex: 1, padding: 12, background: "none", border: "none", color: ctab === "report" ? "#6366f1" : "#5a6b85", borderBottom: ctab === "report" ? "2px solid #6366f1" : "none", cursor: "pointer" }}>Reports</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>{ctab === "attendance" ? <CandAttendance /> : <CandReport />}</div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#22c55e", color: "#fff", padding: "8px 20px", borderRadius: 20, fontSize: 12 }}>{toast.msg}</div>}
    </div>
  );
}

function OwnerPanel({ D, save, pushAlert, notify, setRole, toast }) {
  const [tab, setTab] = useState("Dashboard");
  const [proj, setProj] = useState("All");
  const [mo, setMo] = useState(monthKey());
  const [mdata, setMdata] = useState(null);
  const [modal, setModal] = useState(null);

  const E = D.employees || [];
  const FE = proj === "All" ? E : E.filter(e => e.project === proj);
  const hols = (D.holidays || []).map(h => h.date);

  /* ── Components ── */
  const Bt = ({ children, onClick, v = "p", s = {} }) => {
    const bg = v === "p" ? "#6366f1" : v === "d" ? "#ef444420" : "#1c2640";
    const cl = v === "p" ? "#fff" : v === "d" ? "#ef4444" : "#8899b4";
    return <button onClick={onClick} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: bg, color: cl, cursor: "pointer", fontSize: 12, fontWeight: 600, ...s }}>{children}</button>;
  };
  const Cd = ({ children, s = {} }) => <div style={{ background: "#0f1520", border: "1px solid #1c2640", borderRadius: 12, padding: 18, ...s }}>{children}</div>;
  const Mod = ({ title, children, onClose }) => (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0f1520", borderRadius: 14, padding: 24, width: 400, border: "1px solid #1c2640" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><h3>{title}</h3><button onClick={onClose} style={{ background: "none", border: "none", color: "#5a6b85", fontSize: 20, cursor: "pointer" }}>×</button></div>
        {children}
      </div>
    </div>
  );

  const rDash = () => (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <Cd s={{ flex: 1 }}><div>Team</div><div style={{ fontSize: 24, fontWeight: 700 }}>{E.length}</div></Cd>
        <Cd s={{ flex: 1 }}><div>Alerts</div><div style={{ fontSize: 24, fontWeight: 700, color: "#ef4444" }}>{(D.alerts || []).filter(a => !a.read).length}</div></Cd>
      </div>
      <Cd><h3>Project Activity</h3>{PROJECTS.map(p => <div key={p} style={{ marginBottom: 10 }}>{p}: {E.filter(e => e.project === p).length}</div>)}</Cd>
    </div>
  );

  const rPeople = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6 }}>{["All", ...PROJECTS].map(p => <Bt key={p} onClick={() => setProj(p)} v={proj === p ? "p" : "g"}>{p}</Bt>)}</div>
        <Bt onClick={() => setModal("add")}>+ Add</Bt>
      </div>
      {FE.map(e => (
        <Cd key={e.id} s={{ marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ fontWeight: 600 }}>{e.name}</div><div style={{ fontSize: 10, color: "#5a6b85" }}>Code: {e.code}</div></div>
          <Bt v="d" onClick={() => { if (window.confirm("Delete?")) save({ ...D, employees: E.filter(x => x.id !== e.id) }); }}>🗑</Bt>
        </Cd>
      ))}
      {modal === "add" && <Mod title="Add Person" onClose={() => setModal(null)}>
        <input id="en" placeholder="Name" style={inputStyle} />
        <input id="es" type="number" placeholder="Salary" style={{ ...inputStyle, marginTop: 10 }} />
        <button style={{ width: "100%", padding: 12, background: "#6366f1", border: "none", color: "#fff", marginTop: 20, borderRadius: 8 }} onClick={() => {
          const n = document.getElementById("en").value;
          const s = document.getElementById("es").value;
          if (n && s) { save({ ...D, employees: [...E, { id: uid(), name: n, salary: Number(s), project: PROJECTS[0], code: uid().slice(0, 4), joinDate: todayStr() }] }); setModal(null); }
        }}>Create</button>
      </Mod>}
    </div>
  );

  const rAtt = () => {
    const ws = getWeekStart();
    const [y, m] = mo.split("-").map(Number);
    const dim = new Date(y, m, 0).getDate();
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 12, color: "#5a6b85", textTransform: "uppercase", marginBottom: 10 }}>Weekly Timesheet Verification</h4>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 10 }}>
            {E.map(e => {
              const app = D.attendanceApprovals?.[`${e.id}_${ws}`];
              return (
                <div key={e.id} style={{ background: "#1c264050", padding: 12, borderRadius: 10, minWidth: 150 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                  <button onClick={() => save({ ...D, attendanceApprovals: { ...D.attendanceApprovals, [`${e.id}_${ws}`]: !app } })} style={{ width: "100%", padding: 6, borderRadius: 6, border: "none", background: app ? "#22c55e" : "#6366f1", color: "#fff", marginTop: 8, fontSize: 11, cursor: "pointer" }}>{app ? "✅ Verified" : "Verify"}</button>
                </div>
              );
            })}
          </div>
        </div>
        <table style={{ width: "100%", fontSize: 12 }}>
          <thead><tr><th align="left">Name</th>{Array.from({ length: dim }).map((_, i) => <th key={i}>{i + 1}</th>)}</tr></thead>
          <tbody>{FE.map(e => <tr key={e.id}><td>{e.name}</td>{Array.from({ length: dim }).map((_, i) => { const d = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`; const v = D.attendance[`${e.id}_${d}`]; return <td key={i} align="center" style={{ color: SC[v] }}>{v ? SL[v] : "·"}</td>; })}</tr>)}</tbody>
        </table>
      </div>
    );
  };

  const rRpt = () => {
    const rr = D.reports || [];
    const setStatus = (id, s) => save({ ...D, reports: rr.map(r => r.id === id ? { ...r, status: s } : r) });
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {rr.map(r => {
          const e = E.find(x => x.id === r.empId);
          return (
            <Cd key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><b>{e?.name}</b> <span style={{ color: r.status === "approved" ? "#22c55e" : "#eab308" }}>{r.status}</span></div>
              <p style={{ fontSize: 12, color: "#8899b4" }}>{r.summary}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                {r.status === "pending" && <><Bt onClick={() => setStatus(r.id, "approved")}>Approve</Bt><Bt v="d" onClick={() => setStatus(r.id, "rejected")}>Reject</Bt></>}
                {r.status !== "pending" && <Bt v="g" onClick={() => setStatus(r.id, "pending")}>Reset</Bt>}
              </div>
            </Cd>
          );
        })}
      </div>
    );
  };

  const rPay = () => (
    <div>
      <input type="month" value={mo} onChange={e => setMo(e.target.value)} style={inputStyle} />
      <div style={{ marginTop: 20 }}>
        {FE.map(e => {
          const s = calcPay(e, mo, D, hols);
          return (
            <Cd key={e.id} s={{ marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
              <div><b>{e.name}</b><div style={{ fontSize: 10 }}>{s.approvedWeeksCount}/{s.totalWeeksCount} weeks</div></div>
              <div style={{ textAlign: "right" }}><div style={{ color: "#22c55e", fontWeight: 700 }}>{fmt(s.approvedNet)}</div><div style={{ fontSize: 10, color: "#5a6b85" }}>Pot: {fmt(s.net)}</div></div>
            </Cd>
          );
        })}
      </div>
    </div>
  );

  const tabs = { Dashboard: rDash, People: rPeople, Attendance: rAtt, Reports: rRpt, Payroll: rPay };
  return (
    <div style={{ display: "flex", height: "100vh", background: "#080c14", color: "#e8edf5", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ width: 220, background: "#0f1520", borderRight: "1px solid #1c2640", padding: 20 }}>
        <h2 style={{ marginBottom: 24 }}>ProjectHub</h2>
        {Object.keys(tabs).map(t => <button key={t} onClick={() => setTab(t)} style={{ width: "100%", padding: 12, textAlign: "left", background: tab === t ? "#6366f120" : "none", border: "none", color: tab === t ? "#6366f1" : "#5a6b85", borderRadius: 8, cursor: "pointer", marginBottom: 4, fontWeight: tab === t ? 600 : 400 }}>{t}</button>)}
        <button onClick={() => setRole(null)} style={{ marginTop: 40, color: "#5a6b85", background: "none", border: "none", cursor: "pointer" }}>Logout</button>
      </div>
      <div style={{ flex: 1, padding: 32, overflow: "auto" }}>
        <h2 style={{ marginBottom: 24 }}>{tab}</h2>
        {tabs[tab]()}
      </div>
    </div>
  );
}

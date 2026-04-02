import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList
} from "recharts";
import {
  Zap, LayoutGrid, Download, Upload,
  Pencil, Trash2, Plus, BarChart2,
  Table, AlertCircle, Check
} from "lucide-react";

// ============================================================
//  GOOGLE SHEETS INTEGRATION STRATEGY
// ============================================================
// To connect this app to Google Sheets as a backend:
//
// 1. Create a Google Sheet with columns:
//    id | year | month | householdState | householdConsumption |
//    carState | carConsumption | bojlerConsumption | totalConsumption
//
// 2. Go to Extensions → Apps Script and paste:
//
//    function doGet(e) {
//      const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
//      const rows = sheet.getDataRange().getValues();
//      const headers = rows[0];
//      const data = rows.slice(1).map(row =>
//        Object.fromEntries(headers.map((h, i) => [h, row[i]]))
//      );
//      return ContentService
//        .createTextOutput(JSON.stringify({ records: data }))
//        .setMimeType(ContentService.MimeType.JSON);
//    }
//
//    function doPost(e) {
//      const payload = JSON.parse(e.postData.contents);
//      const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
//      const headers = ['id','year','month','householdState','householdConsumption',
//                       'carState','carConsumption','bojlerConsumption','totalConsumption'];
//      sheet.clearContents();
//      sheet.appendRow(headers);
//      payload.records.forEach(r => sheet.appendRow(headers.map(h => r[h] ?? '')));
//      return ContentService
//        .createTextOutput(JSON.stringify({ success: true }))
//        .setMimeType(ContentService.MimeType.JSON);
//    }
//
// 3. Deploy as Web App: Execute as "Me", Access "Anyone"
// 4. Paste the deployment URL in SHEETS_API_URL below.
// ============================================================

const SHEETS_API_URL = "https://script.google.com/macros/s/AKfycbxy6qwrJDuS4vIyEize75N7QxmOOhby6krxajifURsrpuYEkJbAtnmtYT-bUPSQTAdbnw/exec";
const SHEETS_TOKEN  = "elektro-tajny-token-2024"; // ← stejná hodnota jako SECRET v Apps Scriptu

// ─── Navy-blue dark-mode palette ─────────────────────────────
// Injected as CSS custom properties so inline styles stay DRY
const CSS_VARS = `
  :root {
    --nb-page:    #05101e;
    --nb-card:    #091626;
    --nb-input:   #061120;
    --nb-hover:   #0f2038;
    --nb-border:  #15284a;
    --nb-border2: #1c3560;
    --nb-txt1:    #dce9f8;
    --nb-txt2:    #7fa3c8;
    --nb-txt3:    #3f6080;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
  input[type=number]::-moz-number-spin-box { opacity: 0.3; }
  select option { background: #061120; color: #dce9f8; }
`;

// ─── Constants ───────────────────────────────────────────────
const MONTHS_CZ = [
  "Leden","Únor","Březen","Duben","Květen","Červen",
  "Červenec","Srpen","Září","Říjen","Listopad","Prosinec"
];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];
const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Calculation helpers ──────────────────────────────────────
function getPreviousReading(records, year, month, stateField, excludeId = null) {
  const sorted = [...records]
    .filter(r => r.id !== excludeId)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  const prev = sorted.filter(r =>
    r.year < year || (r.year === year && r.month < month)
  );
  return prev.length > 0 ? prev[prev.length - 1][stateField] : null;
}

function calcConsumption(currentState, prevState) {
  if (prevState == null || currentState == null || currentState === "") return 0;
  return Math.max(0, Number(currentState) - Number(prevState));
}

// ─── useDataStore hook ────────────────────────────────────────
function useDataStore() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(null);

  useEffect(() => {
    (async () => {
      if (SHEETS_API_URL) {
        try {
          const json = await fetch(SHEETS_API_URL + "?token=" + SHEETS_TOKEN).then(r => r.json());
          setRecords(json.records || []);
        } catch (err) {
          setSyncError("Sheets nedostupné: " + err.message);
          const s = localStorage.getItem("electricity_records");
          if (s) setRecords(JSON.parse(s));
        }
      } else {
        const s = localStorage.getItem("electricity_records");
        if (s) setRecords(JSON.parse(s));
      }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (recs) => {
    localStorage.setItem("electricity_records", JSON.stringify(recs));
    if (SHEETS_API_URL) {
      try { await fetch(SHEETS_API_URL, { method: "POST", body: JSON.stringify({ records: recs, token: SHEETS_TOKEN }) }); }
      catch { setSyncError("localStorage OK, Sheets sync selhal."); }
    }
  }, []);

  const addRecord = useCallback(async (fd) => {
    const year = Number(fd.year), month = Number(fd.month);
    const existing = records.find(r => r.year === year && r.month === month);

    if (existing) {
      const hState = fd.householdState !== "" ? fd.householdState : existing.householdState;
      const cState = fd.carState !== "" ? fd.carState : existing.carState;
      const bojler = fd.bojlerConsumption !== "" ? fd.bojlerConsumption : existing.bojlerConsumption;
      const prevH = getPreviousReading(records, year, month, "householdState", existing.id);
      const prevC = getPreviousReading(records, year, month, "carState", existing.id);
      const hC = fd.householdConsumptionOverride != null ? Number(fd.householdConsumptionOverride) : calcConsumption(hState, prevH);
      const cC = fd.carConsumptionOverride != null ? Number(fd.carConsumptionOverride) : calcConsumption(cState, prevC);
      const updated = records.map(r => r.id !== existing.id ? r : {
        ...r, householdState: Number(hState)||0, householdConsumption: hC,
        carState: Number(cState)||0, carConsumption: cC,
        bojlerConsumption: Number(bojler)||0, totalConsumption: hC + cC + (Number(bojler)||0),
      });
      setRecords(updated); await persist(updated);
      return { record: updated.find(r => r.id === existing.id), merged: true };
    }

    const prevH = getPreviousReading(records, year, month, "householdState");
    const prevC = getPreviousReading(records, year, month, "carState");
    const hC = fd.householdConsumptionOverride != null ? Number(fd.householdConsumptionOverride) : calcConsumption(fd.householdState, prevH);
    const cC = fd.carConsumptionOverride != null ? Number(fd.carConsumptionOverride) : calcConsumption(fd.carState, prevC);
    const rec = {
      id: genId(), year, month,
      householdState: Number(fd.householdState)||0, householdConsumption: hC,
      carState: Number(fd.carState)||0, carConsumption: cC,
      bojlerConsumption: Number(fd.bojlerConsumption)||0, totalConsumption: hC + cC + (Number(fd.bojlerConsumption)||0),
    };
    const updated = [...records, rec];
    setRecords(updated); await persist(updated);
    return rec;
  }, [records, persist]);

  const updateRecord = useCallback(async (id, fd) => {
    const prevH = getPreviousReading(records, fd.year, fd.month, "householdState", id);
    const prevC = getPreviousReading(records, fd.year, fd.month, "carState", id);
    const hC = fd.householdConsumptionOverride != null ? Number(fd.householdConsumptionOverride) : calcConsumption(fd.householdState, prevH);
    const cC = fd.carConsumptionOverride != null ? Number(fd.carConsumptionOverride) : calcConsumption(fd.carState, prevC);
    const updated = records.map(r => r.id !== id ? r : {
      ...r, year: Number(fd.year), month: Number(fd.month),
      householdState: Number(fd.householdState)||0, householdConsumption: hC,
      carState: Number(fd.carState)||0, carConsumption: cC,
      bojlerConsumption: Number(fd.bojlerConsumption)||0, totalConsumption: hC + cC + (Number(fd.bojlerConsumption)||0),
    });
    setRecords(updated); await persist(updated);
  }, [records, persist]);

  const deleteRecord = useCallback(async (id) => {
    const updated = records.filter(r => r.id !== id);
    setRecords(updated); await persist(updated);
  }, [records, persist]);

  const importData = useCallback(async (data) => { setRecords(data); await persist(data); }, [persist]);
  const exportData = useCallback(() => JSON.stringify(records, null, 2), [records]);

  return { records, loading, syncError, addRecord, updateRecord, deleteRecord, importData, exportData };
}

// ─── Sort ascending by year/month ────────────────────────────
const sortAsc = recs => [...recs].sort((a,b) => a.year !== b.year ? a.year-b.year : a.month-b.month);

// ─── Chart data helpers ───────────────────────────────────────
function prepareAnnualData(records) {
  const map = {};
  records.forEach(r => {
    if (!map[r.year]) map[r.year] = { year: String(r.year), household:0, car:0, bojler:0, total:0 };
    
    // Parse values to ensure they're numbers
    const h = Number(r.householdConsumption) || 0;
    const c = Number(r.carConsumption) || 0;
    const b = Number(r.bojlerConsumption) || 0;
    
    map[r.year].household += h;
    map[r.year].car       += c;
    map[r.year].bojler    += b;
    map[r.year].total     += h + c + b;
  });
  
  // Debug log for year 2026
  if (map[2026]) {
    console.log('🔍 DEBUG - Roční graf 2026:', {
      household: Math.round(map[2026].household),
      car: Math.round(map[2026].car),
      bojler: Math.round(map[2026].bojler),
      total: Math.round(map[2026].total)
    });
  }
  
  return Object.values(map).sort((a,b) => Number(a.year)-Number(b.year));
}

function prepareMonthly(records, field) {
  const years = [...new Set(records.map(r => r.year))].sort().slice(-2);
  return MONTHS_CZ.map((name, i) => {
    const row = { month: name.slice(0, 3) };
    years.forEach(y => {
      const f = records.find(r => r.year===y && r.month===i+1);
      row[String(y)] = f ? (f[field]??0) : undefined;
    });
    return row;
  });
}

const LINE_COLORS = ["#38bdf8","#34d399","#fb923c","#a78bfa"];

// ─── Themed helpers ───────────────────────────────────────────
// Returns an inline style object based on dark/light token
const D = {
  page:    d => ({ background: d ? "var(--nb-page)"   : "#f8fafc" }),
  card:    d => ({ background: d ? "var(--nb-card)"   : "#ffffff", border: `1px solid ${d ? "var(--nb-border)" : "#e2e8f0"}` }),
  inner:   d => ({ background: d ? "var(--nb-input)"  : "#f8fafc", border: `1px solid ${d ? "var(--nb-border)" : "#e2e8f0"}` }),
  hover:   d => ({ background: d ? "var(--nb-hover)"  : "#f1f5f9" }),
  txt1:    d => ({ color: d ? "var(--nb-txt1)" : "#1e293b" }),
  txt2:    d => ({ color: d ? "var(--nb-txt2)" : "#64748b" }),
  txt3:    d => ({ color: d ? "var(--nb-txt3)" : "#94a3b8" }),
  divider: d => ({ borderColor: d ? "var(--nb-border)" : "#f1f5f9" }),
};

// ─── CustomTooltip ────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, dark }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...D.card(dark), padding:"12px 14px", borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}>
      <p style={{ ...D.txt1(dark), fontWeight:600, marginBottom:6, fontSize:13 }}>{label}</p>
      {payload.map((p,i) => (
        <div key={i} style={{ color:p.color, display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:p.color, display:"inline-block" }} />
          {p.name}: <strong>{p.value?.toFixed(1)} kWh</strong>
        </div>
      ))}
    </div>
  );
};

// ─── ChartCard ───────────────────────────────────────────────
function ChartCard({ title, dark, children, span2 }) {
  return (
    <div className={span2 ? "lg:col-span-2" : ""}>
      <div style={{ ...D.card(dark), borderRadius:16, padding:"16px 20px" }}>
        <p style={{ ...D.txt3(dark), fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:14 }}>
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

// ─── ChartsView ───────────────────────────────────────────────
function ChartsView({ records, dark }) {
  const annual   = useMemo(() => prepareAnnualData(records), [records]);
  const bojler   = useMemo(() => prepareMonthly(records, "bojlerConsumption"), [records]);
  const house    = useMemo(() => prepareMonthly(records, "householdConsumption"), [records]);
  const car      = useMemo(() => prepareMonthly(records, "carConsumption"), [records]);
  const years2   = useMemo(() => [...new Set(records.map(r=>r.year))].sort().slice(-2).map(String), [records]);

  // Year filter for debug card
  const allYearsInData = useMemo(() => [...new Set(records.map(r => r.year))].sort((a,b) => b-a), [records]);
  const [debugYear, setDebugYear] = useState(() => {
    const currentYear = new Date().getFullYear();
    return allYearsInData.includes(currentYear) ? currentYear : (allYearsInData[0] || currentYear);
  });

  // Auto-update debug year when new year starts
  useEffect(() => {
    const currentYear = new Date().getFullYear();
    if (currentYear !== debugYear && allYearsInData.includes(currentYear)) {
      setDebugYear(currentYear);
    }
  }, [allYearsInData, debugYear]);

  const ax = dark ? "#3f6080" : "#94a3b8";
  const gr = dark ? "#15284a" : "#f1f5f9";
  const H  = 220;

  const Lines = ({ data }) => (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={data} margin={{ top:4, right:8, left:-14, bottom:2 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gr} />
        <XAxis dataKey="month" tick={{ fill:ax, fontSize:11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill:ax, fontSize:10 }} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={<CustomTooltip dark={dark} />} />
        <Legend wrapperStyle={{ fontSize:12, color: dark?"#7fa3c8":"#64748b" }} />
        {years2.map((y,i) => (
          <Line key={y} type="monotone" dataKey={y} name={y} stroke={LINE_COLORS[i]}
            strokeWidth={2.5} dot={{ r:3, fill:LINE_COLORS[i] }} activeDot={{ r:5 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );

  if (!records.length) return (
    <div style={{ ...D.card(dark), borderRadius:16, height:240, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
      <BarChart2 size={44} style={D.txt3(dark)} />
      <p style={D.txt2(dark)}>Nejsou k dispozici žádná data pro zobrazení grafů.</p>
    </div>
  );

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(1, 1fr)", gap:16 }} className="lg:grid-cols-2-custom">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Roční spotřeba celkem (kWh)" dark={dark}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={annual} margin={{ top:32, right:8, left:-14, bottom:2 }} barCategoryGap="20%" barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke={gr} vertical={false} />
              <XAxis dataKey="year" tick={{ fill:ax, fontSize:12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:ax, fontSize:10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<CustomTooltip dark={dark} />} />
              <Legend wrapperStyle={{ fontSize:12, color: dark?"#7fa3c8":"#64748b" }} />
              <Bar dataKey="household" name="Domácnost" fill="#38bdf8" radius={[4,4,0,0]} />
              <Bar dataKey="car" name="Auto" fill="#34d399" radius={[4,4,0,0]} />
              <Bar dataKey="bojler" name="Bojler" fill="#fb923c" radius={[4,4,0,0]}>
                {/* Total sum above entire group */}
                <LabelList dataKey="total" position="top"
                  style={{ fill: dark?"#dce9f8":"#1e293b", fontSize:13, fontWeight:800 }}
                  formatter={v => v > 0 ? Math.round(v) : ""}
                  offset={8}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Debug: Show breakdown for selected year */}
        <ChartCard title={`🔍 Kontrola součtů (${debugYear})`} dark={dark}>
          <div style={{ fontSize:12, ...D.txt2(dark) }}>
            {/* Year filter buttons */}
            {allYearsInData.length > 1 && (
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                {allYearsInData.map(y => (
                  <button key={y} onClick={() => setDebugYear(y)} style={{
                    padding:"4px 12px", borderRadius:999, fontSize:11, fontWeight:700,
                    border:"none", cursor:"pointer", transition:"all 0.15s",
                    background: debugYear === y ? "#0ea5e9" : dark ? "var(--nb-hover)" : "#f1f5f9",
                    color: debugYear === y ? "#fff" : dark ? "var(--nb-txt2)" : "#64748b",
                    boxShadow: debugYear === y ? "0 2px 8px rgba(14,165,233,0.3)" : "none",
                  }}>
                    {y}
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const yearRecords = records.filter(r => r.year === debugYear).sort((a,b) => a.month - b.month);
              if (yearRecords.length === 0) return <p>Žádná data pro rok {debugYear}</p>;
              
              const sumH = yearRecords.reduce((s,r) => s + (r.householdConsumption||0), 0);
              const sumC = yearRecords.reduce((s,r) => s + (r.carConsumption||0), 0);
              const sumB = yearRecords.reduce((s,r) => s + (r.bojlerConsumption||0), 0);
              
              return (
                <div>
                  <div style={{ marginBottom:12, padding:8, background: dark?"var(--nb-input)":"#f8fafc", borderRadius:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span>🏠 Domácnost:</span>
                      <strong style={D.txt1(dark)}>{Math.round(sumH)} kWh</strong>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ color:"#34d399" }}>🚗 Auto:</span>
                      <strong style={{ color:"#34d399" }}>{Math.round(sumC)} kWh</strong>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span>🛁 Bojler:</span>
                      <strong style={D.txt1(dark)}>{Math.round(sumB)} kWh</strong>
                    </div>
                    <div style={{ borderTop:`1px solid ${dark?"var(--nb-border)":"#e2e8f0"}`, paddingTop:8, marginTop:8, display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontWeight:700 }}>∑ Celkem:</span>
                      <strong style={D.txt1(dark)}>{Math.round(sumH + sumC + sumB)} kWh</strong>
                    </div>
                  </div>

                  <div style={{ maxHeight:140, overflowY:"auto", fontSize:11 }}>
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead style={{ position:"sticky", top:0, background: dark?"var(--nb-card)":"#fff" }}>
                        <tr style={{ borderBottom:`1px solid ${dark?"var(--nb-border)":"#e2e8f0"}` }}>
                          <th style={{ textAlign:"left", padding:"4px 0", ...D.txt3(dark) }}>Měsíc</th>
                          <th style={{ textAlign:"right", padding:"4px 0", ...D.txt3(dark) }}>🏠</th>
                          <th style={{ textAlign:"right", padding:"4px 0", color:"#34d399" }}>🚗</th>
                          <th style={{ textAlign:"right", padding:"4px 0", ...D.txt3(dark) }}>🛁</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yearRecords.map(r => (
                          <tr key={r.id} style={{ borderBottom:`1px solid ${dark?"var(--nb-border)":"#f8fafc"}` }}>
                            <td style={{ padding:"4px 0", ...D.txt2(dark) }}>{MONTHS_CZ[r.month-1]}</td>
                            <td style={{ textAlign:"right", padding:"4px 0", ...D.txt1(dark) }}>{r.householdConsumption||0}</td>
                            <td style={{ textAlign:"right", padding:"4px 0", color:"#34d399", fontWeight: (r.carConsumption||0) > 100 ? 700 : 400 }}>
                              {r.carConsumption||0}
                            </td>
                            <td style={{ textAlign:"right", padding:"4px 0", ...D.txt1(dark) }}>{r.bojlerConsumption||0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </ChartCard>

        <ChartCard title="Bojler – porovnání měsíců" dark={dark}><Lines data={bojler} /></ChartCard>
        <ChartCard title="Domácnost – porovnání měsíců" dark={dark}><Lines data={house} /></ChartCard>
        <ChartCard title="Auto – porovnání měsíců" dark={dark} span2><Lines data={car} /></ChartCard>
      </div>
    </div>
  );
}

// ─── InputForm ────────────────────────────────────────────────
const BLANK = () => ({
  year: CURRENT_YEAR, month: new Date().getMonth() + 1,
  householdState: "", householdConsumptionOverride: null,
  carState: "", carConsumptionOverride: null,
  bojlerConsumption: "",
});

function InputForm({ records, onSave, editRecord, onCancelEdit, dark }) {
  const [form, setForm] = useState(BLANK());
  const [override, setOverride] = useState({ household: false, car: false });
  const [preview, setPreview] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    if (editRecord) {
      setForm({ year:editRecord.year, month:editRecord.month,
        householdState:editRecord.householdState, householdConsumptionOverride:null,
        carState:editRecord.carState, carConsumptionOverride:null,
        bojlerConsumption:editRecord.bojlerConsumption });
      setOverride({ household:false, car:false });
    } else { setForm(BLANK()); setOverride({ household:false, car:false }); }
  }, [editRecord]);

  useEffect(() => {
    const pH = getPreviousReading(records, form.year, form.month, "householdState", editRecord?.id);
    const pC = getPreviousReading(records, form.year, form.month, "carState", editRecord?.id);
    setPreview({
      prevH: pH, prevC: pC,
      household: form.householdConsumptionOverride != null ? Number(form.householdConsumptionOverride) : calcConsumption(form.householdState, pH),
      car: form.carConsumptionOverride != null ? Number(form.carConsumptionOverride) : calcConsumption(form.carState, pC),
    });
  }, [form, records, editRecord]);

  const set = (k,v) => setForm(f => ({ ...f, [k]:v }));

  const handleSave = async () => {
    if (!form.householdState && !form.carState && !form.bojlerConsumption) return;
    const res = await onSave(form);
    setForm(BLANK()); setOverride({ household:false, car:false });
    setSaved(res?.merged ? "merged" : "saved");
    setTimeout(() => setSaved(null), 2500);
  };

  // Input/select common styles — inline for reliable dark-mode text rendering
  const inp = (extra = {}) => ({
    width:"100%", padding:"10px 12px", borderRadius:10, fontSize:14, outline:"none",
    transition:"border-color 0.15s",
    ...(dark ? {
      background:"var(--nb-input)",
      border:"1px solid var(--nb-border2)",
      color:"var(--nb-txt1)",
    } : {
      background:"#fff",
      border:"1px solid #e2e8f0",
      color:"#1e293b",
    }),
    ...extra,
  });

  const LBL = ({ children }) => (
    <label style={{ display:"block", fontSize:11, fontWeight:700, textTransform:"uppercase",
      letterSpacing:"0.08em", marginBottom:6, color: dark?"var(--nb-txt2)":"#64748b" }}>
      {children}
    </label>
  );

  const isMerge = !editRecord && records.some(r => r.year===form.year && r.month===form.month);

  return (
    <div style={{ ...D.card(dark), borderRadius:18, padding:"20px 20px 20px", marginBottom:16 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16 }}>
        <div>
          <h2 style={{ ...D.txt1(dark), margin:0, fontSize:15, fontWeight:700 }}>
            {editRecord ? "✏️ Upravit záznam" : "➕ Přidat / doplnit záznam"}
          </h2>
          {isMerge && (
            <p style={{ margin:"4px 0 0", fontSize:12, color:"#fbbf24" }}>
              ⚡ Záznam pro {MONTHS_CZ[form.month-1]} {form.year} existuje — data budou sloučena.
            </p>
          )}
        </div>
        {editRecord && (
          <button onClick={onCancelEdit} style={{
            fontSize:12, padding:"6px 12px", borderRadius:8, cursor:"pointer",
            background:"transparent", color: dark?"var(--nb-txt2)":"#64748b",
            border:`1px solid ${dark?"var(--nb-border2)":"#e2e8f0"}`,
          }}>Zrušit</button>
        )}
      </div>

      {/* Year / Month row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        <div>
          <LBL>Rok</LBL>
          <select style={inp({ cursor:"pointer" })} value={form.year} onChange={e=>set("year",Number(e.target.value))}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <LBL>Měsíc</LBL>
          <select style={inp({ cursor:"pointer" })} value={form.month} onChange={e=>set("month",Number(e.target.value))}>
            {MONTHS_CZ.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Category cards — single col on mobile, 3 col on md+ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" style={{ marginBottom:14 }}>
        {/* Household */}
        <div style={{ ...D.inner(dark), borderRadius:14, padding:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:20 }}>🏠</span>
            <span style={{ ...D.txt1(dark), fontWeight:600, fontSize:14 }}>Domácnost</span>
          </div>
          <LBL>Stav elektroměru</LBL>
          <input type="number" placeholder="" style={inp()} value={form.householdState} onChange={e=>set("householdState",e.target.value)} />
          {preview && (
            <p style={{ ...D.txt2(dark), fontSize:12, margin:"6px 0 0" }}>
              {preview.prevH != null ? `Předch.: ${preview.prevH} → ` : "Bez předch. → "}
              <span style={{ color:"#38bdf8", fontWeight:700 }}>
                {override.household && form.householdConsumptionOverride != null ? form.householdConsumptionOverride : preview.household} kWh
              </span>
            </p>
          )}
          <button style={{ ...D.txt3(dark), fontSize:12, background:"none", border:"none", cursor:"pointer", padding:"6px 0 2px", textDecoration:"underline" }}
            onClick={() => setOverride(o=>({ ...o, household:!o.household }))}>
            {override.household ? "Skrýt ruční přepis" : "Zadat spotřebu ručně"}
          </button>
          {override.household && (
            <input type="number" placeholder="" style={{ ...inp(), marginTop:8 }}
              value={form.householdConsumptionOverride??""} onChange={e=>set("householdConsumptionOverride", e.target.value!==""?e.target.value:null)} />
          )}
        </div>

        {/* Car */}
        <div style={{ ...D.inner(dark), borderRadius:14, padding:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:20 }}>🚗</span>
            <span style={{ ...D.txt1(dark), fontWeight:600, fontSize:14 }}>Auto</span>
          </div>
          <LBL>Stav elektroměru</LBL>
          <input type="number" placeholder="" style={inp()} value={form.carState} onChange={e=>set("carState",e.target.value)} />
          {preview && (
            <p style={{ ...D.txt2(dark), fontSize:12, margin:"6px 0 0" }}>
              {preview.prevC != null ? `Předch.: ${preview.prevC} → ` : "Bez předch. → "}
              <span style={{ color:"#34d399", fontWeight:700 }}>
                {override.car && form.carConsumptionOverride != null ? form.carConsumptionOverride : preview.car} kWh
              </span>
            </p>
          )}
          <button style={{ ...D.txt3(dark), fontSize:12, background:"none", border:"none", cursor:"pointer", padding:"6px 0 2px", textDecoration:"underline" }}
            onClick={() => setOverride(o=>({ ...o, car:!o.car }))}>
            {override.car ? "Skrýt ruční přepis" : "Zadat spotřebu ručně"}
          </button>
          {override.car && (
            <input type="number" placeholder="" style={{ ...inp(), marginTop:8 }}
              value={form.carConsumptionOverride??""} onChange={e=>set("carConsumptionOverride", e.target.value!==""?e.target.value:null)} />
          )}
        </div>

        {/* Bojler */}
        <div style={{ ...D.inner(dark), borderRadius:14, padding:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:20 }}>🛁</span>
            <span style={{ ...D.txt1(dark), fontWeight:600, fontSize:14 }}>Bojler</span>
          </div>
          <LBL>Spotřeba (kWh)</LBL>
          <input type="number" placeholder="" style={inp()} value={form.bojlerConsumption} onChange={e=>set("bojlerConsumption",e.target.value)} />
          <p style={{ ...D.txt3(dark), fontSize:12, margin:"8px 0 0" }}>Přímý vstup spotřeby</p>
        </div>
      </div>

      {/* Preview strip */}
      {preview && (
        <div style={{ ...D.inner(dark), borderRadius:12, padding:"10px 16px", marginBottom:16,
          display:"flex", flexWrap:"wrap", alignItems:"center", gap:16, fontSize:13 }}>
          <span style={D.txt2(dark)}>Náhled:</span>
          <span style={{ color:"#38bdf8", fontWeight:600 }}>🏠 {preview.household} kWh</span>
          <span style={{ color:"#34d399", fontWeight:600 }}>🚗 {preview.car} kWh</span>
          <span style={{ color:"#fb923c", fontWeight:600 }}>🛁 {form.bojlerConsumption||0} kWh</span>
          <span style={{ ...D.txt1(dark), fontWeight:700 }}>∑ {preview.household+preview.car} kWh</span>
        </div>
      )}

      {/* Save button — full width on mobile */}
      <button onClick={handleSave} style={{
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        padding:"11px 24px", borderRadius:12, border:"none", cursor:"pointer",
        fontWeight:700, fontSize:14, width:"100%", maxWidth:220,
        background: saved==="merged" ? "#f59e0b" : saved==="saved" ? "#10b981" : "#0ea5e9",
        color:"#fff", boxShadow: saved ? "none" : "0 4px 16px rgba(14,165,233,0.3)",
        transition:"background 0.2s",
      }}>
        {saved==="merged" ? <><Check size={16}/>Sloučeno!</>
         :saved==="saved"  ? <><Check size={16}/>Uloženo!</>
         :editRecord       ? <><Check size={16}/>Uložit změny</>
         :                   <><Plus  size={16}/>Uložit záznam</>}
      </button>
    </div>
  );
}

// ─── DataTable ────────────────────────────────────────────────
function DataTable({ records, onEdit, onDelete, dark }) {
  const allYears = useMemo(() =>
    [...new Set(records.map(r => r.year))].sort((a,b) => a-b), [records]);
  const [activeYear, setActiveYear] = useState(null); // null = všechny roky

  // Pokud přibude nový rok a žádný není aktivní, nechej "Vše" aktivní
  const filtered = useMemo(() =>
    activeYear === null ? sortAsc(records) : sortAsc(records.filter(r => r.year === activeYear)),
    [records, activeYear]
  );

  const [confirmDelete, setConfirmDelete] = useState(null);
  const editAndScroll = (r) => { onEdit(r); window.scrollTo({ top:0, behavior:"smooth" }); };

  const TH = ({ children, right, sticky, dark: thDark }) => (
    <th style={{
      textAlign: right ? "right" : "left",
      padding:"11px 14px", fontSize:11,
      fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em",
      color: dark?"var(--nb-txt3)":"#94a3b8",
      whiteSpace:"nowrap",
      borderBottom:`2px solid ${dark?"var(--nb-border2)":"#e2e8f0"}`,
      ...(sticky ? {
        position:"sticky", top:0, zIndex:2,
        background: dark?"var(--nb-card)":"#fff",
      } : {}),
    }}>{children}</th>
  );

  const TD = ({ children, right, style }) => (
    <td style={{ padding:"10px 14px", fontSize:13, textAlign: right?"right":"left", verticalAlign:"middle", ...style }}>
      {children}
    </td>
  );

  // Součty za filtrované záznamy
  const totH = filtered.reduce((s,r) => s + (r.householdConsumption||0), 0);
  const totC = filtered.reduce((s,r) => s + (r.carConsumption||0), 0);
  const totB = filtered.reduce((s,r) => s + (r.bojlerConsumption||0), 0);
  const totT = filtered.reduce((s,r) => s + (r.totalConsumption||0), 0);

  if (!records.length) return (
    <div style={{ ...D.card(dark), borderRadius:18, padding:40, textAlign:"center" }}>
      <Table size={40} style={{ ...D.txt3(dark), display:"block", margin:"0 auto 12px" }} />
      <p style={D.txt2(dark)}>Zatím nejsou přidána žádná data.</p>
    </div>
  );

  return (
    <div style={{ ...D.card(dark), borderRadius:18 }}>

      {/* ── Přepínače roků ── */}
      <div style={{
        display:"flex", alignItems:"center", flexWrap:"wrap", gap:6,
        padding:"12px 16px",
        borderBottom:`1px solid ${dark?"var(--nb-border)":"#f1f5f9"}`,
        borderRadius:"18px 18px 0 0",
      }}>
        {[null, ...allYears].map(y => {
          const isActive = activeYear === y;
          return (
            <button key={y ?? "all"} onClick={() => setActiveYear(y)} style={{
              padding:"5px 14px", borderRadius:999, fontSize:12, fontWeight:700,
              border:"none", cursor:"pointer", transition:"all 0.15s",
              background: isActive ? "#0ea5e9" : dark ? "var(--nb-hover)" : "#f1f5f9",
              color: isActive ? "#fff" : dark ? "var(--nb-txt2)" : "#64748b",
              boxShadow: isActive ? "0 2px 10px rgba(14,165,233,0.35)" : "none",
            }}>
              {y === null ? "Vše" : y}
            </button>
          );
        })}

        {/* Součty vpravo */}
        <div style={{ marginLeft:"auto", display:"flex", flexWrap:"wrap", gap:"4px 16px", fontSize:12 }}>
          <span style={{ color:"#38bdf8", fontWeight:700 }}>🏠 {Math.round(totH)} kWh</span>
          <span style={{ color:"#34d399", fontWeight:700 }}>🚗 {Math.round(totC)} kWh</span>
          <span style={{ color:"#fb923c", fontWeight:700 }}>🛁 {Math.round(totB)} kWh</span>
          <span style={{ ...D.txt1(dark), fontWeight:800 }}>∑ {Math.round(totT)} kWh</span>
        </div>
      </div>

      {/* ── Tabulka s limitem výšky při "Vše" ── */}
      <div style={{
        overflowX:"auto",
        overflowY: activeYear === null ? "auto" : "visible",
        maxHeight: activeYear === null ? "576px" : "none",
        WebkitOverflowScrolling:"touch",
        borderRadius:"0 0 18px 18px",
      }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:560 }}>
          <thead>
            <tr>
              <TH sticky={activeYear === null} dark={dark}>Datum</TH>
              <TH sticky={activeYear === null} dark={dark}>🏠 Stav</TH>
              <TH sticky={activeYear === null} dark={dark} right>Dom. kWh</TH>
              <TH sticky={activeYear === null} dark={dark}>🚗 Stav</TH>
              <TH sticky={activeYear === null} dark={dark} right>Auto kWh</TH>
              <TH sticky={activeYear === null} dark={dark} right>🛁 Bojler</TH>
              <TH sticky={activeYear === null} dark={dark} right>∑ Celkem</TH>
              <TH sticky={activeYear === null} dark={dark}></TH>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding:"32px 16px", textAlign:"center", ...D.txt2(dark) }}>
                  Žádné záznamy pro rok {activeYear}.
                </td>
              </tr>
            ) : filtered.map(r => (
              <tr key={r.id}
                style={{ borderBottom:`1px solid ${dark?"var(--nb-border)":"#f8fafc"}`, transition:"background 0.12s" }}
                onMouseEnter={e => e.currentTarget.style.background = dark?"var(--nb-hover)":"#f8fafc"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>

                <TD>
                  <div style={{ display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap" }}>
                    <span style={{ background: dark?"#0f2038":"#eff6ff", color: dark?"#38bdf8":"#2563eb",
                      fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:999 }}>{r.year}</span>
                    <span style={{ ...D.txt1(dark), fontWeight:600 }}>{MONTHS_CZ[r.month-1]}</span>
                  </div>
                </TD>
                <TD><span style={D.txt3(dark)}>{r.householdState}</span></TD>
                <TD right><span style={{ color:"#38bdf8", fontWeight:700 }}>{r.householdConsumption}</span></TD>
                <TD><span style={D.txt3(dark)}>{r.carState}</span></TD>
                <TD right><span style={{ color:"#34d399", fontWeight:700 }}>{r.carConsumption}</span></TD>
                <TD right><span style={{ color:"#fb923c", fontWeight:700 }}>{r.bojlerConsumption}</span></TD>
                <TD right>
                  <span style={{
                    ...D.txt1(dark), fontWeight:800, fontSize:14,
                    background: dark?"#0f2038":"#eff6ff",
                    color: dark?"#7dd3fc":"#1d4ed8",
                    padding:"2px 10px", borderRadius:8, whiteSpace:"nowrap",
                  }}>{r.totalConsumption} kWh</span>
                </TD>
                <TD>
                  {confirmDelete===r.id ? (
                    <div style={{ display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap" }}>
                      <span style={{ color:"#f87171", fontSize:12 }}>Smazat?</span>
                      <button onClick={() => { onDelete(r.id); setConfirmDelete(null); }}
                        style={{ fontSize:12, padding:"3px 9px", borderRadius:7, background:"#ef4444",
                          color:"#fff", border:"none", cursor:"pointer", fontWeight:600 }}>Ano</button>
                      <button onClick={() => setConfirmDelete(null)}
                        style={{ fontSize:12, padding:"3px 9px", borderRadius:7, background:"transparent",
                          border:`1px solid ${dark?"var(--nb-border2)":"#e2e8f0"}`,
                          ...D.txt2(dark), cursor:"pointer" }}>Ne</button>
                    </div>
                  ) : (
                    <div style={{ display:"flex", gap:2 }}>
                      <button onClick={() => editAndScroll(r)} title="Upravit"
                        style={{ background:"none", border:"none", cursor:"pointer", padding:"5px 6px",
                          ...D.txt3(dark), borderRadius:7, transition:"color 0.12s" }}
                        onMouseEnter={e => e.currentTarget.style.color="#38bdf8"}
                        onMouseLeave={e => e.currentTarget.style.color=dark?"var(--nb-txt3)":"#94a3b8"}>
                        <Pencil size={14}/>
                      </button>
                      <button onClick={() => setConfirmDelete(r.id)} title="Smazat"
                        style={{ background:"none", border:"none", cursor:"pointer", padding:"5px 6px",
                          ...D.txt3(dark), borderRadius:7, transition:"color 0.12s" }}
                        onMouseEnter={e => e.currentTarget.style.color="#f87171"}
                        onMouseLeave={e => e.currentTarget.style.color=dark?"var(--nb-txt3)":"#94a3b8"}>
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  )}
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── WaffleMenu ───────────────────────────────────────────────
function WaffleMenu({ dark, onToggleDark, onExport, onImport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleExport = () => {
    const blob = new Blob([onExport()], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`spotreba_${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url); setOpen(false);
  };

  const handleImport = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { try { onImport(JSON.parse(ev.target.result)); setOpen(false); } catch { alert("Neplatný JSON."); } };
    reader.readAsText(file); e.target.value="";
  };

  const btnStyle = {
    display:"flex", alignItems:"center", gap:12, padding:"11px 16px", fontSize:14,
    width:"100%", textAlign:"left", background:"none", border:"none", cursor:"pointer",
    ...D.txt1(dark), transition:"background 0.15s",
  };

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(o=>!o)} style={{
        padding:8, borderRadius:12, border:"none", cursor:"pointer", display:"flex",
        background: open ? "#0ea5e9" : "transparent",
        color: open ? "#fff" : dark?"var(--nb-txt2)":"#64748b",
        transition:"all 0.15s",
      }}><LayoutGrid size={20}/></button>

      {open && (
        <div style={{ ...D.card(dark), position:"absolute", right:0, top:"calc(100% + 8px)",
          width:240, borderRadius:16, overflow:"hidden", zIndex:50,
          boxShadow:"0 16px 48px rgba(0,0,0,0.4)" }}>
          {/* Toggle */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"12px 16px", borderBottom:`1px solid ${dark?"var(--nb-border)":"#f1f5f9"}` }}>
            <span style={{ ...D.txt1(dark), fontWeight:600, fontSize:14 }}>
              {dark ? "Tmavý režim" : "Světlý režim"}
            </span>
            <button onClick={() => { onToggleDark(); setOpen(false); }}
              style={{ position:"relative", width:44, height:24, borderRadius:999, border:"none", cursor:"pointer",
                background: dark?"#0ea5e9":"#e2e8f0", transition:"background 0.2s" }}>
              <span style={{ position:"absolute", top:3, left: dark?22:3, width:18, height:18,
                borderRadius:"50%", background:"#fff", transition:"left 0.2s",
                boxShadow:"0 2px 4px rgba(0,0,0,0.25)" }}/>
            </button>
          </div>
          <button style={btnStyle} onMouseEnter={e=>e.currentTarget.style.background=dark?"var(--nb-hover)":"#f8fafc"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"} onClick={handleExport}>
            <Download size={16} style={{ color:"#34d399" }}/> Exportovat data (JSON)
          </button>
          <button style={btnStyle} onMouseEnter={e=>e.currentTarget.style.background=dark?"var(--nb-hover)":"#f8fafc"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"} onClick={() => fileRef.current?.click()}>
            <Upload size={16} style={{ color:"#38bdf8" }}/> Importovat data (JSON)
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display:"none" }} onChange={handleImport}/>
          <div style={{ padding:"8px 16px", borderTop:`1px solid ${dark?"var(--nb-border)":"#f1f5f9"}` }}>
            <p style={{ ...D.txt3(dark), fontSize:11, margin:0 }}>
              {SHEETS_API_URL ? "✅ Google Sheets sync aktivní" : "💾 localStorage (offline)"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark] = useState(true);
  const [view, setView] = useState("data");
  const [editRecord, setEditRecord] = useState(null);
  const { records, loading, syncError, addRecord, updateRecord, deleteRecord, importData, exportData } = useDataStore();

  const handleSave = async (fd) => {
    if (editRecord) { await updateRecord(editRecord.id, fd); setEditRecord(null); return {}; }
    return await addRecord(fd) || {};
  };

  const NAV = [
    { id:"data",   icon:<Table size={21}/>,   label:"Data" },
    { id:"charts", icon:<BarChart2 size={21}/>, label:"Grafy" },
  ];

  return (
    <>
      <style>{CSS_VARS}</style>

      <div style={{ ...D.page(dark), minHeight:"100vh" }}>

        {/* ── Header ── */}
        <header style={{
          position:"sticky", top:0, zIndex:40,
          background: dark ? "rgba(5,16,30,0.9)" : "rgba(255,255,255,0.9)",
          borderBottom: `1px solid ${dark?"var(--nb-border)":"#e2e8f0"}`,
          backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)",
        }}>
          <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 16px",
            height:58, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>

            {/* Logo */}
            <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
              <div style={{ width:34, height:34, borderRadius:10, background:"#0ea5e9",
                display:"flex", alignItems:"center", justifyContent:"center",
                boxShadow:"0 4px 14px rgba(14,165,233,0.35)" }}>
                <Zap size={17} color="#fff"/>
              </div>
              <span style={{ ...D.txt1(dark), fontWeight:800, fontSize:16 }}>EnergyMonitor</span>
            </div>

            {/* Desktop nav */}
            <nav className="hidden sm:flex" style={{ gap:4 }}>
              {NAV.map(t => (
                <button key={t.id} onClick={() => setView(t.id)} style={{
                  display:"flex", alignItems:"center", gap:8, padding:"7px 16px",
                  borderRadius:12, border:"none", cursor:"pointer", fontWeight:600, fontSize:14,
                  background: view===t.id ? "#0ea5e9" : "transparent",
                  color: view===t.id ? "#fff" : dark?"var(--nb-txt2)":"#64748b",
                  boxShadow: view===t.id ? "0 4px 14px rgba(14,165,233,0.3)" : "none",
                  transition:"all 0.15s",
                }}>{t.icon} {t.label}</button>
              ))}
            </nav>

            {/* Right: sync error + waffle */}
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {syncError && <div title={syncError} style={{ color:"#fbbf24", cursor:"help" }}><AlertCircle size={18}/></div>}
              <WaffleMenu dark={dark} onToggleDark={() => setDark(d=>!d)}
                onExport={exportData} onImport={importData}/>
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <main style={{ maxWidth:1100, margin:"0 auto", padding:"16px 16px 100px" }} className="sm:!pb-8">
          {loading ? (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:240, gap:12 }}>
              <div style={{ width:32, height:32, border:"3px solid #0ea5e9", borderTopColor:"transparent",
                borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <p style={D.txt2(dark)}>Načítám data…</p>
            </div>
          ) : view==="data" ? (
            <>
              <InputForm records={records} onSave={handleSave} editRecord={editRecord}
                onCancelEdit={() => setEditRecord(null)} dark={dark}/>
              <DataTable records={records}
                onEdit={r => { setEditRecord(r); window.scrollTo({ top:0, behavior:"smooth" }); }}
                onDelete={deleteRecord} dark={dark}/>
            </>
          ) : (
            <ChartsView records={records} dark={dark}/>
          )}


        </main>

        {/* ── Mobile bottom tab bar ── */}
        <nav className="sm:hidden" style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:40,
          display:"flex",
          background: dark ? "rgba(9,22,38,0.97)" : "rgba(255,255,255,0.97)",
          borderTop: `1px solid ${dark?"var(--nb-border)":"#e2e8f0"}`,
          backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)",
        }}>
          {NAV.map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", gap:4, padding:"12px 0 10px",
              background:"none", border:"none", cursor:"pointer",
              color: view===t.id ? "#38bdf8" : dark?"var(--nb-txt3)":"#94a3b8",
              transition:"color 0.15s", position:"relative",
            }}>
              {t.icon}
              <span style={{ fontSize:11, fontWeight:600 }}>{t.label}</span>
              {view===t.id && (
                <span style={{ position:"absolute", bottom:0, width:36, height:2,
                  borderRadius:"2px 2px 0 0", background:"#38bdf8" }}/>
              )}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}

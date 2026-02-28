import { useState, useCallback, useRef, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTÈME DE FLAMMES — paliers couleur, streak, extinctions
// ─────────────────────────────────────────────────────────────────────────────

const FLAME_PALIERS = [
  { jours: 80, couleur: "#00008B", label: "Légendaire" },
  { jours: 75, couleur: "#1E90FF", label: "Maître"     },
  { jours: 60, couleur: "#40E0D0", label: "Expert"     },
  { jours: 45, couleur: "#FFD700", label: "Avancé"     },
  { jours: 30, couleur: "#FF8C00", label: "Confirmé"   },
  { jours: 15, couleur: "#FF4500", label: "Intermédiaire" },
  { jours:  1, couleur: "#FF0000", label: "Débutant"   },
];

const FLAME_ETEINTE = { couleur: "#2a2a2a", label: "Éteinte" };

function getPalier(streak) {
  if (streak < 1) return FLAME_ETEINTE;
  for (const p of FLAME_PALIERS) {
    if (streak >= p.jours) return p;
  }
  return { couleur: "#FF0000", label: "Débutant" };
}

function calcStreak(habitId, completions) {
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    if (completions.some((c) => c.habitId === habitId && c.date === iso)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function calcExtinctions(habitId, completions) {
  const dates = completions
    .filter((c) => c.habitId === habitId)
    .map((c) => c.date)
    .sort();
  if (dates.length === 0) return 0;
  let count = 0;
  for (let i = 1; i < dates.length; i++) {
    const diff = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
    if (diff > 1) count++;
  }
  return count;
}

function calcDebutStreak(habitId, completions) {
  const today = new Date();
  let debut = null;
  for (let i = 0; i < 400; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    if (completions.some((c) => c.habitId === habitId && c.date === iso)) {
      debut = iso;
    } else {
      break;
    }
  }
  return debut;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE CENTRALISÉ
// ─────────────────────────────────────────────────────────────────────────────

const STORE_KEY  = "dailyflame_v2";
const MAX_HABITS = 16;

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function xpPourNiveau(n) {
  return Math.round(500 * n * (1 + n * 0.3));
}

function calculerNiveau(xpTotal) {
  let niveau = 1;
  let xp = xpTotal;
  while (xp >= xpPourNiveau(niveau)) {
    xp -= xpPourNiveau(niveau);
    niveau++;
  }
  return { niveau, xpRestant: xp, xpNiveau: xpPourNiveau(niveau) };
}

const defaultStore = {
  habits: [],
  completions: [],
  user: { xpTotal: 650, lastActive: todayISO() },
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...defaultStore, ...JSON.parse(raw) } : defaultStore;
  } catch { return defaultStore; }
}

function saveStore(s) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

function useStore() {
  const [store, setStore] = useState(loadStore);

  const commit = useCallback((updater) => {
    setStore((prev) => {
      const next = updater(prev);
      saveStore(next);
      return next;
    });
  }, []);

  const addHabit = useCallback(({ nom, frequence, periode, type }) => {
    commit((s) => {
      if (s.habits.length >= MAX_HABITS) return s;
      return {
        ...s,
        habits: [...s.habits, {
          id: genId(), nom, frequence, periode, type,
          xpParValid: 10, createdAt: todayISO(), actif: true,
        }],
      };
    });
  }, [commit]);

  const updateHabit = useCallback(({ id, nom, frequence, periode, type }) => {
    commit((s) => ({
      ...s,
      habits: s.habits.map((h) =>
        h.id === id ? { ...h, nom, frequence, periode, type } : h
      ),
    }));
  }, [commit]);

  const deleteHabit = useCallback((id) => {
    commit((s) => ({
      ...s,
      habits: s.habits.filter((h) => h.id !== id),
      completions: s.completions.filter((c) => c.habitId !== id),
    }));
  }, [commit]);

  const toggleValidation = useCallback((habitId, date) => {
    commit((s) => {
      const existe = s.completions.find((c) => c.habitId === habitId && c.date === date);
      const habit  = s.habits.find((h) => h.id === habitId);
      if (!habit) return s;
      let completions, xpDelta;
      if (existe) {
        completions = s.completions.filter((c) => !(c.habitId === habitId && c.date === date));
        xpDelta = -existe.xpGagne;
      } else {
        completions = [...s.completions, { id: genId(), habitId, date, xpGagne: habit.xpParValid, timestamp: Date.now() }];
        xpDelta = habit.xpParValid;
      }
      return {
        ...s, completions,
        user: { ...s.user, xpTotal: Math.max(0, s.user.xpTotal + xpDelta), lastActive: todayISO() },
      };
    });
  }, [commit]);

  const xpInfo = calculerNiveau(store.user.xpTotal);
  return { store, addHabit, updateHabit, deleteHabit, toggleValidation, xpInfo };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES CALENDRIER
// ─────────────────────────────────────────────────────────────────────────────

const JOURS_FR = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const DAY_LTRS = ["L","M","M","J","V","S","D"];

function getWeekDates() {
  const today = new Date();
  const dow   = today.getDay();
  const lundi = new Date(today);
  lundi.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi);
    d.setDate(lundi.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function getMonthDays() {
  const today = new Date();
  const nb    = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return Array.from({ length: nb }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), i + 1);
    return { date: d.toISOString().slice(0, 10), dow: d.getDay() === 0 ? 6 : d.getDay() - 1 };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : FLAMME SVG
// ─────────────────────────────────────────────────────────────────────────────

function FlameIcon({ color, size = 36, lit }) {
  const FLAME_PATH = "M457 471.85 c0 -0.95 0.30 -2.35 0.70 -3.15 0.40 -0.80 2.05 -4.60 3.70 -8.45 1.65 -3.85 3.75 -8.55 4.60 -10.50 1.85 -4.15 6 -14.35 8.10 -20 3.60 -9.70 5.55 -15.20 6.40 -18 0.50 -1.65 1.70 -5.60 2.65 -8.75 11.85 -38.80 16.10 -64.55 13.65 -82.75 -1.80 -13.35 -7.45 -32 -13.10 -43.35 -7.75 -15.60 -15.30 -26.05 -28.95 -40.35 -7.25 -7.60 -20.80 -20.20 -21.20 -19.70 -0.25 0.20 -0.80 1.75 -1.30 3.40 -1.80 6.10 -10.35 26.80 -14.90 36.30 -9.15 18.85 -21.05 38.25 -36.40 58.95 -10 13.60 -13.30 18.35 -16.25 23.40 -7.55 13.10 -10.70 28.65 -8.40 41.85 2.70 15.80 11.60 35.20 24.90 54.25 5.60 8 10.85 14.40 22.90 27.90 1.30 1.45 1.90 2.65 1.90 3.65 0 1.40 -0.10 1.45 -2.10 1.45 -3.10 0 -22.85 -5.05 -28.25 -7.25 -12.40 -5 -33.25 -20 -48.10 -34.75 -12.30 -12.15 -21.55 -24.10 -29.55 -38.15 -7.45 -13.10 -11.90 -25.25 -15.30 -41.85 -1.35 -6.45 -1.40 -7.40 -1.40 -21.25 -0.05 -16.15 0.55 -22.35 3.30 -33.75 5.25 -21.85 13.55 -38.15 32.15 -63.25 2.25 -3 6.55 -9 9.60 -13.25 3 -4.25 6.60 -9.30 8 -11.25 2.40 -3.25 12.30 -19.45 15.55 -25.35 9.20 -16.80 15.50 -31.70 22.60 -53.40 4.75 -14.60 9.85 -37 13.50 -59 l2.15 -12.75 3.45 -2.10 c2.10 -1.30 4.15 -2.15 5.05 -2.15 1.10 0 3.10 1.20 7.80 4.65 3.45 2.60 9.35 6.90 13.05 9.60 9.75 7.15 27.10 21.05 35.50 28.55 4 3.55 8.30 7.30 9.50 8.35 4.25 3.65 23.65 23.10 30 30.10 29.85 32.95 52.55 69 64.40 102.25 13.10 36.95 15.55 76.45 6.85 110.75 -1.15 4.70 -2.95 10.65 -3.90 13.25 -0.95 2.60 -2.25 6.20 -2.90 8 -0.65 1.80 -2.55 6.05 -4.20 9.50 -1.70 3.45 -3.50 7.15 -4.05 8.25 -0.90 1.95 -7.15 12.45 -10.45 17.50 -3.25 5.05 -12.50 16.65 -18.25 23 -13.70 15.10 -27.65 27.40 -49.40 43.65 -8.50 6.40 -10.40 7.60 -11.85 7.60 -1.65 0 -1.75 -0.10 -1.75 -1.65z";

  return (
    <svg width={size} height={size * 2} viewBox="300 45 240 445" style={{ display: "block" }}>
      <path d={FLAME_PATH} fill={lit ? color : "#2e2e2e"} />
    </svg>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : TOOLTIP D'UNE FLAMME
// ─────────────────────────────────────────────────────────────────────────────

function FlameTooltip({ habit, streak, palier, extinctions, debutStreak }) {
  return (
    <div style={{
      position: "absolute",
      bottom: "calc(100% + 8px)",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#111",
      border: `1px solid ${palier.couleur}`,
      borderRadius: 9,
      padding: "10px 13px",
      width: 186,
      zIndex: 300,
      pointerEvents: "none",
      boxShadow: `0 6px 24px ${palier.couleur}44, 0 2px 8px rgba(0,0,0,0.6)`,
      animation: "fadeInUp 0.15s ease",
    }}>
      <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(6px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
      <div style={{
        position: "absolute", bottom: -6, left: "50%",
        transform: "translateX(-50%) rotate(45deg)",
        width: 10, height: 10,
        background: "#111",
        borderRight: `1px solid ${palier.couleur}`,
        borderBottom: `1px solid ${palier.couleur}`,
      }} />
      <div style={{
        color: "white", fontFamily: "'Sora', sans-serif", fontWeight: 700,
        fontSize: 12, marginBottom: 7,
        borderBottom: "1px solid #252525", paddingBottom: 6,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{habit.nom}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: palier.couleur, boxShadow: `0 0 7px ${palier.couleur}`, flexShrink: 0 }} />
        <span style={{ color: palier.couleur, fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: "bold" }}>
          {palier.label}
        </span>
      </div>
      {[
        { label: "Allumée depuis",    value: formatDate(debutStreak) },
        { label: "Jours consécutifs", value: streak > 0 ? `${streak}j` : "Éteinte" },
        { label: "Extinctions",       value: String(extinctions), color: extinctions > 0 ? "#ff7070" : "#6bff9b" },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ color: "#555", fontSize: 10, fontFamily: "'DM Mono', monospace" }}>{label}</span>
          <span style={{ color: color || "#bbb", fontSize: 10, fontFamily: "'DM Mono', monospace", fontWeight: "bold" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : CELLULE FLAMME
// ─────────────────────────────────────────────────────────────────────────────

function FlameCell({ habit, completions }) {
  const [hovered, setHovered] = useState(false);
  const streak      = calcStreak(habit.id, completions);
  const extinctions = calcExtinctions(habit.id, completions);
  const debutStreak = calcDebutStreak(habit.id, completions);
  const palier      = getPalier(streak);
  const lit         = streak > 0;

  return (
    <div
      style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", cursor: "default" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && <FlameTooltip habit={habit} streak={streak} palier={palier} extinctions={extinctions} debutStreak={debutStreak} />}
      <div style={{
        transition: "transform 0.2s ease, filter 0.2s ease",
        transform: hovered ? "scale(1.18) translateY(-3px)" : "scale(1)",
        filter: lit ? `drop-shadow(0 0 7px ${palier.couleur}90)` : "none",
      }}>
        <FlameIcon color={palier.couleur} size={24} lit={lit} />
      </div>
      <div style={{
        color: lit ? palier.couleur : "#3a3a3a",
        fontSize: 8, fontFamily: "'DM Mono', monospace", textAlign: "center",
        marginTop: 1, maxWidth: 52, overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", transition: "color 0.3s",
      }}>
        {habit.nom}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : GRILLE DES FLAMMES
// ─────────────────────────────────────────────────────────────────────────────

function FlameGrid({ habits, completions }) {
  const slots = Array.from({ length: MAX_HABITS }, (_, i) => habits[i] || null);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <div style={{ color: "#555", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>
        Mes Foyers &nbsp;<span style={{ color: "#444" }}>{habits.length}/{MAX_HABITS}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 56px)", gridTemplateRows: "repeat(2, 66px)", gap: "0px 4px" }}>
        {slots.map((habit, i) =>
          habit ? (
            <FlameCell key={habit.id} habit={habit} completions={completions} />
          ) : (
            <div key={`empty_${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 2, opacity: 0.18 }}>
              <FlameIcon color="#333" size={34} lit={false} />
              <div style={{ color: "#333", fontSize: 8, fontFamily: "'DM Mono', monospace", marginTop: 1 }}>—</div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : GRAPHIQUE 2D SVG
// ─────────────────────────────────────────────────────────────────────────────

function MiniChart({ completions }) {
  const W = 290, H = 118;
  const PAD = { top: 10, right: 8, bottom: 28, left: 26 };
  const iW  = W - PAD.left - PAD.right;
  const iH  = H - PAD.top  - PAD.bottom;
  const days     = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return d.toISOString().slice(0, 10); });
  const counts   = days.map((date) => ({ date, count: completions.filter((c) => c.date === date).length }));
  const maxCount = Math.max(...counts.map((d) => d.count), 1);
  const today    = todayISO();
  const pts      = counts.map((d, i) => ({ x: PAD.left + (i / 13) * iW, y: PAD.top + iH - (d.count / maxCount) * iH, count: d.count, date: d.date }));
  const area     = [`M ${pts[0].x},${PAD.top + iH}`, ...pts.map((p) => `L ${p.x},${p.y}`), `L ${pts[13].x},${PAD.top + iH}`, "Z"].join(" ");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ color: "#555", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>
        Validations — 14 derniers jours
      </div>
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#ce6e14" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ce6e14" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={PAD.left} y1={PAD.top}    x2={PAD.left}    y2={PAD.top+iH} stroke="#2e2e2e" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top+iH} x2={PAD.left+iW} y2={PAD.top+iH} stroke="#2e2e2e" strokeWidth="1" />
        {[0, 0.5, 1].map((r) => {
          const y = PAD.top + iH - r * iH;
          return (
            <g key={r}>
              <line x1={PAD.left} y1={y} x2={PAD.left+iW} y2={y} stroke="#222" strokeWidth="1" strokeDasharray="3,4" />
              <text x={PAD.left-4} y={y+4} textAnchor="end" fill="#3a3a3a" fontSize="8" fontFamily="DM Mono,monospace">{Math.round(r * maxCount)}</text>
            </g>
          );
        })}
        {[{ i:0, l:"J-13" }, { i:6, l:"J-7" }, { i:13, l:"Auj" }].map(({ i, l }) => (
          <text key={i} x={pts[i].x} y={PAD.top+iH+16} textAnchor="middle" fill="#444" fontSize="8" fontFamily="DM Mono,monospace">{l}</text>
        ))}
        <path d={area} fill="url(#ag2)" />
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#ce6e14" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => p.count > 0 && (
          <circle key={i} cx={p.x} cy={p.y} r={p.date===today?4.5:2.5}
            fill={p.date===today?"#ff9040":"#ce6e14"}
            stroke={p.date===today?"white":"#1a1a1a"}
            strokeWidth={p.date===today?1.5:0.8}
          />
        ))}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : HEADER
// ─────────────────────────────────────────────────────────────────────────────

function AppHeader() {
  const btn = { background:"transparent", color:"white", border:"none", padding:"10px 20px", borderRadius:25, fontSize:15, cursor:"pointer", fontFamily:"inherit", transition:"background 0.2s" };
  return (
    <header style={{ background:"#1a1a1a", display:"flex", alignItems:"center", padding:"10px 24px", justifyContent:"space-between", borderBottom:"1px solid #2a2a2a" }}>
      <button style={{ ...btn, fontWeight:"bold", fontSize:17, color:"#ce6e14", fontfamily: "Inter"  }}>Daily-Flame</button>
      <nav style={{ display:"flex", gap:8 }}>
        {["Social","Stats","Settings"].map((l) => (
          <button key={l} style={btn}
            onMouseOver={(e) => e.currentTarget.style.background="rgba(206,110,20,0.15)"}
            onMouseOut={(e)  => e.currentTarget.style.background="transparent"}>{l}</button>
        ))}
      </nav>
      <div style={{ display:"flex", gap:8 }}>
        {["Inscription","Connexion"].map((l) => (
          <button key={l} style={{ ...btn, border:l==="Connexion"?"1px solid #ce6e14":"none", color:l==="Connexion"?"#ce6e14":"#aaa" }}>{l}</button>
        ))}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : LÉGENDE DES RANGS
// ─────────────────────────────────────────────────────────────────────────────

function FlameLegend() {
  const items = [
    { range:"1–6j",   c:"#FF0000", l:"Débutant"      },
    { range:"7–14j",  c:"#FF0000", l:"Débutant"      },
    { range:"15–29j", c:"#FF4500", l:"Intermédiaire" },
    { range:"30–44j", c:"#FF8C00", l:"Confirmé"      },
    { range:"45–59j", c:"#FFD700", l:"Avancé"        },
    { range:"60–74j", c:"#40E0D0", l:"Expert"        },
    { range:"75–79j", c:"#1E90FF", l:"Maître"        },
    { range:"80j+",   c:"#00008B", l:"Légendaire"    },
  ];
  return (
    <div style={{ background:"#141414", padding:"6px 24px", display:"flex", gap:14, alignItems:"center", flexWrap:"wrap", borderBottom:"1px solid #222" }}>
      <span style={{ color:"#444", fontSize:9, fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", textTransform:"uppercase", flexShrink:0 }}>Rangs flamme :</span>
      {items.filter((_, i) => i !== 0).map(({ range, c, l }) => (
        <div key={range} style={{ display:"flex", alignItems:"center", gap:4 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:c, boxShadow:`0 0 5px ${c}` }} />
          <span style={{ fontSize:9, fontFamily:"'DM Mono', monospace", color:"#555" }}>
            <span style={{ color:c }}>{l}</span>&nbsp;{range}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : HERO
// ─────────────────────────────────────────────────────────────────────────────

function Hero({ xpInfo, habits, completions }) {
  const pct = Math.round((xpInfo.xpRestant / xpInfo.xpNiveau) * 100);
  return (
    <main style={{
      background: "linear-gradient(135deg, #141414 0%, #1c1410 100%)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      minHeight: 190, padding: "14px 36px", boxSizing: "border-box",
      borderBottom: "1px solid #2a2a2a", gap: 20,
    }}>
      <div style={{ display:"flex", flexDirection:"column", gap:10, flexShrink:0 }}>
        <div>
          <div style={{ color:"#555", fontSize:10, letterSpacing:"0.15em", textTransform:"uppercase", fontFamily:"'DM Mono', monospace" }}>Habit Tracker</div>
          <div style={{ color:"white", fontSize:22, fontWeight:800, fontFamily:"'Sora', sans-serif", marginTop:3 }}>Track your Habits</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          <div style={{ color:"white", fontSize:11, fontFamily:"'DM Mono', monospace" }}>
            🔥 Niveau {xpInfo.niveau} — {xpInfo.xpRestant} / {xpInfo.xpNiveau} XP
          </div>
          <div style={{ width:190, height:7, background:"#2a2a2a", borderRadius:10, overflow:"hidden", border:"1px solid #333" }}>
            <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#ce6e14,#ff9040)", borderRadius:10, transition:"width 0.6s ease" }} />
          </div>
        </div>
      </div>
      <MiniChart completions={completions} />
      <FlameGrid habits={habits} completions={completions} />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : TOPBAR + WEEK PLANNER
// ─────────────────────────────────────────────────────────────────────────────

function Topbar({ selectedDate, onSelectDate, onOpenModal, completions }) {
  const [vue, setVue] = useState("semaine");
  const weekDates = getWeekDates();
  const monthDays = getMonthDays();
  const today     = todayISO();
  const dateLabel = new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const hasDone   = (date) => completions.some((c) => c.date === date);
  const vueBtnStyle = (active) => ({
    background: active ? "#ce6e14" : "#ccc", color: active ? "white" : "#444",
    border:"none", borderRadius:7, padding:"5px 14px", fontSize:13,
    cursor:"pointer", transition:"all 0.2s", fontFamily:"'DM Mono', monospace",
  });
  return (
    <div style={{ background:"#e8e8e8", padding:"10px 24px", display:"flex", gap:10, alignItems:"stretch" }}>
      <button onClick={onOpenModal} style={{
        background:"#ce6e14", color:"white", border:"none", borderRadius:10,
        fontSize:15, cursor:"pointer", padding:"0 20px", fontFamily:"'DM Mono', monospace",
        flexShrink:0, width:"22%", transition:"background 0.2s",
      }}
        onMouseOver={(e) => e.currentTarget.style.background="#b85c10"}
        onMouseOut={(e)  => e.currentTarget.style.background="#ce6e14"}
      >+ Gérer les habitudes</button>
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <button style={vueBtnStyle(vue==="semaine")} onClick={() => setVue("semaine")}>Semaine</button>
          <button style={vueBtnStyle(vue==="mois")}    onClick={() => setVue("mois")}>Mois</button>
          <div style={{ marginLeft:"auto", background:"#d4d4d4", borderRadius:7, padding:"4px 12px", fontSize:13, color:"#333", fontFamily:"'DM Mono', monospace" }}>{dateLabel}</div>
        </div>
        <div style={{ background:"rgba(0,0,0,0.65)", border:"1px solid #333", borderRadius:7, height:80, display:"flex", alignItems:"center", padding:"0 10px", overflow:"hidden" }}>
          {vue === "semaine" ? (
            <div style={{ display:"flex", width:"100%", height:"100%", alignItems:"center", justifyContent:"space-around" }}>
              {JOURS_FR.map((jour, i) => {
                const date = weekDates[i];
                const sel  = selectedDate === date;
                const isT  = date === today;
                return (
                  <div key={jour} onClick={() => onSelectDate(date)} style={{
                    display:"flex", flexDirection:"column", alignItems:"center", flex:1, cursor:"pointer",
                    borderRadius:10, padding:"4px 2px",
                    border:`2px solid ${sel?"#ce6e14":"transparent"}`,
                    background:sel?"rgba(206,110,20,0.25)":"transparent",
                    transition:"all 0.2s",
                  }}>
                    <span style={{ color:isT?"#ce6e14":"#ebebeb", fontSize:13, fontFamily:"'DM Mono', monospace" }}>{jour.slice(0,3)}</span>
                    <div style={{ width:20, height:20, margin:"5px 0", background:hasDone(date)?"#26ac14":"#3a3a3a", borderRadius:6, border:isT?"2px solid white":"none" }} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display:"flex", alignItems:"center", gap:4, overflowX:"auto", width:"100%", padding:"0 4px" }}>
              {monthDays.map(({ date, dow }, i) => {
                const sel  = selectedDate === date;
                const isT  = date === today;
                const sep  = dow === 0 && i > 0;
                return (
                  <div key={date} style={{ display:"flex", alignItems:"center", gap:4 }}>
                    {sep && <div style={{ width:1, height:36, background:"rgba(255,255,255,0.3)", margin:"0 2px" }} />}
                    <div onClick={() => onSelectDate(date)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, cursor:"pointer" }}>
                      <span style={{ color:"#aaa", fontSize:9, fontWeight:"bold", fontFamily:"'DM Mono', monospace" }}>{DAY_LTRS[dow]}</span>
                      <div style={{ width:20, height:20, borderRadius:6, background:hasDone(date)?"#26ac14":"#3a3a3a", outline:sel?"2px solid #ce6e14":isT?"2px solid white":"none", transition:"all 0.2s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES FRÉQUENCES
// ─────────────────────────────────────────────────────────────────────────────

const JOURS_SEMAINE = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const MOIS_ANNEE   = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : DIALOG DE CONFIRMATION SUPPRESSION
// ─────────────────────────────────────────────────────────────────────────────

function DeleteConfirmDialog({ habit, onConfirm, onCancel }) {
  if (!habit) return null;
  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      style={{
        position:"fixed", inset:0, background:"rgba(0,0,0,0.75)",
        zIndex:200, display:"flex", justifyContent:"center", alignItems:"center",
      }}
    >
      <div style={{
        background:"#1a1a1a", border:"1px solid #ff4444",
        borderRadius:14, padding:"30px 36px", width:380, maxWidth:"90vw",
        boxShadow:"0 20px 60px rgba(255,68,68,0.25), 0 4px 20px rgba(0,0,0,0.6)",
        display:"flex", flexDirection:"column", gap:18, alignItems:"center",
        animation:"popIn 0.2s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }`}</style>

        {/* Icône */}
        <div style={{
          width:54, height:54, borderRadius:"50%",
          background:"rgba(255,68,68,0.12)", border:"2px solid #ff4444",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:26,
        }}>🗑️</div>

        {/* Texte */}
        <div style={{ textAlign:"center" }}>
          <div style={{ color:"white", fontSize:17, fontFamily:"'Sora', sans-serif", fontWeight:700, marginBottom:8 }}>
            Supprimer l'habitude ?
          </div>
          <div style={{ color:"#aaa", fontSize:13, fontFamily:"'DM Mono', monospace", lineHeight:1.6 }}>
            Vous êtes sur le point de supprimer<br />
            <strong style={{ color:"#ff9090" }}>« {habit.nom} »</strong><br />
            ainsi que tout son historique de completions.<br />
            <span style={{ color:"#ff4444", fontSize:11 }}>Cette action est irréversible.</span>
          </div>
        </div>

        {/* Boutons */}
        <div style={{ display:"flex", gap:12, width:"100%" }}>
          <button
            onClick={onCancel}
            style={{
              flex:1, padding:"10px 0", background:"transparent",
              border:"1px solid #444", color:"#aaa", borderRadius:9,
              fontSize:14, cursor:"pointer", fontFamily:"'DM Mono', monospace",
              transition:"all 0.2s",
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor="#888"; e.currentTarget.style.color="white"; }}
            onMouseOut={(e)  => { e.currentTarget.style.borderColor="#444"; e.currentTarget.style.color="#aaa"; }}
          >Annuler</button>
          <button
            onClick={onConfirm}
            style={{
              flex:1, padding:"10px 0", background:"#c0392b",
              border:"1px solid #ff4444", color:"white", borderRadius:9,
              fontSize:14, cursor:"pointer", fontFamily:"'DM Mono', monospace",
              fontWeight:"bold", transition:"all 0.2s",
            }}
            onMouseOver={(e) => e.currentTarget.style.background="#e74c3c"}
            onMouseOut={(e)  => e.currentTarget.style.background="#c0392b"}
          >🗑️ Supprimer définitivement</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : MODAL (avec édition, fréquences conditionnelles, confirm delete)
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ open, onClose, habits, onAdd, onUpdate, onDelete }) {
  const emptyForm = { nom:"", frequence:"", periode:"", type:"", joursHebdo:[], moisAnnee:[] };
  const [form, setForm]           = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [habitToDelete, setHabitToDelete] = useState(null); // objet habit complet
  const nomRef = useRef();

  useEffect(() => {
    if (open) setTimeout(() => nomRef.current?.focus(), 100);
    if (!open) { setForm(emptyForm); setEditingId(null); setHabitToDelete(null); }
  }, [open]);

  function handleSelectHabit(habit) {
    setEditingId(habit.id);
    setHabitToDelete(null);
    setForm({
      nom: habit.nom,
      frequence: habit.frequence,
      periode: habit.periode,
      type: habit.type,
      joursHebdo: habit.joursHebdo || [],
      moisAnnee: habit.moisAnnee || [],
    });
    setTimeout(() => nomRef.current?.focus(), 80);
  }

  function handleCancel() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function handleSubmit() {
    if (!form.nom.trim()) { nomRef.current?.focus(); return; }
    const payload = { ...form, nom: form.nom.trim() };
    if (editingId) {
      onUpdate({ id: editingId, ...payload });
      setEditingId(null);
      setForm(emptyForm);
    } else {
      onAdd(payload);
      setForm(emptyForm);
    }
  }

  // Toggles pour cases à cocher
  function toggleJour(jour) {
    const next = form.joursHebdo.includes(jour)
      ? form.joursHebdo.filter(j => j !== jour)
      : [...form.joursHebdo, jour];
    setForm({ ...form, joursHebdo: next });
  }

  function toggleMois(mois) {
    const next = form.moisAnnee.includes(mois)
      ? form.moisAnnee.filter(m => m !== mois)
      : [...form.moisAnnee, mois];
    setForm({ ...form, moisAnnee: next });
  }

  function toggleTousMois() {
    if (form.moisAnnee.length === MOIS_ANNEE.length) {
      setForm({ ...form, moisAnnee: [] });
    } else {
      setForm({ ...form, moisAnnee: [...MOIS_ANNEE] });
    }
  }

  if (!open) return null;

  const iStyle = {
    padding:"10px 12px", border:"1px solid #444", borderRadius:8, fontSize:14,
    background:"#2a2a2a", color:"white", outline:"none", width:"100%",
    boxSizing:"border-box", fontFamily:"'DM Mono', monospace",
  };
  const checkboxRow = {
    display:"flex", flexWrap:"wrap", gap:6, marginTop:4,
  };
  const chipStyle = (active) => ({
    padding:"4px 10px", borderRadius:20, fontSize:11,
    fontFamily:"'DM Mono', monospace", cursor:"pointer", userSelect:"none",
    border:`1px solid ${active ? "#ce6e14" : "#444"}`,
    background: active ? "rgba(206,110,20,0.22)" : "#2a2a2a",
    color: active ? "#ff9040" : "#666",
    transition:"all 0.15s",
  });

  const full = habits.length >= MAX_HABITS && !editingId;
  const isEditing = !!editingId;
  const tousMoisCoches = form.moisAnnee.length === MOIS_ANNEE.length;

  return (
    <>
      {/* Dialog de confirmation suppression (au-dessus de la modal) */}
      {habitToDelete && (
        <DeleteConfirmDialog
          habit={habitToDelete}
          onConfirm={() => {
            onDelete(habitToDelete.id);
            if (editingId === habitToDelete.id) { setEditingId(null); setForm(emptyForm); }
            setHabitToDelete(null);
          }}
          onCancel={() => setHabitToDelete(null)}
        />
      )}

      <div
        onClick={(e) => e.target===e.currentTarget && onClose()}
        style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:100, display:"flex", justifyContent:"center", alignItems:"center" }}
      >
        <div style={{
          background:"#1e1e1e", borderRadius:14, padding:30, width:760, maxWidth:"95vw",
          maxHeight:"88vh", overflowY:"auto", display:"flex", gap:30, position:"relative",
          boxShadow:"0 20px 60px rgba(0,0,0,0.6)", color:"white",
        }}>
          <button onClick={onClose} style={{ position:"absolute", top:14, left:16, background:"none", border:"none", color:"#aaa", fontSize:22, cursor:"pointer" }}>✕</button>

          {/* ── Formulaire gauche ── */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:14, paddingTop:20 }}>

            {/* Titre */}
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <h2 style={{ margin:0, fontSize:18, fontFamily:"'Sora', sans-serif" }}>
                {isEditing ? "✏️ Modifier l'habitude" : "Nouvelle habitude"}
              </h2>
              {full && !isEditing && <span style={{ color:"#ff6b6b", fontSize:13 }}>(max {MAX_HABITS} atteint)</span>}
              {isEditing && (
                <button onClick={handleCancel} style={{
                  marginLeft:"auto", background:"transparent", border:"1px solid #555",
                  color:"#aaa", borderRadius:7, padding:"3px 10px", fontSize:12,
                  cursor:"pointer", fontFamily:"'DM Mono', monospace",
                }}>Annuler</button>
              )}
            </div>

            {/* Bandeau édition */}
            {isEditing && (
              <div style={{
                background:"rgba(206,110,20,0.12)", border:"1px solid rgba(206,110,20,0.35)",
                borderRadius:8, padding:"8px 12px", fontSize:12,
                color:"#ce6e14", fontFamily:"'DM Mono', monospace",
              }}>
                Modification de &nbsp;<strong>{habits.find(h=>h.id===editingId)?.nom}</strong>
              </div>
            )}

            {/* Nom */}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <label style={{ fontSize:13, color:"#aaa", fontFamily:"'DM Mono', monospace" }}>Nom</label>
              <input
                ref={nomRef} type="text" value={form.nom}
                onChange={(e) => setForm({ ...form, nom:e.target.value })}
                onKeyDown={(e) => e.key==="Enter" && handleSubmit()}
                placeholder="Ex : Méditation, Course..."
                style={iStyle} disabled={full}
              />
            </div>

            {/* Fréquence */}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <label style={{ fontSize:13, color:"#aaa", fontFamily:"'DM Mono', monospace" }}>Fréquence</label>
              <select
                value={form.frequence}
                onChange={(e) => setForm({ ...form, frequence:e.target.value, joursHebdo:[], moisAnnee:[] })}
                style={iStyle} disabled={full}
              >
                <option value="">-- Choisir --</option>
                <option value="Quotidien">Quotidien</option>
                <option value="Hebdomadaire">Hebdomadaire</option>
                <option value="Mensuel">Mensuel</option>
              </select>

              {/* Options conditionnelles : jours de la semaine */}
              {form.frequence === "Hebdomadaire" && (
                <div style={{
                  background:"#252525", border:"1px solid #383838",
                  borderRadius:8, padding:"10px 12px",
                  animation:"fadeInDown 0.2s ease",
                }}>
                  <style>{`@keyframes fadeInDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }`}</style>
                  <div style={{ fontSize:11, color:"#888", fontFamily:"'DM Mono', monospace", marginBottom:8 }}>
                    Jours concernés <span style={{ color:"#555" }}>({form.joursHebdo.length} sélectionné{form.joursHebdo.length>1?"s":""})</span>
                  </div>
                  <div style={checkboxRow}>
                    {JOURS_SEMAINE.map((jour) => (
                      <span key={jour} style={chipStyle(form.joursHebdo.includes(jour))} onClick={() => toggleJour(jour)}>
                        {jour.slice(0,3)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Options conditionnelles : mois de l'année */}
              {form.frequence === "Mensuel" && (
                <div style={{
                  background:"#252525", border:"1px solid #383838",
                  borderRadius:8, padding:"10px 12px",
                  animation:"fadeInDown 0.2s ease",
                }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                    <div style={{ fontSize:11, color:"#888", fontFamily:"'DM Mono', monospace" }}>
                      Mois concernés <span style={{ color:"#555" }}>({form.moisAnnee.length}/12)</span>
                    </div>
                    <span
                      style={{
                        fontSize:10, fontFamily:"'DM Mono', monospace", cursor:"pointer",
                        color: tousMoisCoches ? "#ff9040" : "#666",
                        border:`1px solid ${tousMoisCoches ? "#ce6e14" : "#444"}`,
                        background: tousMoisCoches ? "rgba(206,110,20,0.2)" : "transparent",
                        borderRadius:20, padding:"2px 8px", transition:"all 0.15s",
                      }}
                      onClick={toggleTousMois}
                    >
                      {tousMoisCoches ? "✓ Tous" : "Tous"}
                    </span>
                  </div>
                  <div style={checkboxRow}>
                    {MOIS_ANNEE.map((mois) => (
                      <span key={mois} style={chipStyle(form.moisAnnee.includes(mois))} onClick={() => toggleMois(mois)}>
                        {mois.slice(0,3)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Période + Type */}
            {[
              { label:"Période", key:"periode", opts:["matin","aprem","soir"] },
              { label:"Type",    key:"type",    opts:["Santé","Travail","Projet","Sport","Autre"] },
            ].map(({ label, key, opts }) => (
              <div key={key} style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:13, color:"#aaa", fontFamily:"'DM Mono', monospace" }}>{label}</label>
                <select value={form[key]} onChange={(e) => setForm({ ...form, [key]:e.target.value })} style={iStyle} disabled={full}>
                  <option value="">-- Choisir --</option>
                  {opts.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase()+o.slice(1)}</option>)}
                </select>
              </div>
            ))}

            {/* Bouton submit */}
            <button
              onClick={handleSubmit} disabled={full}
              style={{
                marginTop:8, padding:12,
                background: full ? "#444" : isEditing ? "#1e7bcf" : "#ce6e14",
                color:"white", border:"none", borderRadius:10, fontSize:15,
                cursor: full ? "not-allowed" : "pointer",
                fontFamily:"'DM Mono', monospace", transition:"background 0.2s",
              }}
              onMouseOver={(e) => { if(!full) e.currentTarget.style.background = isEditing ? "#1568b0" : "#b85c10"; }}
              onMouseOut={(e)  => { if(!full) e.currentTarget.style.background = isEditing ? "#1e7bcf" : "#ce6e14"; }}
            >
              {isEditing ? "💾 Sauvegarder les modifications" : "Enregistrer"}
            </button>
          </div>

          {/* ── Liste droite ── */}
          <div style={{ width:230, flexShrink:0, display:"flex", flexDirection:"column", gap:10, paddingTop:20 }}>
            <h3 style={{ margin:"0 0 6px", fontSize:14, color:"#aaa", borderBottom:"1px solid #333", paddingBottom:6, fontFamily:"'DM Mono', monospace" }}>
              Habitudes ({habits.length}/{MAX_HABITS})
            </h3>
            <p style={{ margin:0, fontSize:10, color:"#555", fontFamily:"'DM Mono', monospace", lineHeight:1.4 }}>
              Cliquez sur une habitude pour la modifier.
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:8, overflowY:"auto", maxHeight:460 }}>
              {habits.length === 0
                ? <p style={{ fontSize:13, color:"#555", fontStyle:"italic", fontFamily:"'DM Mono', monospace" }}>Aucune habitude.</p>
                : habits.map((h) => {
                  const isSelected = editingId === h.id;
                  return (
                    <div
                      key={h.id}
                      onClick={() => handleSelectHabit(h)}
                      style={{
                        background: isSelected ? "rgba(30,123,207,0.18)" : "#2a2a2a",
                        border: `1px solid ${isSelected ? "#1e7bcf" : "#444"}`,
                        borderRadius:8, padding:"8px 10px", fontSize:13,
                        fontFamily:"'DM Mono', monospace", color:"#ddd",
                        display:"flex", justifyContent:"space-between", alignItems:"flex-start",
                        cursor:"pointer", transition:"all 0.18s",
                        transform: isSelected ? "translateX(-3px)" : "translateX(0)",
                        boxShadow: isSelected ? "0 0 0 1px #1e7bcf44, 4px 0 0 #1e7bcf inset" : "none",
                      }}
                    >
                      <div style={{ flex:1, minWidth:0 }}>
                        <strong style={{
                          display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                          color: isSelected ? "#5db8ff" : "#ddd",
                        }}>{h.nom}</strong>
                        <span style={{ display:"block", fontSize:11, color:"#888", marginTop:2 }}>
                          {h.type} · {h.periode} · {h.frequence}
                          {h.joursHebdo?.length > 0 && (
                            <span style={{ color:"#555" }}> · {h.joursHebdo.map(j=>j.slice(0,3)).join(", ")}</span>
                          )}
                          {h.moisAnnee?.length > 0 && h.moisAnnee.length < 12 && (
                            <span style={{ color:"#555" }}> · {h.moisAnnee.length} mois</span>
                          )}
                          {h.moisAnnee?.length === 12 && (
                            <span style={{ color:"#555" }}> · toute l'année</span>
                          )}
                        </span>
                        {isSelected && (
                          <span style={{ fontSize:10, color:"#1e7bcf", marginTop:3, display:"block" }}>✏️ En cours de modification</span>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setHabitToDelete(h); }}
                        title="Supprimer"
                        style={{
                          background:"none", border:"none", color:"#555",
                          cursor:"pointer", fontSize:14, padding:"0 0 0 6px",
                          borderRadius:5, transition:"color 0.2s", flexShrink:0,
                        }}
                        onMouseOver={(e) => e.currentTarget.style.color="#ff4444"}
                        onMouseOut={(e)  => e.currentTarget.style.color="#555"}
                      >✕</button>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : CARD HABITUDE
// ─────────────────────────────────────────────────────────────────────────────

function HabitCard({ habit, validated, onToggle, completions, isLocked }) {
  const [pulse, setPulse] = useState(false);
  const streak = calcStreak(habit.id, completions);
  const palier = getPalier(streak);
  function handleClick() {
    if (isLocked) return;
    setPulse(true);
    setTimeout(() => setPulse(false), 300);
    onToggle(habit.id);
  }
  return (
    <div onClick={handleClick} style={{
      width:"85%", background:validated?"#ce6e14":"white",
      border:`1px solid ${validated?"#a85510":"#ccc"}`,
      borderRadius:8, padding:"10px 14px", cursor: isLocked ? "not-allowed" : "pointer",
      opacity: isLocked ? 0.6 : 1,
      userSelect:"none", fontFamily:"'DM Mono', monospace", fontSize:14,
      color:validated?"white":"#333",
      transform:pulse?"scale(0.97)":"scale(1)",
      transition:"all 0.2s cubic-bezier(0.34,1.56,0.64,1)",
      boxShadow:validated?"0 4px 16px rgba(206,110,20,0.35)":"0 1px 4px rgba(0,0,0,0.08)",
      flexShrink: 0,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <strong>{habit.nom}</strong>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          {streak > 0 && (
            <span style={{
              fontSize:9, fontFamily:"'DM Mono', monospace",
              color:validated?"white":palier.couleur,
              background:validated?"rgba(255,255,255,0.2)":`${palier.couleur}22`,
              border:`1px solid ${validated?"rgba(255,255,255,0.3)":palier.couleur}`,
              borderRadius:10, padding:"1px 6px",
            }}>🔥 {streak}j</span>
          )}
          <span style={{ fontSize:15 }}>{validated?"✓":"○"}</span>
        </div>
      </div>
      <div style={{ fontSize:11, color:validated?"#ffd9b3":"#999", marginTop:3 }}>
        {habit.type}{habit.frequence?` · ${habit.frequence}`:""}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : COLONNE BOARD
// ─────────────────────────────────────────────────────────────────────────────

function Column({ title, habits, completions, selectedDate, onToggle, isLocked }) {
  const done  = habits.filter((h) => completions.some((c) => c.habitId===h.id && c.date===selectedDate)).length;
  const total = habits.length;
  const full  = total > 0 && done === total;

  return (
    <div style={{
      background:"#ececec", border:"1px solid rgba(58,58,58,0.5)", borderRadius:10,
      padding:14, flex:1, minWidth:0, height:"100%", overflow:"hidden",
      display:"flex", flexDirection:"column", gap:10, boxSizing:"border-box",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <h2 style={{ margin:0, fontSize:13, color:"#222", fontFamily:"'Sora', sans-serif", fontWeight:700, letterSpacing:"0.08em" }}>{title} {isLocked && <span style={{ fontSize:10, color:"#7700e6", fontFamily:"'DM Mono', monospace", fontWeight:400 }}>🔒 lock</span>}</h2>
        <span style={{ fontSize:12, color:full?"white":"#888", background:full?"#ce6e14":"#ddd", borderRadius:20, padding:"2px 8px", fontFamily:"'DM Mono', monospace", transition:"all 0.3s" }}>{done}/{total}</span>
      </div>
      <div style={{ flex:1, minHeight:0, overflowY:"auto", display:"flex", flexDirection:"column", gap:10 }}>
        {habits.length === 0
          ? <div style={{ color:"#bbb", fontSize:13, fontStyle:"italic", textAlign:"center", marginTop:20, fontFamily:"'DM Mono', monospace" }}>Aucune habitude</div>
          : habits.map((h) => (
            <HabitCard key={h.id} habit={h}
              validated={completions.some((c) => c.habitId===h.id && c.date===selectedDate)}
              onToggle={onToggle}
              completions={completions}
              isLocked={isLocked}
            />
          ))
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : HABIT LIST
// ─────────────────────────────────────────────────────────────────────────────

function HabitList({ habits, completions, selectedDate, onToggle, isLocked}) {
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType] = useState("");

  const filtered = habits.filter((h) =>
    h.nom.toLowerCase().includes(search.toLowerCase()) && (filterType ? h.type===filterType : true)
  );

  return (
    <div style={{
      background:"#ececec", border:"1px solid rgba(58,58,58,0.5)", borderRadius:10,
      padding:14, width:"100%", height:"100%", overflow:"hidden",
      display:"flex", flexDirection:"column", gap:10, boxSizing:"border-box",
    }}>
      <h2 style={{ margin:0, fontSize:13, color:"#222", fontFamily:"'Sora', sans-serif", fontWeight:700, flexShrink:0 }}>Mes Habitudes</h2>
      <input type="text" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)}
        style={{ padding:"8px 12px", border:"1px solid #ccc", borderRadius:8, fontSize:13, outline:"none", background:"#f9f9f9", fontFamily:"'DM Mono', monospace", width:"100%", boxSizing:"border-box", flexShrink:0 }} />
      <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
        style={{ padding:"8px 10px", border:"1px solid #ccc", borderRadius:8, fontSize:13, background:"#f9f9f9", cursor:"pointer", outline:"none", fontFamily:"'DM Mono', monospace", width:"100%", flexShrink:0 }}>
        <option value="">Tous les types</option>
        {["Santé","Travail","Projet","Sport","Autre"].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <h3 style={{ margin:"4px 0 0", fontSize:10, color:"#888", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", flexShrink:0 }}>LISTE ({filtered.length})</h3>
      <div style={{ flex:1, minHeight:0, overflowY:"auto", display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.map((h) => {
          const val    = completions.some((c) => c.habitId===h.id && c.date===selectedDate);
          const streak = calcStreak(h.id, completions);
          const palier = getPalier(streak);
          return (
            <div key={h.id} onClick={() => { if (!isLocked) onToggle(h.id); }} style={{
              background:val?"#fff3e8":"white",
              border:`1px solid ${val?"#ce6e14":"#ddd"}`,
              borderLeft:`4px solid ${streak>0?palier.couleur:"#eee"}`,
              borderRadius:7, padding:"10px 12px", cursor:"pointer",
              fontFamily:"'DM Mono', monospace", fontSize:13, transition:"all 0.2s",
              flexShrink:0,
              cursor: isLocked ? "not-allowed" : "pointer"
            }}>
              <div style={{ fontWeight:"bold", color:"#222", display:"flex", justifyContent:"space-between" }}>
             <span>{h.nom}</span>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {isLocked && <span style={{ fontSize:9, color:"#b10fe2", fontFamily:"'DM Mono', monospace" }}>🔒 lock</span>}
                <span style={{ fontSize:10, color:streak>0?palier.couleur:"#bbb" }}>{streak>0?`🔥 ${streak}j`:"—"}</span>
              </div>
            </div>
              <div style={{ fontSize:11, color:"#999", marginTop:3 }}>{h.type} · {h.periode} · {h.frequence}</div>
            </div>
          );
        })}
        {filtered.length===0 && <div style={{ color:"#bbb", fontSize:13, fontStyle:"italic", textAlign:"center", marginTop:20 }}>Aucune habitude trouvée</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : XP TOAST
// ─────────────────────────────────────────────────────────────────────────────

function XPToast({ xp, visible }) {
  return (
    <div style={{
      position:"fixed", bottom:32, right:32, zIndex:999,
      background:"#ce6e14", color:"white", padding:"10px 20px", borderRadius:30,
      fontFamily:"'DM Mono', monospace", fontSize:18, fontWeight:"bold",
      boxShadow:"0 8px 30px rgba(206,110,20,0.5)",
      transform:visible?"translateY(0) scale(1)":"translateY(20px) scale(0.8)",
      opacity:visible?1:0,
      transition:"all 0.4s cubic-bezier(0.34,1.56,0.64,1)",
      pointerEvents:"none",
    }}>+{xp} XP 🔥</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const { store, addHabit, updateHabit, deleteHabit, toggleValidation, xpInfo } = useStore();
  const [modalOpen, setModalOpen]       = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [toast, setToast]               = useState({ visible:false, xp:0 });
  const toastTimer                      = useRef(null);

  function handleToggle(habitId) {
    const wasValidated = store.completions.some((c) => c.habitId===habitId && c.date===selectedDate);
    toggleValidation(habitId, selectedDate);
    if (!wasValidated) {
      const habit = store.habits.find((h) => h.id===habitId);
      if (habit) {
        clearTimeout(toastTimer.current);
        setToast({ visible:true, xp:habit.xpParValid });
        toastTimer.current = setTimeout(() => setToast({ visible:false, xp:0 }), 2000);
      }
    }
  }

  const habitsMatin = store.habits.filter((h) => h.periode==="matin");
  const habitsAprem = store.habits.filter((h) => h.periode==="aprem");
  const habitsSoir  = store.habits.filter((h) => h.periode==="soir");

  return (
    <div style={{ minHeight:"100vh", background:"#f5f5f5", fontFamily:"'DM Mono', monospace", display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;700;800&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#ce6e14; border-radius:3px; }
      `}</style>

      <AppHeader />
      <FlameLegend />
      <Hero xpInfo={xpInfo} habits={store.habits} completions={store.completions} />
      <Topbar selectedDate={selectedDate} onSelectDate={setSelectedDate} onOpenModal={() => setModalOpen(true)} completions={store.completions} />

            <div style={{
          display: "flex", gap: 10, padding: "10px 24px",
          background: "#e7e7e7", flex: 1,
          minHeight: 300, boxSizing: "border-box", overflow: "hidden",
        }}>
        <div style={{ width:"22%", flexShrink:0, height:"100%" }}>
          <HabitList
            habits={store.habits}
            completions={store.completions}
            selectedDate={selectedDate}
            onToggle={handleToggle}
            isLocked={selectedDate < todayISO()}
          />
        </div>
        <div style={{ flex:1, display:"flex", gap:10, minWidth:0, height:"100%" }}>
          <Column title="MATIN"      habits={habitsMatin} completions={store.completions} selectedDate={selectedDate} onToggle={handleToggle} isLocked={selectedDate < todayISO()} />
          <Column title="APRÈS-MIDI" habits={habitsAprem} completions={store.completions} selectedDate={selectedDate} onToggle={handleToggle} isLocked={selectedDate < todayISO()}/>
          <Column title="SOIR"       habits={habitsSoir}  completions={store.completions} selectedDate={selectedDate} onToggle={handleToggle} isLocked={selectedDate < todayISO()}/>
        </div>
      </div>

      <footer style={{ background:"#1a1a1a", color:"#555", textAlign:"center", padding:"16px", fontSize:13, fontFamily:"'DM Mono', monospace" }}>
        © 2026 – DailyFlame mANU
      </footer>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        habits={store.habits}
        onAdd={addHabit}
        onUpdate={updateHabit}
        onDelete={deleteHabit}
      />
      <XPToast xp={toast.xp} visible={toast.visible} />
    </div>
  );
}
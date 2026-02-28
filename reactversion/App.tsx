import { useState, useCallback, useRef, useEffect } from "react";
import "./App.css";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

interface FlamePalier {
  jours: number;
  couleur: string;
  label: string;
}

interface FlameEteinte {
  couleur: string;
  label: string;
}

interface Habit {
  id: string;
  nom: string;
  frequence: string;
  periode: "matin" | "aprem" | "soir";
  type: string;
  xpParValid: number;
  createdAt: string;
  actif: boolean;
}

interface Completion {
  id: string;
  habitId: string;
  date: string;
  xpGagne: number;
  timestamp: number;
}

interface User {
  xpTotal: number;
  lastActive: string;
}

interface Store {
  habits: Habit[];
  completions: Completion[];
  user: User;
}

interface XpInfo {
  niveau: number;
  xpRestant: number;
  xpNiveau: number;
}

interface MonthDay {
  date: string;
  dow: number;
}

interface ChartPoint {
  x: number;
  y: number;
  count: number;
  date: string;
}

interface DayCount {
  date: string;
  count: number;
}

interface ToastState {
  visible: boolean;
  xp: number;
}

interface FormState {
  nom: string;
  frequence: string;
  periode: string;
  type: string;
}

interface LegendItem {
  range: string;
  c: string;
  l: string;
}

interface StatItem {
  label: string;
  value: string;
  color?: string;
}

interface SelectField {
  label: string;
  key: keyof FormState;
  opts: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTÈME DE FLAMMES
// ─────────────────────────────────────────────────────────────────────────────

const FLAME_PALIERS: FlamePalier[] = [
  { jours: 80, couleur: "#00008B", label: "Légendaire" },
  { jours: 75, couleur: "#1E90FF", label: "Maître"     },
  { jours: 60, couleur: "#40E0D0", label: "Expert"     },
  { jours: 45, couleur: "#FFD700", label: "Avancé"     },
  { jours: 30, couleur: "#FF8C00", label: "Confirmé"   },
  { jours: 15, couleur: "#FF4500", label: "Intermédiaire" },
  { jours:  1, couleur: "#FF0000", label: "Débutant"   },
];

const FLAME_ETEINTE: FlameEteinte = { couleur: "#2a2a2a", label: "Éteinte" };

function getPalier(streak: number): FlamePalier | FlameEteinte {
  if (streak < 1) return FLAME_ETEINTE;
  for (const p of FLAME_PALIERS) {
    if (streak >= p.jours) return p;
  }
  return { couleur: "#FF0000", label: "Débutant" };
}

function calcStreak(habitId: string, completions: Completion[]): number {
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

function calcExtinctions(habitId: string, completions: Completion[]): number {
  const dates = completions
    .filter((c) => c.habitId === habitId)
    .map((c) => c.date)
    .sort();
  if (dates.length === 0) return 0;
  let count = 0;
  for (let i = 1; i < dates.length; i++) {
    const diff = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000;
    if (diff > 1) count++;
  }
  return count;
}

function calcDebutStreak(habitId: string, completions: Completion[]): string | null {
  const today = new Date();
  let debut: string | null = null;
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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE CENTRALISÉ
// ─────────────────────────────────────────────────────────────────────────────

const STORE_KEY  = "dailyflame_v2";
const MAX_HABITS = 16;

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function xpPourNiveau(n: number): number {
  return Math.round(500 * n * (1 + n * 0.3));
}

function calculerNiveau(xpTotal: number): XpInfo {
  let niveau = 1;
  let xp = xpTotal;
  while (xp >= xpPourNiveau(niveau)) {
    xp -= xpPourNiveau(niveau);
    niveau++;
  }
  return { niveau, xpRestant: xp, xpNiveau: xpPourNiveau(niveau) };
}

const defaultStore: Store = {
  habits: [],
  completions: [],
  user: { xpTotal: 650, lastActive: todayISO() },
};

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...defaultStore, ...JSON.parse(raw) } : defaultStore;
  } catch { return defaultStore; }
}

function saveStore(s: Store): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

function useStore() {
  const [store, setStore] = useState<Store>(loadStore);

  const commit = useCallback((updater: (prev: Store) => Store) => {
    setStore((prev) => {
      const next = updater(prev);
      saveStore(next);
      return next;
    });
  }, []);

  const addHabit = useCallback(({ nom, frequence, periode, type }: Pick<Habit, "nom" | "frequence" | "periode" | "type">) => {
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

  const deleteHabit = useCallback((id: string) => {
    commit((s) => ({
      ...s,
      habits: s.habits.filter((h) => h.id !== id),
      completions: s.completions.filter((c) => c.habitId !== id),
    }));
  }, [commit]);

  const toggleValidation = useCallback((habitId: string, date: string) => {
    commit((s) => {
      const existe = s.completions.find((c) => c.habitId === habitId && c.date === date);
      const habit  = s.habits.find((h) => h.id === habitId);
      if (!habit) return s;
      let completions: Completion[];
      let xpDelta: number;
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
  return { store, addHabit, deleteHabit, toggleValidation, xpInfo };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES CALENDRIER
// ─────────────────────────────────────────────────────────────────────────────

const JOURS_FR: string[] = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const DAY_LTRS: string[] = ["L","M","M","J","V","S","D"];

function getWeekDates(): string[] {
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

function getMonthDays(): MonthDay[] {
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

interface FlameIconProps {
  color: string;
  size?: number;
  lit: boolean;
}

function FlameIcon({ color, size = 36, lit }: FlameIconProps) {
  const id = useRef<string>(`f_${Math.random().toString(36).slice(2)}`).current;
  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 40 52" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id={id} cx="50%" cy="72%" r="60%">
          <stop offset="0%"   stopColor={lit ? "#fff" : "#555"} stopOpacity={lit ? 0.95 : 0.3} />
          <stop offset="40%"  stopColor={color}                 stopOpacity="1" />
          <stop offset="100%" stopColor={color}                 stopOpacity="0.15" />
        </radialGradient>
        {lit && (
          <filter id={`g_${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.8" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>
      <path
        d="M20 2 C20 2 31 13 33 23 C35 32 31 40 25 44 C23 45 20 46 17 44 C11 40 7 32 9 23 C11 13 20 2 20 2Z"
        fill={`url(#${id})`}
        filter={lit ? `url(#g_${id})` : undefined}
        opacity={lit ? 1 : 0.35}
      />
      {lit && (
        <path
          d="M20 18 C20 18 25 26 25 32 C25 38 23 42 20 44 C17 42 15 38 15 32 C15 26 20 18 20 18Z"
          fill="white"
          opacity="0.22"
        />
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : TOOLTIP D'UNE FLAMME
// ─────────────────────────────────────────────────────────────────────────────

interface FlameTooltipProps {
  habit: Habit;
  streak: number;
  palier: FlamePalier | FlameEteinte;
  extinctions: number;
  debutStreak: string | null;
}

function FlameTooltip({ habit, streak, palier, extinctions, debutStreak }: FlameTooltipProps) {
  const stats: StatItem[] = [
    { label: "Allumée depuis",    value: formatDate(debutStreak) },
    { label: "Jours consécutifs", value: streak > 0 ? `${streak}j` : "Éteinte" },
    { label: "Extinctions",       value: String(extinctions), color: extinctions > 0 ? "#ff7070" : "#6bff9b" },
  ];

  return (
    <div
      className="flame-tooltip"
      style={{
        border:    `1px solid ${palier.couleur}`,
        boxShadow: `0 6px 24px ${palier.couleur}44, 0 2px 8px rgba(0,0,0,0.6)`,
      }}
    >
      <div
        className="flame-tooltip__arrow"
        style={{
          borderRight:  `1px solid ${palier.couleur}`,
          borderBottom: `1px solid ${palier.couleur}`,
        }}
      />

      <div className="flame-tooltip__name">{habit.nom}</div>

      <div className="flame-tooltip__rank">
        <div
          className="flame-tooltip__rank-dot"
          style={{ background: palier.couleur, boxShadow: `0 0 7px ${palier.couleur}` }}
        />
        <span className="flame-tooltip__rank-label" style={{ color: palier.couleur }}>
          {palier.label}
        </span>
      </div>

      {stats.map(({ label, value, color }) => (
        <div key={label} className="flame-tooltip__row">
          <span className="flame-tooltip__row-key">{label}</span>
          <span className="flame-tooltip__row-val" style={{ color: color || "#bbb" }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : CELLULE FLAMME
// ─────────────────────────────────────────────────────────────────────────────

interface FlameCellProps {
  habit: Habit;
  completions: Completion[];
}

function FlameCell({ habit, completions }: FlameCellProps) {
  const [hovered, setHovered] = useState<boolean>(false);

  const streak      = calcStreak(habit.id, completions);
  const extinctions = calcExtinctions(habit.id, completions);
  const debutStreak = calcDebutStreak(habit.id, completions);
  const palier      = getPalier(streak);
  const lit         = streak > 0;

  return (
    <div
      className="flame-cell"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <FlameTooltip
          habit={habit}
          streak={streak}
          palier={palier}
          extinctions={extinctions}
          debutStreak={debutStreak}
        />
      )}

      <div
        className="flame-cell__icon"
        style={{ filter: lit ? `drop-shadow(0 0 7px ${palier.couleur}90)` : "none" }}
      >
        <FlameIcon color={palier.couleur} size={34} lit={lit} />
      </div>

      <div className="flame-cell__name" style={{ color: lit ? palier.couleur : "#3a3a3a" }}>
        {habit.nom}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : GRILLE DES FLAMMES (toujours 16 emplacements, 8×2)
// ─────────────────────────────────────────────────────────────────────────────

interface FlameGridProps {
  habits: Habit[];
  completions: Completion[];
}

function FlameGrid({ habits, completions }: FlameGridProps) {
  const slots: (Habit | null)[] = Array.from({ length: MAX_HABITS }, (_, i) => habits[i] || null);

  return (
    <div className="flame-grid">
      <div className="flame-grid__header">
        Mes Foyers &nbsp;<span className="flame-grid__count">{habits.length}/{MAX_HABITS}</span>
      </div>
      <div className="flame-grid__cells">
        {slots.map((habit, i) =>
          habit ? (
            <FlameCell key={habit.id} habit={habit} completions={completions} />
          ) : (
            <div key={`empty_${i}`} className="flame-cell flame-cell--empty">
              <FlameIcon color="#333" size={34} lit={false} />
              <div className="flame-cell__name">—</div>
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

interface MiniChartProps {
  completions: Completion[];
}

function MiniChart({ completions }: MiniChartProps) {
  const W = 290, H = 118;
  const PAD = { top: 10, right: 8, bottom: 28, left: 26 };
  const iW  = W - PAD.left - PAD.right;
  const iH  = H - PAD.top  - PAD.bottom;

  const days: string[]     = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return d.toISOString().slice(0, 10); });
  const counts: DayCount[] = days.map((date) => ({ date, count: completions.filter((c) => c.date === date).length }));
  const maxCount: number   = Math.max(...counts.map((d) => d.count), 1);
  const today: string      = todayISO();
  const pts: ChartPoint[]  = counts.map((d, i) => ({ x: PAD.left + (i / 13) * iW, y: PAD.top + iH - (d.count / maxCount) * iH, count: d.count, date: d.date }));
  const area: string       = [`M ${pts[0].x},${PAD.top + iH}`, ...pts.map((p) => `L ${p.x},${p.y}`), `L ${pts[13].x},${PAD.top + iH}`, "Z"].join(" ");

  return (
    <div className="chart">
      <div className="chart__label">Validations — 14 derniers jours</div>
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
          <circle key={i} cx={p.x} cy={p.y}
            r={p.date === today ? 4.5 : 2.5}
            fill={p.date === today ? "#ff9040" : "#ce6e14"}
            stroke={p.date === today ? "white" : "#1a1a1a"}
            strokeWidth={p.date === today ? 1.5 : 0.8}
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
  return (
    <header className="header">
      <button className="header__logo">🔥 DailyFlame</button>
      <nav className="header__nav">
        {["Social", "Stats", "Settings"].map((l) => (
          <button key={l} className="header__nav-btn">{l}</button>
        ))}
      </nav>
      <div className="header__auth">
        <button className="header__auth-btn">Inscription</button>
        <button className="header__auth-btn header__auth-btn--outline">Connexion</button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : LÉGENDE DES RANGS
// ─────────────────────────────────────────────────────────────────────────────

function FlameLegend() {
  const items: LegendItem[] = [
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
    <div className="flame-legend">
      <span className="flame-legend__label">Rangs flamme :</span>
      {items.filter((_, i) => i !== 0).map(({ range, c, l }) => (
        <div key={range} className="flame-legend__item">
          <div className="flame-legend__dot" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
          <span className="flame-legend__text">
            <span style={{ color: c }}>{l}</span>&nbsp;{range}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : HERO
// ─────────────────────────────────────────────────────────────────────────────

interface HeroProps {
  xpInfo: XpInfo;
  habits: Habit[];
  completions: Completion[];
}

function Hero({ xpInfo, habits, completions }: HeroProps) {
  const pct: number = Math.round((xpInfo.xpRestant / xpInfo.xpNiveau) * 100);

  return (
    <main className="hero">
      <div className="hero__left">
        <div>
          <div className="hero__subtitle">Habit Tracker</div>
          <div className="hero__title">Track your Habits</div>
        </div>
        <div>
          <div className="hero__xp-label">
            🔥 Niveau {xpInfo.niveau} — {xpInfo.xpRestant} / {xpInfo.xpNiveau} XP
          </div>
          <div className="hero__xp-track">
            <div className="hero__xp-fill" style={{ width: `${pct}%` }} />
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

interface TopbarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onOpenModal: () => void;
  completions: Completion[];
}

function Topbar({ selectedDate, onSelectDate, onOpenModal, completions }: TopbarProps) {
  const [vue, setVue] = useState<"semaine" | "mois">("semaine");
  const weekDates: string[]   = getWeekDates();
  const monthDays: MonthDay[] = getMonthDays();
  const today: string         = todayISO();
  const dateLabel: string     = new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const hasDone = (date: string): boolean => completions.some((c) => c.date === date);

  return (
    <div className="topbar">
      <button className="topbar__manage-btn" onClick={onOpenModal}>
        + Gérer les habitudes
      </button>

      <div className="topbar__calendar">
        <div className="topbar__controls">
          <button
            className={`topbar__vue-btn ${vue === "semaine" ? "topbar__vue-btn--active" : ""}`}
            onClick={() => setVue("semaine")}
          >Semaine</button>
          <button
            className={`topbar__vue-btn ${vue === "mois" ? "topbar__vue-btn--active" : ""}`}
            onClick={() => setVue("mois")}
          >Mois</button>
          <div className="topbar__date-label">{dateLabel}</div>
        </div>

        <div className="topbar__planner">
          {vue === "semaine" ? (
            <div className="planner-week">
              {JOURS_FR.map((jour, i) => {
                const date: string = weekDates[i];
                const sel: boolean = selectedDate === date;
                const isT: boolean = date === today;
                return (
                  <div
                    key={jour}
                    className={`planner-week__day ${sel ? "planner-week__day--selected" : ""}`}
                    onClick={() => onSelectDate(date)}
                  >
                    <span className={`planner-week__label ${isT ? "planner-week__label--today" : ""}`}>
                      {jour.slice(0, 3)}
                    </span>
                    <div className={[
                      "planner-week__dot",
                      hasDone(date) ? "planner-week__dot--done"  : "",
                      isT           ? "planner-week__dot--today" : "",
                    ].join(" ")} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="planner-month">
              {monthDays.map(({ date, dow }, i) => {
                const sel: boolean = selectedDate === date;
                const isT: boolean = date === today;
                const sep: boolean = dow === 0 && i > 0;
                return (
                  <div key={date} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {sep && <div className="planner-month__sep" />}
                    <div className="planner-month__day" onClick={() => onSelectDate(date)}>
                      <span className="planner-month__letter">{DAY_LTRS[dow]}</span>
                      <div className={[
                        "planner-month__dot",
                        hasDone(date) ? "planner-month__dot--done"     : "",
                        sel           ? "planner-month__dot--selected" : "",
                        isT           ? "planner-month__dot--today"    : "",
                      ].join(" ")} />
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
// COMPOSANT : MODAL
// ─────────────────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean;
  onClose: () => void;
  habits: Habit[];
  onAdd: (h: Pick<Habit, "nom" | "frequence" | "periode" | "type">) => void;
  onDelete: (id: string) => void;
}

function Modal({ open, onClose, habits, onAdd, onDelete }: ModalProps) {
  const [form, setForm] = useState<FormState>({ nom: "", frequence: "", periode: "", type: "" });
  const nomRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => nomRef.current?.focus(), 100); }, [open]);

  function handleSubmit(): void {
    if (!form.nom.trim()) { nomRef.current?.focus(); return; }
    onAdd({ ...form, nom: form.nom.trim(), periode: form.periode as Habit["periode"] });
    setForm({ nom: "", frequence: "", periode: "", type: "" });
  }

  if (!open) return null;

  const full: boolean = habits.length >= MAX_HABITS;

  const selectFields: SelectField[] = [
    { label: "Fréquence", key: "frequence", opts: ["Quotidien","Hebdomadaire","Mensuel"] },
    { label: "Période",   key: "periode",   opts: ["matin","aprem","soir"] },
    { label: "Type",      key: "type",      opts: ["Santé","Travail","Projet","Sport","Autre"] },
  ];

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal__close" onClick={onClose}>✕</button>

        <div className="modal__form">
          <h2 className="modal__title">
            Nouvelle habitude{" "}
            {full && <span className="modal__title-warning">(max {MAX_HABITS} atteint)</span>}
          </h2>

          <div className="modal__field">
            <label className="modal__label">Nom</label>
            <input
              ref={nomRef}
              type="text"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Ex : Méditation, Course..."
              className="modal__input"
              disabled={full}
            />
          </div>

          {selectFields.map(({ label, key, opts }) => (
            <div key={key} className="modal__field">
              <label className="modal__label">{label}</label>
              <select
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="modal__select"
                disabled={full}
              >
                <option value="">-- Choisir --</option>
                {opts.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          ))}

          <button onClick={handleSubmit} disabled={full} className="modal__submit">
            Enregistrer
          </button>
        </div>

        <div className="modal__list">
          <h3 className="modal__list-title">Habitudes ({habits.length}/{MAX_HABITS})</h3>
          <div className="modal__list-items">
            {habits.length === 0
              ? <p className="modal__empty">Aucune habitude.</p>
              : habits.map((h) => (
                <div key={h.id} className="modal__habit-item">
                  <div>
                    <strong>{h.nom}</strong>
                    <span className="modal__habit-meta">{h.type} · {h.periode} · {h.frequence}</span>
                  </div>
                  <button className="modal__delete-btn" onClick={() => onDelete(h.id)}>✕</button>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : CARD HABITUDE
// ─────────────────────────────────────────────────────────────────────────────

interface HabitCardProps {
  habit: Habit;
  validated: boolean;
  onToggle: (id: string) => void;
  completions: Completion[];
}

function HabitCard({ habit, validated, onToggle, completions }: HabitCardProps) {
  const [pulse, setPulse] = useState<boolean>(false);
  const streak: number = calcStreak(habit.id, completions);
  const palier         = getPalier(streak);

  function handleClick(): void {
    setPulse(true);
    setTimeout(() => setPulse(false), 300);
    onToggle(habit.id);
  }

  return (
    <div
      className={[
        "habit-card",
        validated ? "habit-card--validated" : "",
        pulse     ? "habit-card--pulse"     : "",
      ].join(" ")}
      onClick={handleClick}
    >
      <div className="habit-card__header">
        <strong>{habit.nom}</strong>
        <div className="habit-card__badges">
          {streak > 0 && (
            <span
              className="habit-card__streak-badge"
              style={{
                color:       validated ? "white"                    : palier.couleur,
                background:  validated ? "rgba(255,255,255,0.2)"   : `${palier.couleur}22`,
                borderColor: validated ? "rgba(255,255,255,0.3)"   : palier.couleur,
              }}
            >
              🔥 {streak}j
            </span>
          )}
          <span className="habit-card__check">{validated ? "✓" : "○"}</span>
        </div>
      </div>
      <div className="habit-card__meta">
        {habit.type}{habit.frequence ? ` · ${habit.frequence}` : ""}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : COLONNE BOARD
// ─────────────────────────────────────────────────────────────────────────────

interface ColumnProps {
  title: string;
  habits: Habit[];
  completions: Completion[];
  selectedDate: string;
  onToggle: (id: string) => void;
}

function Column({ title, habits, completions, selectedDate, onToggle }: ColumnProps) {
  const done: number  = habits.filter((h) => completions.some((c) => c.habitId === h.id && c.date === selectedDate)).length;
  const total: number = habits.length;
  const full: boolean = total > 0 && done === total;

  return (
    // ↓ MODIFIÉ : flex column + overflow hidden pour contenir le scroll
    <div className="column" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="column__header">
        <h2 className="column__title">{title}</h2>
        <span className={`column__badge ${full ? "column__badge--full" : ""}`}>{done}/{total}</span>
      </div>
      {/* ↓ MODIFIÉ : scroll uniquement sur la liste des cartes */}
      <div className="column__scroll">
        {habits.length === 0
          ? <div className="column__empty">Aucune habitude</div>
          : habits.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              validated={completions.some((c) => c.habitId === h.id && c.date === selectedDate)}
              onToggle={onToggle}
              completions={completions}
            />
          ))
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : HABIT LIST (colonne gauche)
// ─────────────────────────────────────────────────────────────────────────────

interface HabitListProps {
  habits: Habit[];
  completions: Completion[];
  selectedDate: string;
  onToggle: (id: string) => void;
}

function HabitList({ habits, completions, selectedDate, onToggle }: HabitListProps) {
  const [search, setSearch]         = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");

  const filtered: Habit[] = habits.filter((h) =>
    h.nom.toLowerCase().includes(search.toLowerCase()) && (filterType ? h.type === filterType : true)
  );

  return (
    // ↓ MODIFIÉ : flex column + overflow hidden pour que la liste interne puisse scroller
    <div className="habit-list">
      <h2 className="habit-list__title">Mes Habitudes</h2>
      <input
        type="text"
        placeholder="Rechercher..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="habit-list__search"
      />
      <select
        value={filterType}
        onChange={(e) => setFilterType(e.target.value)}
        className="habit-list__filter"
      >
        <option value="">Tous les types</option>
        {["Santé","Travail","Projet","Sport","Autre"].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <h3 className="habit-list__count">LISTE ({filtered.length})</h3>
      {/* ↓ MODIFIÉ : flex: 1 + overflow-y: auto + minHeight: 0 = scroll interne */}
      <div className="habit-list__items">
        {filtered.map((h) => {
          const val: boolean   = completions.some((c) => c.habitId === h.id && c.date === selectedDate);
          const streak: number = calcStreak(h.id, completions);
          const palier         = getPalier(streak);
          return (
            <div
              key={h.id}
              className={`habit-list__item ${val ? "habit-list__item--validated" : ""}`}
              style={{ borderLeft: `4px solid ${streak > 0 ? palier.couleur : "#eee"}` }}
              onClick={() => onToggle(h.id)}
            >
              <div className="habit-list__item-header">
                <span>{h.nom}</span>
                <span
                  className="habit-list__item-streak"
                  style={{ color: streak > 0 ? palier.couleur : "#bbb" }}
                >
                  {streak > 0 ? `🔥 ${streak}j` : "—"}
                </span>
              </div>
              <div className="habit-list__item-meta">{h.type} · {h.periode} · {h.frequence}</div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="habit-list__empty">Aucune habitude trouvée</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT : XP TOAST
// ─────────────────────────────────────────────────────────────────────────────

interface XPToastProps {
  xp: number;
  visible: boolean;
}

function XPToast({ xp, visible }: XPToastProps) {
  return (
    <div className={`xp-toast ${visible ? "xp-toast--visible" : "xp-toast--hidden"}`}>
      +{xp} XP 🔥
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const { store, addHabit, deleteHabit, toggleValidation, xpInfo } = useStore();
  const [modalOpen, setModalOpen]       = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [toast, setToast]               = useState<ToastState>({ visible: false, xp: 0 });
  const toastTimer                      = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleToggle(habitId: string): void {
    const wasValidated: boolean = store.completions.some((c) => c.habitId === habitId && c.date === selectedDate);
    toggleValidation(habitId, selectedDate);
    if (!wasValidated) {
      const habit: Habit | undefined = store.habits.find((h) => h.id === habitId);
      if (habit) {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ visible: true, xp: habit.xpParValid });
        toastTimer.current = setTimeout(() => setToast({ visible: false, xp: 0 }), 2000);
      }
    }
  }

  const habitsMatin: Habit[] = store.habits.filter((h) => h.periode === "matin");
  const habitsAprem: Habit[] = store.habits.filter((h) => h.periode === "aprem");
  const habitsSoir: Habit[]  = store.habits.filter((h) => h.periode === "soir");

  return (
    <div className="app">
      <AppHeader />
      <FlameLegend />
      <Hero xpInfo={xpInfo} habits={store.habits} completions={store.completions} />
      <Topbar
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onOpenModal={() => setModalOpen(true)}
        completions={store.completions}
      />

      <div className="board">
        <div className="board__sidebar">
          <HabitList
            habits={store.habits}
            completions={store.completions}
            selectedDate={selectedDate}
            onToggle={handleToggle}
          />
        </div>
        <div className="board__columns">
          <Column title="MATIN"      habits={habitsMatin} completions={store.completions} selectedDate={selectedDate} onToggle={handleToggle} />
          <Column title="APRÈS-MIDI" habits={habitsAprem} completions={store.completions} selectedDate={selectedDate} onToggle={handleToggle} />
          <Column title="SOIR"       habits={habitsSoir}  completions={store.completions} selectedDate={selectedDate} onToggle={handleToggle} />
        </div>
      </div>

      <footer className="footer">© 2026 – DailyFlamefezefezfe</footer>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        habits={store.habits}
        onAdd={addHabit}
        onDelete={deleteHabit}
      />
      <XPToast xp={toast.xp} visible={toast.visible} />
    </div>
  );
}

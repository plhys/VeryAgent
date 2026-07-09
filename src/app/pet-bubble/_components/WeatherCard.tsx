"use client"

import { useState, useEffect, useRef } from "react"

function sanitizeSvg(html: string): string {
  if (typeof document === "undefined") return html
  const div = document.createElement("div")
  div.innerHTML = html
  const scripts = div.querySelectorAll("script")
  scripts.forEach((s) => s.remove())
  const events = [
    "onclick",
    "onerror",
    "onload",
    "onmouseover",
    "onfocus",
    "onblur",
  ]
  const allElements = div.querySelectorAll("*")
  allElements.forEach((el) => {
    events.forEach((evt) => el.removeAttribute(evt))
  })
  return div.innerHTML
}

type WeatherType =
  | "sunny"
  | "cloudy"
  | "lightRain"
  | "heavyRain"
  | "stormy"
  | "snowy"
  | "blizzard"
  | "windy"
  | "typhoon"
  | "foggy"

export interface WeatherData {
  city: string
  temperature: number
  condition: string
  type: WeatherType
  humidity: number
  windSpeed: number
  feelsLike: number
}

interface Props {
  data: WeatherData
  onDismiss: () => void
}

const MG = `<defs><linearGradient id="mg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e8e8e8"/><stop offset="50%" stop-color="#a0a0a0"/><stop offset="100%" stop-color="#606060"/></linearGradient></defs>`

const ICONS: Record<WeatherType, string> = {
  sunny: `<svg viewBox="0 0 44 44"><style>@keyframes sBeat{0%,100%{opacity:.5}50%{opacity:1}}</style>${MG}<circle cx="22" cy="22" r="7" fill="url(#mg)" stroke="rgba(255,255,255,0.15)" stroke-width="0.8" opacity="0.8" style="animation:sBeat 2.5s ease-in-out infinite"/><circle cx="22" cy="22" r="3.5" fill="rgba(255,255,255,0.5)"/>${Array.from({ length: 8 }, (_, i) => `<line x1="22" y1="6" x2="22" y2="10" stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-linecap="round" transform="rotate(${i * 45} 22 22)" style="animation:sBeat 1.5s ease-in-out infinite;animation-delay:${i * 0.15}s"/>`).join("")}</svg>`,
  cloudy: `<svg viewBox="0 0 44 44"><style>@keyframes cFloat{0%,100%{transform:translateX(0)}50%{transform:translateX(2px)}}</style>${MG}<g style="animation:cFloat 3s ease-in-out infinite"><ellipse cx="22" cy="26" rx="12" ry="6" fill="url(#mg)" stroke="rgba(255,255,255,0.12)" stroke-width="0.6" opacity="0.5"/><ellipse cx="16" cy="22" rx="7" ry="5" fill="url(#mg)" stroke="rgba(255,255,255,0.12)" stroke-width="0.6" opacity="0.65"/><ellipse cx="26" cy="20" rx="9" ry="6" fill="url(#mg)" stroke="rgba(255,255,255,0.12)" stroke-width="0.6" opacity="0.8"/><ellipse cx="22" cy="24" rx="10" ry="5" fill="url(#mg)" stroke="rgba(255,255,255,0.12)" stroke-width="0.6"/></g></svg>`,
  lightRain: `<svg viewBox="0 0 44 44"><style>@keyframes dFall{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:.7;transform:translateY(3px)}}</style>${MG}<ellipse cx="22" cy="14" rx="10" ry="5" fill="url(#mg)" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" opacity="0.45"/><ellipse cx="17" cy="12" rx="6" ry="4" fill="url(#mg)" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" opacity="0.55"/><ellipse cx="27" cy="12" rx="7" ry="4" fill="url(#mg)" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" opacity="0.55"/>${[0, 1, 2].map((i) => `<line x1="${14 + i * 7}" y1="22" x2="${14 + i * 7}" y2="30" stroke="rgba(255,255,255,0.3)" stroke-width="1.2" stroke-linecap="round" style="animation:dFall ${1 + i * 0.3}s ease-in-out infinite"/>`).join("")}</svg>`,
  heavyRain: `<svg viewBox="0 0 44 44"><style>@keyframes dFall2{0%,100%{opacity:.4;transform:translateY(0)}50%{opacity:.8;transform:translateY(4px)}}</style>${MG}<ellipse cx="22" cy="12" rx="10" ry="5" fill="url(#mg)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5" opacity="0.35"/><ellipse cx="17" cy="10" rx="6" ry="4" fill="url(#mg)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5" opacity="0.45"/><ellipse cx="27" cy="10" rx="7" ry="4" fill="url(#mg)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5" opacity="0.45"/>${[0, 1, 2, 3].map((i) => `<line x1="${10 + i * 7}" y1="20" x2="${10 + i * 7}" y2="30" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-linecap="round" style="animation:dFall2 ${0.8 + i * 0.2}s ease-in-out infinite"/>`).join("")}</svg>`,
  stormy: `<svg viewBox="0 0 44 44"><style>@keyframes bFlash{0%,85%,100%{opacity:.2}90%{opacity:.9}92%{opacity:.2}94%{opacity:.6}}</style>${MG}<ellipse cx="22" cy="12" rx="10" ry="5" fill="url(#mg)" stroke="rgba(255,255,255,0.06)" stroke-width="0.5" opacity="0.35"/><ellipse cx="17" cy="10" rx="6" ry="4" fill="url(#mg)" stroke="rgba(255,255,255,0.06)" stroke-width="0.5" opacity="0.45"/><ellipse cx="27" cy="10" rx="7" ry="4" fill="url(#mg)" stroke="rgba(255,255,255,0.06)" stroke-width="0.5" opacity="0.45"/><path d="M22 18 L19 25 L24 25 L20 34 L30 24 L25 24 L28 18 Z" fill="rgba(255,255,255,0.3)" style="animation:bFlash 2.5s ease-out infinite"/></svg>`,
  snowy: `<svg viewBox="0 0 44 44"><style>@keyframes snRot{to{transform:rotate(360deg)}}</style>${MG}<g style="transform-origin:22px 22px;animation:snRot 8s linear infinite">${Array.from({ length: 6 }, (_, i) => `<g transform="rotate(${i * 60} 22 22)"><line x1="22" y1="10" x2="22" y2="34" stroke="rgba(255,255,255,0.22)" stroke-width="1"/><line x1="22" y1="14" x2="18" y2="18" stroke="rgba(255,255,255,0.16)" stroke-width="0.7"/><line x1="22" y1="14" x2="26" y2="18" stroke="rgba(255,255,255,0.16)" stroke-width="0.7"/></g>`).join("")}</g><circle cx="22" cy="22" r="2.5" fill="url(#mg)" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/></svg>`,
  blizzard: `<svg viewBox="0 0 44 44"><style>@keyframes snRot2{to{transform:rotate(360deg)}}</style>${MG}<g style="transform-origin:22px 22px;animation:snRot2 5s linear infinite">${Array.from({ length: 6 }, (_, i) => `<g transform="rotate(${i * 60} 22 22)"><line x1="22" y1="10" x2="22" y2="34" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/><line x1="22" y1="14" x2="18" y2="18" stroke="rgba(255,255,255,0.22)" stroke-width="0.8"/><line x1="22" y1="14" x2="26" y2="18" stroke="rgba(255,255,255,0.22)" stroke-width="0.8"/></g>`).join("")}</g><circle cx="22" cy="22" r="3" fill="url(#mg)" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/></svg>`,
  windy: `<svg viewBox="0 0 44 44"><style>@keyframes wDash{0%,100%{stroke-dashoffset:80}50%{stroke-dashoffset:0}}</style>${MG}<path d="M6 14 Q20 11 32 14 Q40 16 40 20" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="40 40" style="animation:wDash 2s linear infinite"/><path d="M4 22 Q16 19 28 22 Q36 24 36 28" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="40 40" style="animation:wDash 2.5s linear infinite;animation-delay:.4s"/><path d="M8 30 Q18 27 26 30 Q34 32 34 36" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="40 40" style="animation:wDash 2s linear infinite;animation-delay:.8s"/></svg>`,
  typhoon: `<svg viewBox="0 0 44 44"><style>@keyframes tySpin{to{transform:rotate(360deg)}}</style>${MG}<g style="transform-origin:22px 22px;animation:tySpin 4s linear infinite"><circle cx="22" cy="22" r="14" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="0.8"/><path d="M16 8 Q28 12 22 22 Q16 32 30 36" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-linecap="round"/><path d="M12 14 Q26 18 20 28 Q14 38 32 40" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" stroke-linecap="round"/></g><circle cx="22" cy="22" r="3" fill="url(#mg)" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/></svg>`,
  foggy: `<svg viewBox="0 0 44 44"><style>@keyframes fFloat{0%,100%{opacity:.3;transform:translateX(-2px)}50%{opacity:.55;transform:translateX(2px)}}</style>${MG}${[0, 1, 2, 3].map((i) => `<line x1="${7 + i * 1.5}" y1="${12 + i * 7}" x2="${37 - i * 1.5}" y2="${12 + i * 7}" stroke="rgba(255,255,255,0.28)" stroke-width="1.5" stroke-linecap="round" style="animation:fFloat ${3 + i * 0.5}s ease-in-out infinite;animation-delay:${i * 0.3}s"/>`).join("")}</svg>`,
}

const TRANSITION = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"

function cardStyle(hovered: boolean): React.CSSProperties {
  return {
    width: 200,
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
    userSelect: "none",
    cursor: "pointer",
    pointerEvents: "auto",
    background:
      "linear-gradient(160deg, #2a2a2a 0%, #1e1e1e 40%, #181818 100%)",
    border: hovered
      ? "1px solid rgba(255,255,255,0.22)"
      : "1px solid rgba(255,255,255,0.08)",
    boxShadow: hovered
      ? "0 4px 12px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4)"
      : "0 4px 10px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.35)",
    transition: TRANSITION,
  }
}

const S = {
  inner: {
    position: "relative" as const,
    zIndex: 2,
    padding: "16px 14px 14px",
  },
  cityRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  city: {
    fontSize: 12,
    fontWeight: 600,
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 0.4,
  },
  time: { fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.4)" },
  main: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  iconWrap: {
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  tempBlock: { textAlign: "right" as const },
  temp: {
    fontSize: 42,
    fontWeight: 200,
    lineHeight: 1,
    color: "rgba(255,255,255,0.88)",
    letterSpacing: -2,
  },
  unit: {
    fontSize: 15,
    fontWeight: 200,
    color: "rgba(255,255,255,0.45)",
    verticalAlign: "super",
  },
  desc: {
    fontSize: 11,
    fontWeight: 500,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 2,
  },
  feels: {
    fontSize: 10,
    color: "rgba(255,255,255,0.35)",
    marginBottom: 10,
  },
  divider: {
    height: 1,
    background:
      "linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent)",
    marginBottom: 10,
  },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  cell: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 8px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.05)",
  },
  cellLabel: { fontSize: 9, color: "rgba(255,255,255,0.35)" },
  cellValue: {
    fontSize: 11,
    color: "rgba(255,255,255,0.65)",
    fontWeight: 500,
  },
  animLayer: {
    position: "absolute" as const,
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none" as const,
    borderRadius: 18,
  },
  topLine: {
    position: "absolute" as const,
    top: 0,
    left: 14,
    right: 14,
    height: 1,
    zIndex: 10,
    background:
      "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
  },
}

// Keyframe animations for weather particles. These must be defined once
// so every particle can reference them by name from inline styles.
const WEATHER_KEYFRAMES = `
@keyframes rainDrop {
  0%   { transform: translateY(0); opacity: 0; }
  10%  { opacity: 1; }
  100% { transform: translateY(220px); opacity: 0; }
}
@keyframes snowDrift {
  0%   { transform: translateY(0) translateX(0); opacity: 0; }
  10%  { opacity: 1; }
  100% { transform: translateY(220px) translateX(15px); opacity: 0; }
}
@keyframes windBlow {
  0%   { transform: translateX(0); opacity: 0; }
  20%  { opacity: 1; }
  100% { transform: translateX(280px); opacity: 0; }
}
@keyframes fogFloat {
  0%   { transform: translateX(-8px); opacity: 0.3; }
  50%  { transform: translateX(8px); opacity: 0.55; }
  100% { transform: translateX(-8px); opacity: 0.3; }
}
`

function AnimLayer({ type }: { type: WeatherType }) {
  const particles = useRef<React.ReactNode[]>([])
  if (particles.current.length === 0) {
    const p: React.ReactNode[] = []
    const D = (style: React.CSSProperties) => <div key={p.length} style={style} />
    if (type === "lightRain") {
      for (let i = 0; i < 10; i++)
        p.push(
          D({
            position: "absolute",
            top: -6,
            width: 1,
            height: 12,
            left: `${6 + i * 10}%`,
            animation: `rainDrop ${0.8 + i * 0.04}s linear infinite`,
            animationDelay: `${i * 0.12}s`,
            background:
              "linear-gradient(to bottom, transparent, rgba(200,210,230,0.4))",
            borderRadius: 1,
          })
        )
    } else if (type === "heavyRain") {
      for (let i = 0; i < 22; i++)
        p.push(
          D({
            position: "absolute",
            top: -6,
            width: 1.5,
            height: 16,
            left: `${Math.random() * 100}%`,
            animation: `rainDrop ${0.5 + Math.random() * 0.3}s linear infinite`,
            animationDelay: `${Math.random() * 0.5}s`,
            background:
              "linear-gradient(to bottom, transparent, rgba(180,195,220,0.5))",
            borderRadius: 1,
          })
        )
    } else if (type === "stormy") {
      for (let i = 0; i < 22; i++)
        p.push(
          D({
            position: "absolute",
            top: -6,
            width: 1.5,
            height: 16,
            left: `${Math.random() * 100}%`,
            animation: `rainDrop ${0.4 + Math.random() * 0.25}s linear infinite`,
            animationDelay: `${Math.random() * 0.5}s`,
            background:
              "linear-gradient(to bottom, transparent, rgba(180,195,220,0.5))",
            borderRadius: 1,
          })
        )
    } else if (type === "snowy") {
      for (let i = 0; i < 18; i++)
        p.push(
          D({
            position: "absolute",
            top: -6,
            width: 3,
            height: 3,
            left: `${Math.random() * 100}%`,
            animation: `snowDrift ${4 + Math.random() * 2}s linear infinite`,
            animationDelay: `${Math.random() * 5}s`,
            background: "rgba(255,255,255,0.5)",
            borderRadius: "50%",
            boxShadow: "0 0 4px rgba(255,255,255,0.15)",
          })
        )
    } else if (type === "blizzard") {
      for (let i = 0; i < 28; i++)
        p.push(
          D({
            position: "absolute",
            top: -6,
            width: 4,
            height: 4,
            left: `${Math.random() * 100}%`,
            animation: `snowDrift ${2 + Math.random() * 1.5}s linear infinite`,
            animationDelay: `${Math.random() * 3}s`,
            background: "rgba(255,255,255,0.65)",
            borderRadius: "50%",
            boxShadow: "0 0 6px rgba(255,255,255,0.2)",
          })
        )
    } else if (type === "windy") {
      for (let i = 0; i < 6; i++)
        p.push(
          D({
            position: "absolute",
            left: -40,
            height: 1,
            top: `${14 + i * 15}%`,
            width: `${50 + Math.random() * 30}px`,
            animation: `windBlow ${1.4 + Math.random() * 0.5}s linear infinite`,
            animationDelay: `${i * 0.3}s`,
            background:
              "linear-gradient(to right, transparent, rgba(255,255,255,0.18), transparent)",
            borderRadius: 1,
          })
        )
    } else if (type === "typhoon") {
      for (let i = 0; i < 25; i++)
        p.push(
          D({
            position: "absolute",
            top: -6,
            width: 1.5,
            height: 14,
            left: `${Math.random() * 100}%`,
            animation: `rainDrop ${0.3 + Math.random() * 0.2}s linear infinite`,
            animationDelay: `${Math.random() * 0.4}s`,
            background:
              "linear-gradient(to bottom, transparent, rgba(180,200,230,0.45))",
            borderRadius: 1,
          })
        )
      for (let i = 0; i < 4; i++)
        p.push(
          D({
            position: "absolute",
            left: -40,
            height: 1,
            top: `${14 + i * 18}%`,
            width: `${60 + Math.random() * 40}px`,
            animation: `windBlow ${1 + Math.random() * 0.4}s linear infinite`,
            animationDelay: `${i * 0.2}s`,
            background:
              "linear-gradient(to right, transparent, rgba(255,255,255,0.18), transparent)",
            borderRadius: 1,
          })
        )
    } else if (type === "foggy") {
      for (let i = 0; i < 4; i++)
        p.push(
          D({
            position: "absolute",
            left: 0,
            right: 0,
            height: 28,
            top: `${i * 22}%`,
            animation: `fogFloat ${3 + i * 0.5}s ease-in-out infinite`,
            animationDelay: `${i * 0.9}s`,
            background:
              "linear-gradient(to right, transparent, rgba(200,200,210,0.05), transparent)",
            borderRadius: 14,
          })
        )
    }
    particles.current = p
  }
  return (
    <div style={S.animLayer}>
      <style>{WEATHER_KEYFRAMES}</style>
      {particles.current}
      {type === "stormy" && <StormFlash />}
    </div>
  )
}

function StormFlash() {
  const [v, setV] = useState(false)
  useEffect(() => {
    const t = setInterval(() => {
      setV(true)
      setTimeout(() => setV(false), 60)
    }, 2200 + Math.random() * 1500)
    return () => clearInterval(t)
  }, [])
  return (
    <>
      {v && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            background: "rgba(255,255,255,0.06)",
            pointerEvents: "none",
          }}
        />
      )}
    </>
  )
}

export function WeatherCard({ data, onDismiss }: Props) {
  const [time, setTime] = useState("")
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    const u = () => {
      const n = new Date()
      setTime(
        `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`
      )
    }
    u()
    const t = setInterval(u, 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div
      style={cardStyle(hovered)}
      onClick={onDismiss}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={S.topLine} />
      <AnimLayer type={data.type} />
      <div style={S.inner}>
        <div style={S.cityRow}>
          <span style={S.city}>{data.city}</span>
          <span style={S.time}>{time}</span>
        </div>
        <div style={S.main}>
          <div
            style={S.iconWrap}
            dangerouslySetInnerHTML={{
              __html: sanitizeSvg(ICONS[data.type] || ""),
            }}
          />
          <div style={S.tempBlock}>
            <span style={S.temp}>{data.temperature}</span>
            <span style={S.unit}>°</span>
          </div>
        </div>
        <div style={S.desc}>{data.condition}</div>
        <div style={S.feels}>体感 {data.feelsLike}°</div>
        <div style={S.divider} />
        <div style={S.grid}>
          <div style={S.cell}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="1.5"
            >
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            </svg>
            <div>
              <div style={S.cellLabel}>湿度</div>
              <div style={S.cellValue}>{data.humidity}%</div>
            </div>
          </div>
          <div style={S.cell}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="1.5"
            >
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 8.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
            </svg>
            <div>
              <div style={S.cellLabel}>风速</div>
              <div style={S.cellValue}>{data.windSpeed}km/h</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

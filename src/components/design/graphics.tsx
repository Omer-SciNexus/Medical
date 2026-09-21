import { useId } from "react";

/** Small inline vectors keep the visual identity sharp without image downloads. */
export function MeridianMark({ className = "" }: { className?: string }) {
  return <svg className={`meridian-mark ${className}`} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M20 4v32M4 20h32" stroke="currentColor" strokeWidth="2.2" />
    <path d="M10 10h10a10 10 0 0 1 10 10v10H20A10 10 0 0 1 10 20V10Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M30 10v10a10 10 0 0 1-10 10H10V20a10 10 0 0 1 10-10h10Z" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="20" cy="20" r="3" fill="currentColor" stroke="none" />
  </svg>;
}

export function CareGraphic() {
  const patternId = useId();
  return <figure className="care-art" aria-label="Meridian graphic: connected paths meet around a central care symbol">
    <div className="care-art-header"><span>Connected by care</span><span className="mono">M / 01</span></div>
    <svg className="care-art-drawing" viewBox="0 0 440 260" fill="none" aria-hidden="true">
      <defs><pattern id={patternId} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.65" fill="currentColor" opacity="0.2" /></pattern></defs>
      <rect width="440" height="260" fill={`url(#${patternId})`} />
      <path d="M220 10v240M25 130h390" stroke="currentColor" strokeOpacity="0.16" strokeDasharray="3 5" />
      <g transform="translate(220 129) rotate(-32)" stroke="currentColor" strokeWidth="0.8">
        {Array.from({ length: 15 }, (_, i) => <ellipse key={i} rx={132 - i * 1.4} ry={37 + i * 4.2} strokeOpacity={0.26 + i * 0.025} />)}
      </g>
      <g transform="translate(220 129) rotate(58)" stroke="currentColor" strokeWidth="0.75">
        {Array.from({ length: 10 }, (_, i) => <ellipse key={i} rx={116 - i * 1.5} ry={31 + i * 4.7} strokeOpacity={0.23 + i * 0.04} />)}
      </g>
      <circle cx="220" cy="129" r="36" className="art-disc" stroke="currentColor" strokeWidth="0.7" />
      <path d="M212 108h16v13h13v16h-13v13h-16v-13h-13v-16h13v-13Z" fill="currentColor" stroke="none" />
      <circle cx="94" cy="166" r="4" fill="currentColor" stroke="none" /><circle cx="339" cy="99" r="4" fill="currentColor" stroke="none" />
      <path d="M37 33h14M44 26v14M389 218h14M396 211v14" stroke="currentColor" strokeWidth="1" strokeOpacity="0.7" />
      <path d="M78 176l-19 19H28M347 87l20-20h45" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.55" />
    </svg>
    <figcaption><span>Many moments.<br /><strong>One connected experience.</strong></span><span className="art-coordinate mono">41° 00′ N<br />28° 58′ E</span></figcaption>
  </figure>;
}

export function AppointmentGraphic({ time }: { time: string }) {
  return <div className="appointment-art" aria-hidden="true"><svg viewBox="0 0 260 150" fill="none">
    <path d="M18 112c22 0 22-68 55-68h42M167 110h31c25 0 24-67 46-67" stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 4" />
    <circle cx="25" cy="112" r="5" fill="currentColor" stroke="none" /><circle cx="235" cy="43" r="6" stroke="currentColor" />
    <rect x="63" y="21" width="138" height="114" rx="6" className="appointment-art-paper" stroke="currentColor" strokeOpacity="0.35" />
    <path d="M63 52h138M88 13v17M176 13v17" stroke="currentColor" strokeWidth="1.5" />
    <text x="79" y="43" className="appointment-art-label" fill="currentColor" stroke="none">SEPTEMBER</text>
    <text x="78" y="94" className="appointment-art-date mono" fill="currentColor" stroke="none">21</text>
    <text x="81" y="117" className="appointment-art-label" fill="currentColor" stroke="none">MONDAY</text>
    <rect x="135" y="72" width="86" height="37" rx="5" className="appointment-art-ticket" stroke="currentColor" strokeWidth="1" />
    <text x="147" y="95" className="appointment-art-time mono" fill="currentColor" stroke="none">{time}</text>
    <path d="m207 86 3 3 5-6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M33 40h10M38 35v10M224 127h10M229 122v10" stroke="currentColor" strokeOpacity="0.5" />
  </svg></div>;
}

export function PressureTrend({ readings, high }: { readings: number[]; high: boolean }) {
  const points = readings.map((reading, index) => `${22 + index * 64},${70 - (reading - 100) * 0.78}`).join(" ");
  const lastX = 22 + (readings.length - 1) * 64;
  const lastY = 70 - (readings.at(-1)! - 100) * 0.78;
  return <figure className="pressure-trend"><figcaption><span>Systolic pressure</span><span className="mono">mmHg</span></figcaption><svg viewBox="0 0 256 96" role="img" aria-label={`Synthetic systolic blood pressure readings from June through September: ${readings.join(", ")} millimeters of mercury.`}>
    <path d="M16 23h208M16 46h208M16 70h208" fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" />
    <text x="231" y="26" className="trend-axis">160</text><text x="231" y="49" className="trend-axis">130</text><text x="231" y="73" className="trend-axis">100</text>
    <polyline points={points} fill="none" stroke="var(--ink-600)" strokeWidth="1.6" strokeLinejoin="round" />
    {readings.map((value, index) => <circle key={index} cx={22 + index * 64} cy={70 - (value - 100) * 0.78} r="2.5" fill="var(--paper)" stroke="var(--ink-600)" strokeWidth="1.3" />)}
    <circle cx={lastX} cy={lastY} r="3" fill={high ? "var(--high-text)" : "var(--ink-900)"} stroke="var(--paper)" strokeWidth="1" />
    {["Jun", "Jul", "Aug", "Sep"].map((month, index) => <text key={month} x={22 + index * 64} y="92" textAnchor="middle" className="trend-axis">{month}</text>)}
  </svg></figure>;
}

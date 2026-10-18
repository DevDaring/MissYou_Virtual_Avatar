/**
 * A quiet riverside ghat at dusk: steps down to the water, a banyan tree,
 * a lamp-post, a small chhatri, a far shore with a temple spire, a boat,
 * and three floating diyas. Purely decorative.
 */
export function HorizonSilhouette({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 260"
      preserveAspectRatio="xMinYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hz-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2250" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#14102a" stopOpacity="0.95" />
          <stop offset="1" stopColor="#0b0818" />
        </linearGradient>
        <linearGradient id="hz-shore" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#241d47" />
          <stop offset="1" stopColor="#1b1538" />
        </linearGradient>
        <radialGradient id="hz-lamp">
          <stop offset="0" stopColor="#fbd0a6" stopOpacity="0.9" />
          <stop offset="0.25" stopColor="#f7b07c" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f7b07c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hz-reflect" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7b07c" stopOpacity="0.5" />
          <stop offset="1" stopColor="#f7b07c" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* far shore with treeline and a temple spire */}
      <path
        fill="url(#hz-shore)"
        d="M0 168 C60 160 110 164 160 158 C220 151 260 160 320 156 C400 150 460 158 520 154 C600 149 650 157 720 152 C790 147 850 155 920 150 C960 147 990 151 1020 149 L1040 149 L1046 128 L1052 118 L1058 104 L1064 118 L1070 128 L1076 149 L1100 149 C1150 146 1200 152 1260 148 C1330 143 1390 150 1440 147 L1440 176 L0 176Z"
      />
      <path fill="#2a2250" opacity="0.6" d="M1058 96 l2 8 h-4z" />

      {/* river */}
      <rect x="0" y="172" width="1440" height="88" fill="url(#hz-water)" />
      <g className="hz-shimmer" stroke="#d2c7ff" strokeLinecap="round" opacity="0.18">
        <path d="M560 188 h80 M700 196 h46 M820 190 h70 M980 202 h60 M620 214 h40 M1140 194 h54 M1260 210 h70 M760 226 h50" strokeWidth="1.4" />
      </g>

      {/* boat on the river */}
      <g fill="#0f0b22" opacity="0.9">
        <path d="M1150 196 C1175 206 1235 206 1262 196 L1254 202 C1230 210 1180 210 1158 202Z" />
        <path d="M1188 196 C1192 182 1218 182 1224 196Z" />
        <rect x="1205" y="160" width="2" height="36" />
      </g>

      {/* floating diyas with reflections */}
      <g className="hz-diyas">
        {[
          [668, 206],
          [742, 216],
          [810, 202],
        ].map(([x, y]) => (
          <g key={x}>
            <circle cx={x} cy={y - 4} r="16" fill="url(#hz-lamp)" />
            <rect x={x - 2} y={y + 3} width="4" height="22" fill="url(#hz-reflect)" />
            <path d={`M${x - 6} ${y} q6 5 12 0z`} fill="#3a2a40" />
            <path className="hz-flame" d={`M${x} ${y - 7} q3 4 0 7 q-3 -3 0 -7z`} fill="#fbd0a6" />
          </g>
        ))}
      </g>

      {/* ghat steps */}
      <path
        fill="#0b0818"
        d="M0 128 H372 V136 H404 V146 H436 V156 H468 V166 H500 V176 H532 V186 H560 V260 H0Z"
      />
      <path fill="#14102a" opacity="0.7" d="M372 136 h32 v2 h-32z M404 146 h32 v2 h-32z M436 156 h32 v2 h-32z M468 166 h32 v2 h-32z M500 176 h32 v2 h-32z" />

      {/* chhatri pavilion */}
      <g fill="#0b0818">
        <path d="M214 96 C214 80 232 70 246 66 C260 70 278 80 278 96Z" />
        <rect x="244" y="58" width="4" height="10" />
        <rect x="208" y="96" width="76" height="6" />
        <rect x="214" y="102" width="5" height="26" />
        <rect x="243" y="102" width="5" height="26" />
        <rect x="272" y="102" width="5" height="26" />
      </g>

      {/* lamp-post with a warm light */}
      <g>
        <circle className="hz-lamp" cx="338" cy="58" r="34" fill="url(#hz-lamp)" />
        <rect x="336.5" y="62" width="3" height="66" fill="#0b0818" />
        <path d="M330 64 h16 l-3 -5 h-10z" fill="#0b0818" />
        <circle cx="338" cy="56" r="3.4" fill="#fbd0a6" />
        <path d="M331 52 h14 l-7 -6z" fill="#0b0818" />
      </g>

      {/* banyan tree */}
      <g fill="#0b0818" transform="translate(100 128) scale(0.8) translate(-100 -128)">
        <path d="M86 128 C90 100 92 80 88 58 L100 58 C98 82 102 104 108 128Z" />
        <path d="M94 74 C80 70 66 64 58 52 L62 50 C72 60 84 64 96 68Z" />
        <path d="M98 70 C114 64 128 56 136 46 L140 49 C130 60 116 68 100 76Z" />
        <path d="M20 66 C6 58 8 36 30 34 C34 18 58 10 74 20 C84 4 116 2 128 18 C146 10 172 20 170 40 C190 44 192 66 172 72 C160 82 136 78 126 72 C112 82 84 82 70 74 C56 82 30 80 20 66Z" />
        <path d="M44 72 v40 M60 76 v32 M140 76 v36 M156 72 v28" stroke="#0b0818" strokeWidth="1.5" />
      </g>
    </svg>
  )
}

export default HorizonSilhouette

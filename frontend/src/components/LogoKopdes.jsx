// Logo resmi KOPDES MERAH PUTIH — SVG disalin setia dari renderKopdesLogos() di index.html.
// Gradient diberi sufiks ukuran agar id unik saat dipakai dua slot (lg di login, sm di sidebar).
export default function LogoKopdes({ size = 'sm' }) {
  const dims = size === 'lg' ? 'h-16 sm:h-20 w-auto' : 'h-11 w-auto';
  return (
    <svg
      viewBox="0 0 340 215"
      className={`${dims} select-none`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Logo Kopdes Merah Putih"
    >
      <defs>
        <linearGradient id={`kopdesRedGrad-${size}`} x1="40" y1="60" x2="290" y2="195" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E1252C" />
          <stop offset="100%" stopColor="#B8161C" />
        </linearGradient>
        <linearGradient id={`flagRedGrad-${size}`} x1="115" y1="12" x2="165" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EE2B33" />
          <stop offset="100%" stopColor="#C81920" />
        </linearGradient>
      </defs>
      <line x1="163" y1="14" x2="163" y2="54" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="163" cy="12" r="3.5" fill="#94A3B8" />
      <path d="M122 14 C134 19, 146 9, 162 15 L162 28 C146 22, 134 32, 122 27 Z" fill={`url(#flagRedGrad-${size})`} />
      <path d="M122 27 C134 32, 146 22, 162 28 L162 41 C146 35, 134 45, 122 40 Z" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="0.8" />
      <rect x="108" y="106" width="12" height="12" rx="1.5" fill="#E2E8F0" />
      <rect x="124" y="106" width="12" height="12" rx="1.5" fill="#E2E8F0" />
      <rect x="108" y="122" width="12" height="12" rx="1.5" fill="#E2E8F0" />
      <rect x="124" y="122" width="12" height="12" rx="1.5" fill="#E2E8F0" />
      <path d="M164 49 L52 114 C56 122, 65 125, 74 123 L74 185 C74 190, 78 193, 83 193 L296 193 C301 193, 304 189, 304 184 C304 179, 301 176, 296 176 L92 176 L92 112 L147 79 L147 135 C147 146, 155 152, 164 152 Z" fill={`url(#kopdesRedGrad-${size})`} />
      <text x="171" y="96" fill={`url(#kopdesRedGrad-${size})`} fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="52" letterSpacing="1.5">KOP</text>
      <text x="171" y="146" fill={`url(#kopdesRedGrad-${size})`} fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="52" letterSpacing="1.5">DES</text>
      <text x="172" y="168" fill="#111827" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="16.5" letterSpacing="1.2">MERAH PUTIH</text>
    </svg>
  );
}

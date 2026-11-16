// Ilustrasi belanja warga pada halaman login â€” SVG disalin setia dari index.html referensi.
export default function LoginIllustration() {
  return (
    <div className="relative w-full max-w-[470px] aspect-[1.12/1] flex items-center justify-center select-none">
      <svg viewBox="0 0 560 500" className="w-full h-full overflow-visible" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <linearGradient id="blobOuterGrad" x1="60" y1="60" x2="490" y2="450" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stopColor="#FAD4D6"/>
                                <stop offset="100%" stopColor="#F29EA3"/>
                            </linearGradient>
                            <linearGradient id="blobInnerGrad" x1="120" y1="100" x2="420" y2="400" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stopColor="#FDECEC"/>
                                <stop offset="100%" stopColor="#F9C5C8"/>
                            </linearGradient>
                            <linearGradient id="bagGrad" x1="210" y1="170" x2="335" y2="355" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stopColor="#F6D5A8"/>
                                <stop offset="100%" stopColor="#E5B172"/>
                            </linearGradient>
                            <linearGradient id="bagSideGrad" x1="315" y1="185" x2="352" y2="355" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stopColor="#DFA563"/>
                                <stop offset="100%" stopColor="#C88A47"/>
                            </linearGradient>
                        </defs>

                        <path d="M128 96C184 52 288 64 362 94C436 124 504 176 502 256C500 336 436 392 362 426C288 460 186 476 116 430C46 384 36 286 52 208C68 130 72 140 128 96Z" fill="url(#blobOuterGrad)" opacity="0.82"/>
                        <path d="M168 134C214 102 292 108 350 132C408 156 452 204 446 266C440 328 386 368 326 392C266 416 188 418 140 378C92 338 92 264 108 206C124 148 122 166 168 134Z" fill="url(#blobInnerGrad)"/>

                        <circle cx="54" cy="144" r="18" fill="#F8B4B8" opacity="0.65"/>
                        <circle cx="222" cy="52" r="11" fill="#F8B4B8" opacity="0.55"/>
                        <circle cx="484" cy="146" r="22" fill="#FAD4D6" opacity="0.7"/>
                        <circle cx="478" cy="396" r="24" fill="#F8B4B8" opacity="0.55"/>
                        <circle cx="318" cy="468" r="12" fill="#F8B4B8" opacity="0.6"/>
                        <circle cx="88" cy="364" r="14" fill="#FAD4D6" opacity="0.65"/>

                        <ellipse cx="285" cy="364" rx="142" ry="12" fill="#D61F26" opacity="0.14"/>
                        <ellipse cx="152" cy="452" rx="76" ry="7" fill="#D61F26" opacity="0.18"/>

                        <g transform="rotate(-14 252 160)">
                            <rect x="238" y="102" width="28" height="105" rx="14" fill="#E89E4C" stroke="#C57B2B" strokeWidth="2"/>
                            <path d="M244 124L258 118M244 142L258 136M244 160L258 154" stroke="#B66B1E" strokeWidth="2.5" strokeLinecap="round"/>
                        </g>
                        <path d="M276 178C268 144 282 118 298 116C314 114 322 142 308 178Z" fill="#2E9E5B"/>
                        <path d="M294 178C292 148 310 126 324 128C338 130 336 158 318 180Z" fill="#1F7A44"/>
                        <rect x="210" y="138" width="42" height="68" rx="6" fill="#FFFFFF" stroke="#D61F26" strokeWidth="2"/>
                        <rect x="210" y="138" width="42" height="22" rx="4" fill="#D61F26"/>
                        <text x="231" y="153" textAnchor="middle" fill="#FFFFFF" fontSize="8" fontWeight="800" fontFamily="Plus Jakarta Sans, sans-serif">BERAS</text>
                        <text x="231" y="172" textAnchor="middle" fill="#D61F26" fontSize="7" fontWeight="800" fontFamily="Plus Jakarta Sans, sans-serif">5 KG</text>

                        <polygon points="212,184 320,184 326,356 206,356" fill="url(#bagGrad)"/>
                        <polygon points="320,184 348,194 352,346 326,356" fill="url(#bagSideGrad)"/>
                        <polygon points="212,184 320,184 316,198 216,198" fill="#DFAA6B"/>
                        <rect x="234" y="226" width="64" height="34" rx="6" fill="#FFFFFF" opacity="0.92"/>
                        <rect x="234" y="226" width="64" height="14" rx="4" fill="#D61F26"/>
                        <text x="266" y="236" textAnchor="middle" fill="#FFFFFF" fontSize="7.5" fontWeight="800" fontFamily="Plus Jakarta Sans, sans-serif">KOPDES</text>
                        <text x="266" y="252" textAnchor="middle" fill="#111827" fontSize="7" fontWeight="800" fontFamily="Plus Jakarta Sans, sans-serif">MART DIY</text>

                        <rect x="166" y="258" width="34" height="94" rx="4" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5"/>
                        <polygon points="166,258 183,242 200,258" fill="#E2E8F0"/>
                        <rect x="166" y="284" width="34" height="24" fill="#D61F26"/>
                        <text x="183" y="299" textAnchor="middle" fill="#FFFFFF" fontSize="7" fontWeight="800">SUSU</text>

                        <rect x="204" y="278" width="26" height="74" rx="8" fill="#FBBF24" stroke="#D97706" strokeWidth="1.5"/>
                        <rect x="212" y="266" width="10" height="12" rx="2" fill="#D61F26"/>
                        <rect x="206" y="302" width="22" height="20" fill="#FFFFFF" opacity="0.85"/>

                        <rect x="236" y="284" width="24" height="68" rx="7" fill="#7F1016"/>
                        <rect x="243" y="268" width="10" height="16" rx="2" fill="#D61F26"/>
                        <rect x="238" y="306" width="20" height="18" fill="#FEF2F2"/>

                        <rect x="216" y="344" width="76" height="14" rx="4" fill="#D97706"/>
                        <circle cx="228" cy="342" r="7" fill="#FDE68A"/>
                        <circle cx="242" cy="342" r="7" fill="#FCD34D"/>
                        <circle cx="256" cy="342" r="7" fill="#FDE68A"/>
                        <circle cx="270" cy="342" r="7" fill="#FCD34D"/>
                        <circle cx="282" cy="342" r="7" fill="#FDE68A"/>

                        <circle cx="378" cy="316" r="42" fill="#15803D"/>
                        <path d="M356 280C346 302 346 330 356 352M378 274C372 302 372 330 378 358M400 280C408 302 408 330 400 352" stroke="#052E16" strokeWidth="4" strokeLinecap="round"/>

                        <path d="M312 348C328 356 350 352 362 338C348 344 330 344 316 336Z" fill="#FACC15" stroke="#CA8A04" strokeWidth="1.5"/>
                        <circle cx="376" cy="346" r="13" fill="#D61F26"/>
                        <path d="M376 333C378 327 383 326 385 328" stroke="#15803D" strokeWidth="2.5" strokeLinecap="round"/>

                        <g transform="translate(68, 305)">
                            <path d="M36 92L16 138" stroke="#1E293B" strokeWidth="9" strokeLinecap="round"/>
                            <path d="M46 92L54 140" stroke="#0F172A" strokeWidth="9" strokeLinecap="round"/>
                            <rect x="6" y="135" width="16" height="7" rx="3.5" fill="#D61F26"/>
                            <rect x="48" y="137" width="16" height="7" rx="3.5" fill="#D61F26"/>
                            <path d="M28 46C28 38 52 38 52 46L55 94H26Z" fill="#D61F26"/>
                            <circle cx="41" cy="22" r="12" fill="#FDBA74"/>
                            <path d="M29 20C29 10 49 8 53 18C47 15 36 16 29 20Z" fill="#451A03"/>
                            <path d="M46 52L76 66" stroke="#FDBA74" strokeWidth="7" strokeLinecap="round"/>
                            <path d="M74 64H84L94 114H142L150 74H86" stroke="#475569" strokeWidth="3" fill="none" strokeLinejoin="round"/>
                            <path d="M90 88H147M92 101H144M106 74V114M124 74V114" stroke="#94A3B8" strokeWidth="2"/>
                            <rect x="94" y="60" width="16" height="26" rx="3" fill="#D61F26"/>
                            <rect x="113" y="56" width="18" height="30" rx="3" fill="#F59E0B"/>
                            <circle cx="136" cy="68" r="10" fill="#16A34A"/>
                            <circle cx="98" cy="126" r="5" fill="#1E293B"/>
                            <circle cx="138" cy="126" r="5" fill="#1E293B"/>
                            <path d="M94 114L96 121M142 114L140 121" stroke="#475569" strokeWidth="2.5"/>
                        </g>
                    </svg>
    </div>
  );
}

type FeloxiLogoProps = {
  className?: string;
  size?: number;
};

export function FeloxiLogo({ className, size = 24 }: FeloxiLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M7 19 L5 4 L15 14 Z" fill="currentColor" opacity="0.85" />
      <path d="M25 19 L27 4 L17 14 Z" fill="currentColor" opacity="0.85" />
      <path
        d="M2 24 L10 24 L13 19 L16 28 L19 19 L22 24 L30 24"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FastIcon({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 32 32"
      fill={active ? 'currentColor' : 'none'}
      stroke={active ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.2 3.8c1.2-1.7 3.4-.6 3 1.2l-1.5 6h7.2c1.9 0 2.7 2 1.5 3.5L14.7 28c-1.2 1.4-3 .5-2.6-1.2l1.6-5.8H6.5c-2.1 0-2.9-1.8-1.6-3.5Z" />
    </svg>
  )
}

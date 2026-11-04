import { IconShieldOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** 裂盾沿用官方盾牌轮廓、16px 画布与 1px 描边，裂缝贯穿两片盾面。 */
export function ArmorIcon({ active, size = 14 }: { active: boolean; size?: number }) {
  if (!active) return <IconShieldOutlineRegular size={size} />
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.4 1.98C7.2 2.01 7 2.07 6.8 2.15L2.28 3.84V7.12C2.28 11.1 4.93 13.12 7.3 14.21L6.55 10.1L8.25 8.25L5.95 6.15L7.4 1.98Z" />
      <path d="M9.1 2C9.27 2.04 9.44 2.08 9.61 2.15L14.13 3.84V7.12C14.13 11.15 11.59 13.15 9 14.25L8.1 10.45L9.8 8.3L7.55 5.9L9.1 2Z" />
    </svg>
  )
}

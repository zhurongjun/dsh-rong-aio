import PROVIDER_ICON_ASSETS from 'virtual:provider-icons'
import type { ProviderIconId } from '../../shared/provider-icon.ts'

export function ProviderIcon({
  icon,
  size = 14,
  className,
}: {
  icon: ProviderIconId
  size?: number
  className?: string
}) {
  const asset = PROVIDER_ICON_ASSETS[icon]
  if (!asset) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox={asset.viewBox}
      fill="currentColor"
      fillRule={asset.fillRule}
      aria-hidden="true"
      data-provider-icon={icon}
      className={className}
    >
      {asset.shapes.map((shape, index) =>
        shape.tag === 'path' ? (
          <path key={index} d={shape.d} clipRule={shape.clipRule} fillOpacity={shape.fillOpacity} />
        ) : (
          <ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />
        ),
      )}
    </svg>
  )
}

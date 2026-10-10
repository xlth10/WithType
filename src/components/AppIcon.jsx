/** One versioned mark across navigation, reading cards and the Windows bundle. */
export function AppIcon({ size = 34, className = "", label = "" }) {
  return <img className={`app-icon ${className}`.trim()} src="/assets/typefree-ink-v2.svg" width={size} height={size} alt={label} aria-hidden={label ? undefined : true} draggable={false} />;
}

/**
 * AgentGuard design system tokens — runtime exports for TS consumers.
 * For pure styling, prefer CSS variables (see tokens.css).
 */

export const colors = {
  primary: 'var(--color-primary)',
  primaryHover: 'var(--color-primary-hover)',
  primaryLight: 'var(--color-primary-light)',
  secondary: 'var(--color-secondary)',
  secondaryHover: 'var(--color-secondary-hover)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  info: 'var(--color-info)',
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  textMuted: 'var(--color-text-muted)',
  secure: 'var(--color-secure)',
  blocked: 'var(--color-blocked)',
  pending: 'var(--color-pending)',
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
} as const;

export const radii = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  full: '9999px',
} as const;

export const shadows = {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  xl: 'var(--shadow-xl)',
} as const;

export const fonts = {
  sans: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  display: '"Space Grotesk", "Inter", sans-serif',
} as const;

export type DesignColor = keyof typeof colors;
export type DesignSpacing = keyof typeof spacing;

export const designSystem = { colors, spacing, radii, shadows, fonts };
export default designSystem;
// Legacy bridge tokens for pages that have not migrated off inline styles yet.
// Keep these aligned with globals.css until the old theme module is removed.

export const COLORS = {
  // Sidebar
  sidebarBg: '#18191d',
  sidebarHover: 'rgba(255,245,228,0.08)',
  sidebarBorder: 'rgba(255,245,228,0.08)',
  sidebarText: '#a79b8b',
  sidebarTextActive: '#f6ede2',
  sidebarAccent: '#dd5b38',
  sidebarGroupLabel: '#8b8074',

  // Topbar
  topbarBg: '#fffdf9',
  topbarBorder: '#ded4c4',

  // Content area
  contentBg: '#f8f6ef',

  // Cards
  cardBg: '#fffdf9',
  cardBorder: '#ded4c4',

  // Text
  textPrimary: '#1f1a17',
  textSecondary: '#5d4c41',
  textMuted: '#8d7d71',

  // Borders
  border: '#ded4c4',

  // Status / accents
  badgeRed: '#c23b33',
  accentBlue: '#dd5b38',
  accentBlueDark: '#be4728',
  accentBlueLight: '#f8e4db',
  accentGreen: '#1f7a4f',
  accentGreenDark: '#145438',
  accentGreenLight: '#e8f7ef',
  accentAmber: '#f0a230',
  accentAmberDark: '#8b5710',
  accentAmberLight: '#fff3dc',
  accentPurple: '#6f4fd8',
  accentPurpleDark: '#4d35a3',
  accentPurpleLight: '#eee9ff',
  accentRed: '#c23b33',
  accentRedDark: '#8e2a24',
  accentRedLight: '#fdeae6',

  // Misc
  white: '#ffffff',
  inputBorder: '#d3c7b5',
  inputBorderFocus: '#dd5b38',
  hoverBg: '#f2ebe1',
  tableBorder: '#e1d7c8',
  tableHeaderBg: '#f3ede4',
} as const;

export const SHADOWS = {
  card: '0 20px 60px -36px rgba(15,23,42,0.35)',
  cardHover: '0 26px 70px -36px rgba(15,23,42,0.45)',
  dropdown: '0 24px 70px -30px rgba(15,23,42,0.45)',
  overlay: 'rgba(19, 18, 21, 0.48)',
  focusRing: '0 0 0 4px rgba(221,91,56,0.16)',
  auth: '0 32px 80px -42px rgba(15,23,42,0.42)',
} as const;

export const FONT = {
  xs: '0.75rem',
  sm: '0.8125rem',
  base: '0.875rem',
  md: '0.9375rem',
  lg: '1.125rem',
  xl: '1.5rem',
  xxl: '1.75rem',
} as const;

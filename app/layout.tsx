import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Curvature — tune a bonding curve',
  description:
    'Sculpt a Meteora Dynamic Bonding Curve, simulate it to graduation offline, then launch it.',
  // The UI is technical labels and numbers. Machine translation mangles both, and localising
  // the decimal separator turns "44.181 sol" into "44,181 sol", which reads as 44 thousand.
  other: { google: 'notranslate' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" translate="no" className="notranslate">
      <head>
        <meta name="google" content="notranslate" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}

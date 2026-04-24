import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import { NETWORK } from '@/lib/env'
import { AlphaBanner } from '@/components/alpha-banner'
import { MainnetDisclaimer } from '@/components/mainnet-disclaimer'
import { TopNav } from '@/components/top-nav'
import { SiteFooter } from '@/components/site-footer'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const SITE_NAME = 'OpenABX'
const TITLE = 'OpenABX — Borrow, earn, and redeem ABD on Alephium'
const DESCRIPTION =
  'Independent, open-source interface to the ABD stablecoin protocol on Alephium. Borrow ABD against ALPH, earn from auction pools, and stake ABX for protocol fees. MIT licensed, community built, pre-audit beta.'
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || `https://openabx.github.io${BASE_PATH}`

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · OpenABX',
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'OpenABX contributors' }],
  keywords: [
    'Alephium',
    'ABD',
    'ABX',
    'stablecoin',
    'DeFi',
    'open source',
    'clean room',
    'borrow',
    'stake',
    'auction pool',
    'redeem',
  ],
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: `${BASE_PATH}/favicon.svg`, type: 'image/svg+xml' },
      { url: `${BASE_PATH}/favicon-32.png`, sizes: '32x32', type: 'image/png' },
    ],
    apple: `${BASE_PATH}/apple-touch-icon.png`,
  },
  manifest: `${BASE_PATH}/site.webmanifest`,
  openGraph: {
    type: 'website',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: SITE_NAME,
    images: [
      {
        url: `${BASE_PATH}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'OpenABX — independent open-source interface to the ABD protocol on Alephium',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [`${BASE_PATH}/og-image.png`],
  },
}

export const viewport: Viewport = {
  themeColor: '#0a1511',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <AlphaBanner />
          {NETWORK === 'mainnet' && <MainnetDisclaimer />}
          <TopNav />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  )
}

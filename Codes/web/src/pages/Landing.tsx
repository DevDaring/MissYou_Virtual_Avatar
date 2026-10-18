import { useEffect } from 'react'
import { Hero } from '../landing/Hero'
import { ClosingCta, HowItWorks, Languages, Safety, SiteFooter, SiteHeader } from '../landing/Sections'
import '../landing/landing.css'

export default function Landing() {
  useEffect(() => {
    const prev = document.title
    document.title = 'Miss You · Hear them say your name again'
    return () => {
      document.title = prev
    }
  }, [])

  return (
    <div className="relative min-h-screen overflow-x-clip bg-night-900 text-cream-100">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-cream-50 px-4 py-3 font-semibold text-night-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Safety />
        <Languages />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  )
}

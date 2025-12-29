import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { Buffer } from 'buffer'

// Make Buffer globally available for browser environment
if (typeof window !== 'undefined') {
  window.Buffer = Buffer
}

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}

export default MyApp

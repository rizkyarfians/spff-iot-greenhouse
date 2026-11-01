import {
  StrictMode,
} from 'react'

import {
  createRoot,
} from 'react-dom/client'

import App from './App'
import { UnifiedAiNeedsPage } from './UnifiedAiNeedsPage'

import {
  AuthGate,
} from './AuthGate'

import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-700.css'
import './index.css'
import './ResponsiveLayout.css'


const aiPreview = import.meta.env.DEV && import.meta.env.VITE_SPFF_AI_PREVIEW === 'true'

createRoot(
  document.getElementById(
    'root',
  )!,
).render(
  <StrictMode>
    {aiPreview ? (
      <main style={{maxWidth: '1440px', margin: '0 auto', padding: '24px 18px'}}>
        <p style={{fontSize: 12, fontWeight: 700, color: '#79531e'}}>STAGING · Hanya tampilan AI · Tidak tersedia kontrol pompa</p>
        <UnifiedAiNeedsPage />
      </main>
    ) : (
      <AuthGate>
        <App />
      </AuthGate>
    )}
  </StrictMode>,
)

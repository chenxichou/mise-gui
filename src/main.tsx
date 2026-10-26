import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PrefsProvider } from './prefs'
import { CmdTipProvider } from './cmdtip'
import './styles.css'

async function bootstrap() {
  // In a plain browser (vite dev) there is no Electron preload bridge. Load a
  // dev-only mock so the UI is previewable. Tree-shaken out of production.
  if (import.meta.env.DEV && typeof window !== 'undefined' && !window.mise) {
    const { installDevMock } = await import('./devMock')
    installDevMock()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PrefsProvider>
        <CmdTipProvider>
          <App />
        </CmdTipProvider>
      </PrefsProvider>
    </React.StrictMode>,
  )
}

bootstrap()

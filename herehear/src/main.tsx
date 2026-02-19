import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RepoContext } from '@automerge/automerge-repo-react-hooks'
import App from './App.tsx'
import { repo } from './automergeSetup'

// Import Leaflet CSS
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepoContext.Provider value={repo}>
      <App />
    </RepoContext.Provider>
  </StrictMode>,
)

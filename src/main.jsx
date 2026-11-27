import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.js'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary scope="앱" fullScreen>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

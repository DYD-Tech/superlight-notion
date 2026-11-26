import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'react-notion-x/styles.css'
import './index.css'

const el = document.getElementById('root')
if (!el) throw new Error('root element missing')
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
)

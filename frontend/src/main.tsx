import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'

// Inject scrollbar styles via JS to ensure they work in WKWebView
;(function() {
  const s = document.createElement('style')
  s.textContent = `
    ::-webkit-scrollbar { width: 3px !important; height: 3px !important; }
    ::-webkit-scrollbar-track { background: #0A0A0A !important; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.25) !important; border-radius: 2px !important; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.45) !important; }
    * { scrollbar-width: thin !important; scrollbar-color: rgba(255,255,255,0.25) #0A0A0A !important; }
  `
  document.head.appendChild(s)
})()

const container = document.getElementById('root')

const root = createRoot(container!)

root.render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
)

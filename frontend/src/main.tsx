import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'

// No emojis in anything typed or pasted into a text box (names, buyers, notes, Stakks, search): they're
// removed as they arrive, before the page reads the value. ★ ☆ © ® ™ stay (card names use them), and
// text like :) stays plain text. The server removes them too (backend/models/item.py no_emoji).
const EMOJI =
  /(?:(?![©®™★☆])\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}])(?:[\u{1F3FB}-\u{1F3FF}]|\uFE0F|\u20E3|\u200D\p{Extended_Pictographic}\uFE0F?)*|\uFE0F|\u20E3/gu
window.addEventListener(
  'input',
  (e) => {
    const el = e.target
    const typed = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', 'email', ''].includes(el.type))
    if (!typed) return
    const clean = el.value.replace(EMOJI, '')
    if (clean !== el.value) el.value = clean
  },
  true, // capture: runs before React's own listener reads the value
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

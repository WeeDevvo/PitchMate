import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { createAppRouter } from './app/appRouter'

// One router for the whole application: the marketing landing route, the auth
// feature's route table, the app shell's routes, and the application-level
// not-found surface. It is assembled — along with the session model, the auth
// facade, and the authenticated API client — in `app/appRouter.tsx`
// (Requirements 15.6, 15.9).
const router = createAppRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

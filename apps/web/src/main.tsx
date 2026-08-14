import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import LandingPage from './features/landing/LandingPage.tsx'

// The landing page owns `/`. The `/signup`, `/login`, `/privacy`, and `/terms`
// surfaces are owned by other features and are referenced only as external
// navigation targets from the landing page — they are intentionally not
// registered here yet.
const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

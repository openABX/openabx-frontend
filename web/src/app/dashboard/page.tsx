import { Dashboard } from './dashboard'

// Explicit /dashboard route shares the same component as the home page.
// Useful for links in docs / third-party embeds.
export default function DashboardPage() {
  return <Dashboard />
}

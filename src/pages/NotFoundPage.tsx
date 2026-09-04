import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'

export function NotFoundPage(): JSX.Element {
  return (
    <EmptyState
      title="Page not found"
      description="That route does not exist in this dashboard."
      action={
        <Link to="/" className="btn-secondary mt-2">
          Back to maps
        </Link>
      }
    />
  )
}

export default NotFoundPage

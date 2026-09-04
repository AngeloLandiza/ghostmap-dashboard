/**
 * `/admin/costs` — cost console (PLAN sections 3 and 4). This chunk owns recharts.
 */
import { PageHeader, PageStub } from '../../components/ui'

export function AdminCostsPage(): JSX.Element {
  return (
    <div>
      <PageHeader
        title="Costs"
        description="Measured usage priced against every provider's published list price, and what it would cost at scale."
      />
      <PageStub
        planRef="PLAN sections 3 and 4 · cost console"
        todos={[
          'Overview charts from useCostOverview(days): stacked cost by provider and by day, free-tier progress bars.',
          'Pricing table from useCostPricing(): metric, unit price, free quota, as_of, source link, and a warning row when verified is false.',
          'Usage table from useCostUsage(days) so every quantity behind the estimate is inspectable.',
          'Projection calculator: sliders bound to DEFAULT_PROJECTION_PARAMS, calling useCostProjection(params); show assumptions[].',
          'Keep recharts imports inside this lazy chunk.',
        ]}
      />
    </div>
  )
}

export default AdminCostsPage

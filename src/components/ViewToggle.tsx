export type SectionView = 'print' | 'review'

export function ViewToggle({
  view,
  onChange,
}: {
  view: SectionView
  onChange: (view: SectionView) => void
}) {
  return (
    <div className="view-picks" role="tablist" aria-label="Section view">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'print'}
        className={`btn ${view === 'print' ? 'primary' : 'ghost'}`}
        onClick={() => onChange('print')}
      >
        Print
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'review'}
        className={`btn ${view === 'review' ? 'primary' : 'ghost'}`}
        onClick={() => onChange('review')}
      >
        Review
      </button>
    </div>
  )
}

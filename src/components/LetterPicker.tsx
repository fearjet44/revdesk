import { useId, useRef } from 'react'

const ACCEPT = '.txt,.eml,.pdf,text/plain,message/rfc822,application/pdf'

export function LetterPicker({
  label,
  file,
  onChange,
  invalid,
  disabled,
}: {
  label: string
  file: File | null
  onChange: (file: File | null) => void
  invalid?: boolean
  disabled?: boolean
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const name = file?.name ?? ''

  return (
    <div className={`field ${invalid ? 'invalid' : ''}`}>
      <label htmlFor={inputId}>{label}</label>
      <div className="file-pick">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />
        <button
          className="btn"
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Choose letter
        </button>
        <span className={`file-pick-name ${name ? '' : 'empty'}`}>{name || 'No letter chosen'}</span>
      </div>
      {invalid ? <span className="field-error">Launch document required.</span> : null}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.ts'
import type { DoctorReport } from '../types.ts'

export function DoctorView({ onChecked }: { onChecked?: (report: DoctorReport) => void }) {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const check = useCallback(async () => {
    setBusy(true)
    try {
      const next = await api.doctor()
      setReport(next)
      setError(null)
      onChecked?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to check the tools.')
    } finally {
      setBusy(false)
    }
  }, [onChecked])

  useEffect(() => {
    void check()
  }, [check])

  async function copy(name: string, line: string) {
    try {
      await navigator.clipboard.writeText(line)
      setCopied(name)
      window.setTimeout(() => setCopied((current) => (current === name ? null : current)), 1500)
    } catch {
      setCopied(null)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Desk setup</p>
          <h1>Prerequisites</h1>
          <p className="lede">
            Revdesk uses a few tools on this machine to make PDFs and keep the library. This is what it found.
          </p>
        </div>
        <button className="btn" type="button" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {report?.ok ? <div className="banner ok">All tools found.</div> : null}

      <section className="panel">
        <div className="panel-hd">TOOLS</div>
        <table className="doctor-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Needed for</th>
              <th>Found</th>
              <th>Version</th>
              <th>Install</th>
            </tr>
          </thead>
          <tbody>
            {(report?.tools ?? []).map((tool) => (
              <tr key={tool.name} className={tool.path ? 'doctor-ok' : 'doctor-missing'}>
                <td className="doctor-name">{tool.name}</td>
                <td>{tool.needed_for}</td>
                <td className="doctor-path">{tool.path ?? 'Not found'}</td>
                <td className="doctor-version">{tool.version ?? '—'}</td>
                <td>
                  {tool.install ? (
                    <span className="doctor-install">
                      <code>{tool.install}</code>
                      <button className="btn ghost" type="button" onClick={() => void copy(tool.name, tool.install ?? '')}>
                        {copied === tool.name ? 'Copied' : 'Copy'}
                      </button>
                    </span>
                  ) : (
                    <span className="doctor-none">Comes with this system</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="modal-note">Revdesk does not install these for you. Install them, then Check again.</p>
    </>
  )
}

import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import type { LibraryInfo } from '../types.ts'

export function ConfigView({ onChanged }: { onChanged: () => Promise<void> }) {
  const [info, setInfo] = useState<LibraryInfo | null>(null)
  const [remote, setRemote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .config()
      .then((data) => {
        if (cancelled) return
        setInfo(data)
        setRemote(data.remote)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to read desk config.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.saveConfig(remote.trim())
      setInfo(next)
      setRemote(next.remote)
      setSaved(true)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save desk config.')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setRemote('')
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.saveConfig('')
      setInfo(next)
      setRemote('')
      setSaved(true)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect the library.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Desk config</p>
          <h1>Shared library</h1>
          <p className="lede">
            Solo uses the sample books in this library and needs no account. Paste a manuals-library URL to
            bind a shared library. Identities stay off until company mode.
          </p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {saved ? <div className="banner ok">Config saved.</div> : null}

      <section className="panel">
        <div className="panel-hd">LIBRARY</div>
        <div className="config-form">
          <label className="field">
            Manuals library URL
            <input
              type="text"
              value={remote}
              placeholder="https://example.com/your-company/manuals"
              disabled={busy}
              onChange={(event) => {
                setRemote(event.target.value)
                setSaved(false)
              }}
            />
          </label>
          <p className="modal-note">
            {info?.bound
              ? 'This desk is bound to a shared library. Empty the field and save to return to solo.'
              : 'Empty is solo: the sample books on this desk.'}
          </p>
          <div className="config-actions">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {info?.bound ? (
              <button className="btn ghost" type="button" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </>
  )
}

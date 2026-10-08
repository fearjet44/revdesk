import { useEffect } from 'react'

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

/** A dropped file must never open in the window. Inner drop zones call preventDefault() first and are left alone. */
export function useFileDropGuard() {
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    }
    const drop = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
}

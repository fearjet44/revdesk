/** Starter flowchart for toolbar Diagram. Ops-manual shaped, not a toy. */
export const DEFAULT_MERMAID = `flowchart TD
  PIC[PIC] --> Dispatch[Dispatch]
  Dispatch --> Go{Go?}
  Go -->|Yes| Release[Release]
  Go -->|No| Hold[Hold]`

export const MERMAID_INIT = {
  startOnLoad: false,
  theme: 'neutral' as const,
  look: 'classic' as const,
  securityLevel: 'strict' as const,
  flowchart: { htmlLabels: false, useMaxWidth: true },
}

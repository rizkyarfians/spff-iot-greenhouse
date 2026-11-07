import type { ApiDevice } from '@spff/contracts'

// Legacy AI permission no longer controls pump execution.
export function SoilEcExecutionSettings(_props:{devices:ApiDevice[];admin:boolean;connected:boolean}) {
  return null
}

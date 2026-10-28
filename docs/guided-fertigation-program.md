# Guided plant program editor

The editor presents three steps: plant/age, needs, and review/save. Saved programs
open on their summary with explicit Edit actions. New programs start with plant
selection. Larger inputs, labelled delivery cards, two-column field groups and
short optional help replace the dense full-page form. Mobile uses one column.

The form retains entered values while navigating and validates all fields with
the existing mutation contract before review/save. The guided editor also asks
for planting date and moisture targets (and EC targets for fertilizer programs),
so newly saved rules can be evaluated by age and sensors. Existing incomplete
programs remain readable, but must be completed before resaving. No target or
calibration value is invented. Saving continues to approve the rule for evaluation
without sending a pump command. Source dates, thresholds, concentrations, limits
and the existing optimistic recipe revision are preserved by the API payload.

Device selection, AI readiness, active sessions and stop/recovery actions remain
available on the saved program summary. Operators can access these without edit
rights. Technician calibration stays in its disclosure. The older liquid-EC
recommendation is separately collapsed. No API, firmware or migration changes
are required for this UI update.

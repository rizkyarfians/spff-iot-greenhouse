# Responsive layout

`frontend/src/ResponsiveLayout.css` is loaded after the component styles in
`main.tsx`. It owns page widths, desktop density and container breakpoints.
The former large-screen `vmin` zoom block was removed from `App.css`.

- Sidebar stays 248 CSS pixels on desktop. Content is capped at 1920 pixels.
- Dashboard uses available container width for its grids, and viewport height
  for the compact hero/chart. Long schedules scroll inside their card.
- Typography and controls remain the same size on Full HD, 2K and 4K.
- Long forms and tables keep normal vertical scrolling; horizontal table
  scrolling remains confined to the table wrapper.
- No authentication, backend, telemetry, firmware or command behavior changes.

## Reproduce the visual check

Run `npm run dev --workspace frontend`, then open
`/test/responsive-preview.html`. The dev-only entry uses synthetic data and
intercepts requests inside that page; it never contacts a real API or ESP32.
It is not imported by the production entry and is not in the Vite build output.

Dashboard was inspected in-browser with synthetic sensor values, two pumps,
four schedules and 72 history points:

The matrix below predates the October 23 banner-spacing adjustment. The hero and
schedule now use 220–300px responsive height (210px on short desktop viewports)
with larger inner insets. Their updated document heights have not been visually
re-measured; do not treat the old one-screen fit as verification of this change.

| CSS viewport | Document height | Sidebar | Dashboard bottom |
| --- | ---: | ---: | ---: |
| 1366 × 768 | 768 | 248 | 730 |
| 1920 × 1080 | 1080 | 248 | 895 |
| 2560 × 1440 | 1440 | 248 | 910 |
| 3840 × 2160 | 2160 | 248 | 910 |
| 1536 × 864 (Full HD / 125% equivalent) | 864 | 248 | 802 |

390 × 844 was also visually inspected: single-column sections, two sensor
columns, normal vertical scrolling. The sidebar is a closed drawer at this size.
An actual browser zoom transition was not tested.

Browser access was disabled before the remaining page-by-page visual checks;
Datalog, Controls, Smart Soil, Users and Fertigation have code-level responsive
changes but still need a visual pass with production-like content. Do not treat
the Dashboard matrix as verification of every page.

Validation: contracts/frontend builds and all 24 frontend tests passed. Frontend
lint exited successfully; the incoming `SoilEcPulsePanel.tsx` has one existing
effect-cleanup warning, outside the responsive layout patch.

Fertigation density follow-up: desktop fields use 36px minimum height, 12px
labels and tighter section spacing. At 1300px of available page width, the four
watering inputs share one row; fertilizer fields use three columns above 1060px.
Below 600px, fields stack and inputs/buttons keep 44px minimum touch targets.
The introductory advisory explanation is available in a native disclosure;
field-level safety hints remain visible. These changes have build/test coverage
but have not received a new browser visual pass while browser access is disabled.

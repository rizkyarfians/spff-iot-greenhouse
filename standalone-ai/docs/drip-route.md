# Operator-requested fertilizer delivery route

The operator requested delivery of all fertilizer products through the pump/drip
system, including products whose source activities say Tabur or Semprot.
Set `AI_FERTILIZER_DELIVERY_ROUTE=drip` in the independent AI environment to record
this route request. The default remains `reference` for existing installations.

Guide previews preserve the source method, quantity, units and individual product
identity. Products classified as Pupuk in the pinned source sheet receive
`requested_delivery_route=drip`; source ZPT, pesticide and unknown categories are
not implicitly included in a request scoped to fertilizers. This preference does
not approve mixing products together or establish their formulation suitability.

The operator request removes the source-method gate for fertilizer planning, but
does not turn on ACTIVE or claim physical readiness. Output explicitly reports
missing stock-batch configuration, unverified drip formulation and the unverified
volume-session firmware contract. Stock concentrations are not inferred from
spray dilution or EC. All `can_dispatch` fields remain false.

This change writes no SPFF table and requires no extra PostgreSQL grants. Apply
the new app files from the AI branch, set the environment value, restart only
spff-ai-engine, and check `/status` and `/source/guide-programs`.

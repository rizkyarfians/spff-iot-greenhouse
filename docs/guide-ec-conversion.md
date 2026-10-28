# Experimental guide EC conversion

Branch: feat/guide-ec-conversion. This branch is isolated from the Orange Pi
production branch. It adds solution EC conversion and an Admin calibration editor;
it does not activate automatic pumping or replace the legacy soil-EC controller.
No MQTT command or execution flag is written by these endpoints.

Target EC is never accepted as a manual program field. The saved guide program
provides each product's calculated mass and the final activity solution volume.
A canonical recipe signature includes all product names and their mass fractions
(to 10 significant digits), independent of batch scale. Only valid positive g/kg
requirements, consistent water volumes and a warning-free recipe can be converted.
Liquid products require future density/composition support; no generic ppm/TDS
factor is used, no products are silently ignored and no EC values are summed.

An Admin supplies an exact-mixture concentration/EC curve from a manufacturer or
verified measurements, a reference-water EC, a source reference and explicit
confirmation of the blend and 25 C temperature basis. Empty profiles are not
seeded with example or guessed values. The first point must be 0 g/L at the
reference-water EC; later concentrations strictly increase and EC cannot decrease.
The server interpolates only within the validated range and calculates:

    concentration = total mass in grams / final solution volume in liters
    estimated target EC = site water EC + (interpolated EC - reference-water EC)

Reference-water EC is subtracted exactly once. The site's measured raw-water EC
is an optional program configuration field; a missing value blocks conversion.
Manufacturer tables must use the same product, composition and measurement basis.
Changes in water chemistry can affect this additive estimate; validate it with the
site solution measurement before connecting to control. These targets apply to
final liquid solution EC, not soil sensor EC or an undiluted stock tank.

The saved program's activity details show target EC, concentration, source and
profile revision, or an explicit unavailable reason. The calibration form is
collapsed and Admin-only. Edits use profile and program revision checks, site
scoping, transaction locks and append-only audit history. Profiles apply to the
exact recipe and are reused by proportional batches. A changed blend requires a
matching profile. Program snapshots remain unchanged by Panduan edits. Profile
changes are currently live in the conversion display and audited; before execution
is implemented, each execution must pin its profile revision and water evidence.

`GET /guide-programs/:id/ec-conversion` is read-only and authenticated;
`PUT /guide-programs/:id/ec-profile` additionally requires Admin and CSRF.
The response always includes `automaticExecutionEnabled: false`. A ready conversion
means a computed target is available, not permission to dispatch a pump.

Testing an isolated deployment requires existing migrations 033/034 followed by
035_guide_ec_conversion.sql, a workspace build and an API restart. Keep the
production Orange Pi checkout on its current branch unless explicitly testing.
No firmware change is included or needed for the conversion calculator.

Remaining execution work: validated delivery/injector calibration, revision-pinned
batch plans, measured dose accounting across days, ownership/schedule arbitration,
restart reconciliation and connecting dispatch only when all readiness gates pass.

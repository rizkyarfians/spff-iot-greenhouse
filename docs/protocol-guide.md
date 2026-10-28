# Panduan

The Guide page (`#/guide`) displays the six crop sheets from the supplied
Unisma–Elevarm workbook. The original workbook is not published in the repository.

`python3 scripts/import_protocol_guide.py /path/to/source.xlsx` reads that source with the standard
library, preserving original cell values, units, notes, table row order, merged
cells and stored formula results. It writes `frontend/src/data/protocolGuide.json`
with the source SHA256. No formula is recalculated, no missing method/category is
filled from neighboring rows, and source irregularities are not repaired. Excel
number formats are reflected in display strings while underlying numbers remain
in the snapshot. The source's HST indicator is labelled as a value on the file,
not today's crop age.

Readers select a crop, see its land/plant information and notes, and scroll the
complete original activity table. Fertilizer, pesticide, harvest and care entries
remain together as recorded. Checked cells show the saved source state and cannot
be changed on this page. Repeated unit columns are retained. The original snapshot remains a reference. Saved edits and revision history are
provided by migration 033; see `editable-protocol-guide.md`. Guide changes do not
approve programs or control pumps.

"""Read the source workbook without recalculation and generate the read-only guide snapshot.

Uses only Python's standard library. The source XLSX is read without modification.
Run from repository root: python3 scripts/import_protocol_guide.py /path/to/source.xlsx
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'frontend/src/data/protocolGuide.json'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
IDS = ['ubi-jalar', 'kacang-tanah', 'jagung-manis', 'terong', 'buncis', 'butternut']


def format_number(value, fmt):
    if fmt == 165:
        date = dt.date(1899, 12, 30) + dt.timedelta(days=value)
        return f'{date.month}/{date.day}/{date.year}'
    if fmt == 9:
        return f'{value * 100:.0f}%'
    if fmt == 2:
        return f'{value:.2f}'
    if fmt in (1, 3, 164):
        result = f'{value:,.0f}' if fmt in (3, 164) else f'{value:.0f}'
        return ('Rp' if fmt == 164 else '') + result
    return format(value, '.15g')


def extract(source):
    sheets = []
    with zipfile.ZipFile(source) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in si.iter() if t.tag.endswith('}t'))
                       for si in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        styles = ET.fromstring(archive.read('xl/styles.xml'))
        xfs = list(styles.find('m:cellXfs', NS))
        for index, sheet in enumerate(workbook.find('m:sheets', NS)):
            target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            xml = ET.fromstring(archive.read(path))
            cells = {}
            for cell in xml.findall('.//m:sheetData/m:row/m:c', NS):
                raw = cell.find('m:v', NS)
                inline = cell.find('m:is', NS)
                formula = cell.find('m:f', NS)
                if raw is None and inline is None and formula is None:
                    continue
                kind = cell.attrib.get('t', 'n')
                value = raw.text if raw is not None else None
                fmt = int(xfs[int(cell.attrib.get('s', 0))].attrib.get('numFmtId', 0))
                if kind == 's':
                    value = strings[int(value)]
                elif kind == 'inlineStr':
                    value = ''.join(t.text or '' for t in inline.iter() if t.tag.endswith('}t'))
                elif kind == 'b':
                    value = value == '1'
                elif kind == 'n' and value is not None:
                    value = float(value)
                    if value.is_integer():
                        value = int(value)
                display = format_number(value, fmt) if kind == 'n' and value is not None else str(value) if value is not None else ''
                entry = {'value': value, 'display': display}
                if formula is not None and formula.text:
                    entry['formula'] = formula.text
                cells[cell.attrib['r']] = entry
            header = next(int(re.search(r'\d+', address)[0]) for address, cell in cells.items()
                          if address.startswith('A') and cell['value'] == 'Aktivitas')
            last = max(int(re.search(r'\d+', address)[0]) for address in cells)
            columns = 16 if f'P{header}' in cells else 12
            sheets.append({'id': IDS[index], 'sheetName': sheet.attrib['name'],
                           'cropName': cells['D1']['value'], 'headerRow': header,
                           'lastRow': last, 'columnCount': columns,
                           'merges': [m.attrib['ref'] for m in xml.findall('m:mergeCells/m:mergeCell', NS)],
                           'cells': cells})
    return {'sourceName': 'Protokol Pemupukan Demplot  Unisma X Elevarm(1).xlsx',
            'sourceSha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(),
            'sheets': sheets}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Import a supplied workbook without modifying it.')
    parser.add_argument('source', type=Path, help='Path to the source XLSX; source file is not copied into the repository.')
    args = parser.parse_args()
    dataset = extract(args.source)
    OUTPUT.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + '\n')
    print(f"Imported {len(dataset['sheets'])} sheets; SHA256 {dataset['sourceSha256']}")

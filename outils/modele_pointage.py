#!/usr/bin/env python3
"""HPG — transforme la fiche de pointage Excel de l'hôtel en gabarit pour l'export annuel.

Usage : python3 outils/modele_pointage.py "F. POINTAGE LOGE 4EME TRIMESTRE 2026.xlsx" modele-pointage.js

Reprend la première feuille visible : styles, polices, bordures, largeurs, en-tête (lignes 1 à 7 :
nom de l'hôtel, nom / prénom / embauche / emploi / contrat / pause, jours Dimanche → Samedi avec
Entrées / Sorties, TOTAL, Signature) et les styles des lignes « semaine », « TOTAL du Mois » et
de la ligne vide entre deux mois. L'application recrée ensuite les 12 mois de l'année avec ces styles.
Aucune donnée de salarié n'est conservée.
"""
import json
import re
import sys
import zipfile
from html import unescape

src, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
wb = z.read('xl/workbook.xml').decode('utf-8')
rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
target = {}
for m in re.finditer(r'<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"', rels):
    target[m.group(1)] = m.group(2)
for m in re.finditer(r'<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"', rels):
    target[m.group(2)] = m.group(1)
sheet_path = None
for m in re.finditer(r'<sheet ([^>]*)/>', wb):
    attrs = m.group(1)
    if 'state="hidden"' in attrs or 'state="veryHidden"' in attrs:
        continue
    rid = re.search(r'r:id="([^"]+)"', attrs).group(1)
    sheet_path = 'xl/' + target[rid].lstrip('/').replace('xl/', '')
    break
sheet = z.read(sheet_path).decode('utf-8')
styles = z.read('xl/styles.xml').decode('utf-8')
theme = z.read('xl/theme/theme1.xml').decode('utf-8') if 'xl/theme/theme1.xml' in z.namelist() else None

sst = []
if 'xl/sharedStrings.xml' in z.namelist():
    raw = z.read('xl/sharedStrings.xml').decode('utf-8')
    for si in re.findall(r'<si>(.*?)</si>', raw, re.S):
        sst.append(unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))


def xesc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


sheet = re.sub(r'<c([^>]*?) t="s"([^>]*)><v>(\d+)</v></c>',
               lambda m: '<c%s%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (m.group(1), m.group(2), xesc(sst[int(m.group(3))])), sheet)


def row(n):
    m = re.search(r'<row r="%d"[^>]*>.*?</row>' % n, sheet, re.S)
    if not m:
        raise SystemExit('ligne %d introuvable' % n)
    return m.group(0)


def styles_of(n):
    """n° de style de chaque colonne A..Q de la ligne n"""
    r = row(n); res = {}
    for m in re.finditer(r'<c r="([A-Z]+)\d+"(?: s="(\d+)")?', r):
        res[m.group(1)] = int(m.group(2) or 0)
    return res


def first_row(pred):
    for m in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', sheet, re.S):
        if pred(m.group(2)):
            return int(m.group(1))
    raise SystemExit('ligne introuvable')


# repères dans le modèle
r_head = first_row(lambda b: 'Semaine du' in b)                       # ligne « Semaine du / Dimanche… »
r_week = first_row(lambda b: re.search(r'>D[Uu] \d\d [Aa][Uu] \d\d/\d\d/\d{4}<', b) is not None and '<c r="B' in b and re.search(r'<c r="B\d+" s="\d+" t="inlineStr"', b) is not None)
r_tot = first_row(lambda b: 'TOTAL du Mois' in b)
r_gap = r_tot + 1

# en-tête (lignes 1 → r_head + 1), cellules propres au salarié vidées
head = ''.join(row(n) for n in range(1, r_head + 2))
for ref in ['A3', 'B3', 'F3', 'G3', 'L3', 'L4', 'L5']:
    head = re.sub(r'<c r="%s"( s="\d+")?[^>]*?(?:/>|>.*?</c>)' % ref, lambda m: '<c r="%s"%s/>' % (ref, m.group(1) or ''), head, flags=re.S)
head = re.sub(r' spans="[^"]*"', '', head)
head = re.sub(r' x14ac:dyDescent="[^"]*"', '', head)
head = re.sub(r'<c r="(?:[R-Z]|[A-Z]{2})\d+"[^>]*?(?:/>|>.*?</c>)', '', head, flags=re.S)  # colonnes au-delà de Q

cols = re.search(r'<cols>.*?</cols>', sheet, re.S).group(0)
merges_head = [m for m in re.findall(r'<mergeCell ref="([^"]+)"/>', sheet) if int(re.search(r'\d+$', m).group(0)) <= r_head + 1]

# style « Signature » du mois : celui de la colonne Signature, centré verticalement
xfs = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', styles, re.S)
nxf = int(xfs.group(1))
xf_list = re.findall(r'<xf [^>]*?(?:/>|>.*?</xf>)', xfs.group(2), re.S)
sig_base = xf_list[styles_of(r_week)['Q']]
sig = re.sub(r'<alignment[^>]*/>', '', sig_base)
sig = sig.replace('/>', '><alignment horizontal="center" vertical="center"/></xf>', 1) if sig.endswith('/>') else sig.replace('</xf>', '<alignment horizontal="center" vertical="center"/></xf>')
if 'applyAlignment' not in sig:
    sig = sig.replace('<xf ', '<xf applyAlignment="1" ', 1)
# heures : nombre avec deux décimales au plus (format « 0.## » → 35,5)
p_base = xf_list[styles_of(r_week)['P']]
nf = re.search(r'<numFmts count="(\d+)">(.*?)</numFmts>', styles, re.S)
ids = [int(i) for i in re.findall(r'numFmtId="(\d+)"', nf.group(2))] if nf else []
fid = max([200] + ids) + 1
fmt_xml = '<numFmt numFmtId="%d" formatCode="0.##"/>' % fid
if nf:
    styles = styles.replace(nf.group(0), '<numFmts count="%d">%s%s</numFmts>' % (int(nf.group(1)) + 1, nf.group(2), fmt_xml))
else:
    styles = styles.replace('<fonts', '<numFmts count="1">%s</numFmts><fonts' % fmt_xml, 1)
hours = re.sub(r'numFmtId="\d+"', 'numFmtId="%d"' % fid, p_base, count=1)
if 'applyNumberFormat' not in hours:
    hours = hours.replace('<xf ', '<xf applyNumberFormat="1" ', 1)
# jours hors du mois (début / fin de semaine à cheval) : case grisée
fills = re.search(r'<fills count="(\d+)">(.*?)</fills>', styles, re.S)
nfill = int(fills.group(1))
styles = styles.replace(fills.group(0), '<fills count="%d">%s<fill><patternFill patternType="solid"><fgColor rgb="FFBFBFBF"/><bgColor indexed="64"/></patternFill></fill></fills>' % (nfill + 1, fills.group(2)))
grey = re.sub(r'fillId="\d+"', 'fillId="%d"' % nfill, xf_list[styles_of(r_week)['B']], count=1)
if 'applyFill' not in grey:
    grey = grey.replace('<xf ', '<xf applyFill="1" ', 1)
# journée non travaillée (repos, CP…) : libellé sur Entrée + Sortie fusionnées, réduit pour tenir dans la case
lbl = re.sub(r'<alignment[^>]*/>', '<alignment horizontal="center" vertical="center" shrinkToFit="1"/>', xf_list[styles_of(r_week)['B']])
if '<alignment' not in lbl:
    lbl = lbl.replace('/>', '><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>', 1) if lbl.endswith('/>') else lbl.replace('</xf>', '<alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>')
if 'applyAlignment' not in lbl:
    lbl = lbl.replace('<xf ', '<xf applyAlignment="1" ', 1)
xfs = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', styles, re.S)
styles = styles.replace(xfs.group(0), '<cellXfs count="%d">%s%s%s%s%s</cellXfs>' % (nxf + 4, xfs.group(2), sig, hours, grey, lbl))

data = {
    'head': head, 'headRows': r_head + 1, 'cols': cols, 'merges': merges_head,
    'styles': styles, 'theme': theme,
    'week': styles_of(r_week), 'total': styles_of(r_tot), 'gap': styles_of(r_gap),
    'sign': nxf, 'hours': nxf + 1, 'grey': nxf + 2, 'label': nxf + 3,
}
with open(out, 'w', encoding='utf-8') as f:
    f.write('/* HPG — gabarit de la fiche de pointage annuelle (généré par outils/modele_pointage.py à partir du modèle Excel de l\'hôtel). */\n')
    f.write('window.HPG_POINTAGE = ' + json.dumps(data, ensure_ascii=False) + ';\n')
print('gabarit écrit :', out, '· feuille', sheet_path, '· lignes en-tête', r_head + 1, '· semaine', r_week, '· total', r_tot)

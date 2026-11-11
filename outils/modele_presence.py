#!/usr/bin/env python3
"""HPG — transforme la fiche de présence Excel de l'hôtel en gabarit pour l'application.

Usage : python3 outils/modele_presence.py "10_26 F. PRESENCE CAFETERIE.xlsx" modele-presence.js

Prend la première feuille visible du classeur, en garde exactement la mise en page (styles, largeurs,
hauteurs, cellules fusionnées, formules, bloc paie) et vide les cellules propres à un salarié
(nom, poste, repos, mois, jours, croix, observations). Le résultat est un fichier JavaScript
chargé par l'application, qui remplit ces cellules à chaque export.
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

# --- textes partagés → texte en ligne
sst = []
if 'xl/sharedStrings.xml' in z.namelist():
    raw = z.read('xl/sharedStrings.xml').decode('utf-8')
    for si in re.findall(r'<si>(.*?)</si>', raw, re.S):
        sst.append(unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))


def xesc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def to_inline(m):
    attrs, idx = m.group(1), int(m.group(2))
    attrs = attrs.replace(' t="s"', '')
    return '<c%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (attrs, xesc(sst[idx]))


sheet = re.sub(r'<c([^>]*? t="s"[^>]*)><v>(\d+)</v></c>', to_inline, sheet)
# formules : on retire les valeurs en cache (recalcul à l'ouverture)
sheet = re.sub(r'(<f>[^<]*</f>)<v>[^<]*</v>', r'\1', sheet)


def col2n(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def n2col(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


# --- cellules propres à un salarié : vidées (le style est conservé)
targets = ['G3', 'H6', 'H9', 'H12', 'H15', 'R29', 'R30']
for r in list(range(22, 29)) + list(range(33, 64)):
    for c in 'BDEFGHIJKLMN':
        targets.append('%s%d' % (c, r))


def clear(ref):
    global sheet
    pat = re.compile(r'<c r="%s"( s="\d+")?[^>]*?(/>|>.*?</c>)' % ref, re.S)
    m = pat.search(sheet)
    if m:
        sheet = sheet[:m.start()] + '<c r="%s"%s/>' % (ref, m.group(1) or '') + sheet[m.end():]
        return
    # cellule absente : on la crée dans sa ligne, au bon endroit
    rown = int(re.sub(r'[A-Z]', '', ref)); coln = col2n(re.sub(r'\d', '', ref))
    rm = re.search(r'<row r="%d"[^>]*?(/>|>(.*?)</row>)' % rown, sheet, re.S)
    if not rm:
        raise SystemExit('ligne %d introuvable' % rown)
    if rm.group(1) == '/>':
        new = rm.group(0)[:-2] + '><c r="%s"/></row>' % ref
        sheet = sheet[:rm.start()] + new + sheet[rm.end():]
        return
    body = rm.group(2); cells = list(re.finditer(r'<c r="([A-Z]+)\d+"', body))
    pos = len(body)
    for cm in cells:
        if col2n(cm.group(1)) > coln:
            pos = cm.start(); break
    body = body[:pos] + '<c r="%s"/>' % ref + body[pos:]
    start = rm.start(2)
    sheet = sheet[:start] + body + sheet[rm.end(2):]


for ref in targets:
    clear(ref)

# --- nettoyage : vue, sélection, imprimante
sheet = re.sub(r'<sheetViews>.*?</sheetViews>', '<sheetViews><sheetView workbookViewId="0"/></sheetViews>', sheet, flags=re.S)
sheet = re.sub(r' r:id="[^"]*"', '', sheet)
sheet = re.sub(r'<(drawing|legacyDrawing|legacyDrawingHF)[^>]*/>', '', sheet)

# --- style « surligné jaune » pour « extra à payer » (copie du style de la colonne Observations)
obs = re.search(r'<c r="N33"( s="(\d+)")?', sheet)
base_xf = int(obs.group(2)) if obs and obs.group(2) else 0
fills = re.search(r'<fills count="(\d+)">(.*?)</fills>', styles, re.S)
nfill = int(fills.group(1))
styles = styles.replace(fills.group(0), '<fills count="%d">%s<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>' % (nfill + 1, fills.group(2)))
xfs = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', styles, re.S)
nxf = int(xfs.group(1))
xf_list = re.findall(r'<xf [^>]*?(?:/>|>.*?</xf>)', xfs.group(2), re.S)
base = xf_list[base_xf]
yellow = re.sub(r'fillId="\d+"', 'fillId="%d"' % nfill, base)
if 'applyFill' not in yellow:
    yellow = yellow.replace('<xf ', '<xf applyFill="1" ', 1)
styles = styles.replace(xfs.group(0), '<cellXfs count="%d">%s%s</cellXfs>' % (nxf + 1, xfs.group(2), yellow))

data = {'sheet': sheet, 'styles': styles, 'theme': theme, 'yellow': nxf}
with open(out, 'w', encoding='utf-8') as f:
    f.write('/* HPG — gabarit de la fiche de présence (généré par outils/modele_presence.py à partir du modèle Excel de l\'hôtel). */\n')
    f.write('window.HPG_PRESENCE = ' + json.dumps(data, ensure_ascii=False) + ';\n')
print('gabarit écrit :', out, '· feuille', sheet_path, '· style jaune', nxf, '· taille', len(sheet))

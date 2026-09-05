import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/schema/extensions.ts'
import { parseBody, serializeBody } from '../src/schema/markdown.ts'
import {
  DEFAULT_THEME,
  canonicalFontName,
  fontStack,
  guessPaperFonts,
  headingAlreadyNumbered,
  leafNumberFromTitle,
  nextHeadingStamp,
  parseHeadingParts,
  parsePdfFontNames,
  parseTheme,
  replaceHeadingStamp,
  reshapeHeadingStamp,
  splitHeadingText,
  themeFromHouseStyle,
  type DocTheme,
  type HeadingHit,
} from '../server/theme.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const decimal = DEFAULT_THEME
const nimbl = themeFromHouseStyle('nimbl-word')

check('leaf from title', leafNumberFromTitle('Section 5 — Weight and Balance') === '5')
check('leaf from appendix', leafNumberFromTitle('Appendix A — Abbreviations') === 'A')
check('leaf from id', leafNumberFromTitle('Administration', 'gomlep-5') === '5')
check('no leaf from admin id', leafNumberFromTitle('Administration', 'gom-admin') === null)

check('parse 5.1', JSON.stringify(parseHeadingParts('5.1 Title', 'decimal')) === JSON.stringify(['5', '1']))
check('parse nimbl H2', JSON.stringify(parseHeadingParts('5.1.0 PIC', 'nimbl')) === JSON.stringify(['5', '1']))
check('parse nimbl H3', JSON.stringify(parseHeadingParts('5.1.2 Extra', 'nimbl')) === JSON.stringify(['5', '1', '2']))
check('already numbered', headingAlreadyNumbered('5.2.0 Foo', 'nimbl'))
check('not numbered', !headingAlreadyNumbered('Pilot duties', 'decimal'))

check(
  'first H2 decimal',
  nextHeadingStamp(decimal, [], 2, '5') === '5.1',
)
check(
  'next H2 decimal',
  nextHeadingStamp(decimal, [{ level: 2, text: '5.1 Weight' }], 2, '5') === '5.2',
)
check(
  'H3 under 5.1',
  nextHeadingStamp(
    decimal,
    [
      { level: 2, text: '5.1 Weight' },
      { level: 3, text: '5.1.1 Scales' },
    ],
    3,
    '5',
  ) === '5.1.2',
)
check('first H2 nimbl', nextHeadingStamp(nimbl, [], 2, '5') === '5.1.0')
check(
  'H3 after nimbl H2',
  nextHeadingStamp(nimbl, [{ level: 2, text: '5.1.0 PIC' }], 3, '5') === '5.1.1',
)
check(
  'H3 from the H2 itself',
  nextHeadingStamp(nimbl, [{ level: 2, text: '5.1.0 PIC' }], 3, '5') === '5.1.1',
)
check('split nimbl H2', JSON.stringify(splitHeadingText('5.1.0 PIC', 'nimbl')) === JSON.stringify({ stamp: '5.1.0', title: 'PIC' }))
check('split decimal', JSON.stringify(splitHeadingText('5.1 Weight', 'decimal')) === JSON.stringify({ stamp: '5.1', title: 'Weight' }))
check('split leaves Section', splitHeadingText('Section 5: Weight', 'nimbl').stamp === null)
check(
  'restamp H2 to H3',
  replaceHeadingStamp('5.1.0 PIC', 'nimbl', '5.1.1') === '5.1.1 PIC',
)
check('restamp empty', replaceHeadingStamp('5.1.0 ', 'nimbl', '5.1.1') === '5.1.1 ')
check('reshape H2 to H3', reshapeHeadingStamp(nimbl, '5.8.0 Accident', 3, '5') === '5.8.1')
check('reshape H3 to H4', reshapeHeadingStamp(nimbl, '5.8.1 Accident', 4, '5') === '5.8.1.1')
check('reshape H4 back to H3', reshapeHeadingStamp(nimbl, '5.8.1.1 Accident', 3, '5') === '5.8.1')
check('reshape H3 back to H2', reshapeHeadingStamp(nimbl, '5.8.1 Accident', 2, '5') === '5.8.0')
check('no leaf prefix', nextHeadingStamp({ ...decimal, heading: { ...decimal.heading, leaf_prefix: false } }, [], 2, '5') === '1')
check('front matter', nextHeadingStamp(decimal, [], 2, null) === '1')

const parsed = parseTheme('heading:\n  scheme: nimbl\n')
check('partial yaml scheme', parsed.heading.scheme === 'nimbl')
check('partial yaml markers', parsed.steps.markers[0] === '1.')
check('partial yaml font', parsed.font.body === DEFAULT_THEME.font.body)
check('nimbl font', nimbl.font.body === 'Verdana')
check('nimbl paper', nimbl.color.paper === '#ffffff')

check('canonical Verdana-Bold', canonicalFontName('Verdana-Bold') === 'Verdana')
check('canonical ArialMT', canonicalFontName('ArialMT') === 'Arial')
check('canonical subset Cambria', canonicalFontName('FAQGND+Cambria') === 'Cambria')
check('canonical TimesNewRomanPSMT', canonicalFontName('TimesNewRomanPSMT') === 'Times New Roman')
check('canonical TimesNewRomanPS-BoldMT', canonicalFontName('TimesNewRomanPS-BoldMT') === 'Times New Roman')
check('skip Symbol', canonicalFontName('Symbol') === null)

const guessed = guessPaperFonts([
  'Verdana',
  'Verdana-Bold',
  'Verdana-Italic',
  'Verdana-BoldItalic',
  'ArialMT',
  'FAQGND+Cambria',
  'TimesNewRomanPSMT',
])
check('gom body Verdana', guessed.body === 'Verdana')
check('gom heading Verdana', guessed.heading === 'Verdana')

const serifBook = guessPaperFonts(['TimesNewRomanPSMT', 'TimesNewRomanPS-BoldMT', 'ArialMT'])
check('serif body Times', serifBook.body === 'Times New Roman')
check('serif heading Arial', serifBook.heading === 'Arial')

check('stack has liberation', fontStack('Times New Roman').includes('Liberation Serif'))

const dump = `name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
Verdana                              TrueType          WinAnsi          no  no  no    1755  0
ArialMT                              TrueType          WinAnsi          no  no  no    1759  0
`
check('pdffonts parse', parsePdfFontNames(dump).join(',') === 'Verdana,ArialMT')

const custom = parseTheme('font:\n  body: Calibri\ncolor:\n  paper: "#ffffff"\n')
check('custom body', custom.font.body === 'Calibri')
check('custom heading follows body', custom.font.heading === 'Calibri')
check('custom paper', custom.color.paper === '#ffffff')

function applyHeading(editor: Editor, theme: DocTheme, level: 2 | 3 | 4 | 5, leaf: string) {
  const $at = editor.state.selection.$from
  const here = $at.parent.type.name === 'heading' ? $at.parent.textContent : ''
  const reshaped =
    $at.parent.type.name === 'heading' && splitHeadingText(here, theme.heading.scheme).stamp
      ? reshapeHeadingStamp(theme, here, level, leaf)
      : null
  const before: HeadingHit[] = []
  if (!reshaped) {
    editor.state.doc.nodesBetween(0, $at.pos, (node) => {
      if (node.type.name === 'heading') {
        before.push({ level: Number(node.attrs.level ?? 1), text: node.textContent })
      }
    })
  }
  const stamp = reshaped ?? nextHeadingStamp(theme, before, level, leaf)
  editor
    .chain()
    .focus()
    .toggleHeading({ level })
    .command(({ tr }) => {
      const $now = tr.selection.$from
      if ($now.parent.type.name !== 'heading') return false
      const next = replaceHeadingStamp($now.parent.textContent, theme.heading.scheme, stamp)
      if (next === $now.parent.textContent) return true
      tr.insertText(next, $now.start(), $now.end())
      return true
    })
    .run()
}

{
  const editor = new Editor({
    extensions: editorExtensions,
    content: parseBody('Pilot duties\n'),
  })
  editor.commands.setTextSelection(1)
  applyHeading(editor, nimbl, 2, '5')
  check('editor H2 stamps', serializeBody(editor.getJSON()).includes('## 5.1.0 Pilot duties'), serializeBody(editor.getJSON()))
  applyHeading(editor, nimbl, 3, '5')
  check('editor H3 restamps from H2', serializeBody(editor.getJSON()).includes('### 5.1.1 Pilot duties'), serializeBody(editor.getJSON()))
  editor.destroy()
}

{
  const editor = new Editor({
    extensions: editorExtensions,
    content: parseBody('## 5.7.0 Previous\n\nAccident\n'),
  })
  let pos = -1
  editor.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text === 'Accident') pos = at
  })
  editor.commands.setTextSelection(pos + 1)
  applyHeading(editor, nimbl, 2, '5')
  check('accident H2 is 5.8.0', serializeBody(editor.getJSON()).includes('## 5.8.0 Accident'), serializeBody(editor.getJSON()))
  applyHeading(editor, nimbl, 3, '5')
  check('accident H3 is 5.8.1', serializeBody(editor.getJSON()).includes('### 5.8.1 Accident'), serializeBody(editor.getJSON()))
  applyHeading(editor, nimbl, 4, '5')
  check('accident H4 is 5.8.1.1', serializeBody(editor.getJSON()).includes('#### 5.8.1.1 Accident'), serializeBody(editor.getJSON()))
  applyHeading(editor, nimbl, 3, '5')
  check(
    'accident H3 stays in 5.8',
    serializeBody(editor.getJSON()).includes('### 5.8.1 Accident') &&
      !serializeBody(editor.getJSON()).includes('5.7.1'),
    serializeBody(editor.getJSON()),
  )
  editor.destroy()
}

if (failed) process.exit(1)
console.log(`pass theme-check fail=${failed}`)

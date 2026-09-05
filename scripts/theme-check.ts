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
  themeFromHouseStyle,
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

if (failed) process.exit(1)
console.log(`pass theme-check fail=${failed}`)

import test from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, detectDelimiter, neutralizeFormula, parseCsv, toCsv } from '../csv.js'

test('parseCsv: quotes, escaped quotes, embedded delimiters and newlines', () => {
  const text = 'a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,,3\r\n'
  assert.deepEqual(parseCsv(text), [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line1\nline2'],
    ['1', '', '3'],
  ])
})

test('parseCsv: BOM, LF, CR, and a missing trailing newline', () => {
  assert.deepEqual(parseCsv('﻿name,price\nBraids,100'), [['name', 'price'], ['Braids', '100']])
  assert.deepEqual(parseCsv('a,b\rc,d\r'), [['a', 'b'], ['c', 'd']])
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('\n'), [['']])
  assert.deepEqual(parseCsv('a,"b'), [['a', 'b']])
  assert.deepEqual(parseCsv('"",x'), [['', 'x']])
})

test('parseCsv: delimiter auto-detect for semicolons and tabs (Sheets paste), ignoring quoted commas', () => {
  assert.equal(detectDelimiter('a;b;c\n1,2,3'), ';')
  assert.equal(detectDelimiter('a\tb\tc'), '\t')
  assert.equal(detectDelimiter('"a,b,c";d'), ';')
  assert.equal(detectDelimiter('single'), ',')
  assert.deepEqual(parseCsv('name;price\n"Braids; knotless";45000'), [['name', 'price'], ['Braids; knotless', '45000']])
  assert.deepEqual(parseCsv('name\tprice\nBraids\t45,000'), [['name', 'price'], ['Braids', '45,000']])
})

test('toCsv and csvCell quote, neutralize formulas, keep phone numbers readable, and round-trip', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(csvCell('@x'), "'@x")
  assert.equal(csvCell('+234 803 555 0182'), '+234 803 555 0182')
  assert.equal(csvCell('+cmd|calc'), "'+cmd|calc")
  assert.equal(csvCell("'already"), "'already")
  assert.equal(neutralizeFormula('-5'), "'-5")
  assert.equal(csvCell(-5), '-5')
  assert.equal(csvCell(null), '')
  const rows = [['a', 'b,c', 'd"e', 'f\ng'], ['', '1', 2, "'=x"]]
  assert.deepEqual(parseCsv(toCsv(rows)), [['a', 'b,c', 'd"e', 'f\ng'], ['', '1', '2', "'=x"]])
  assert.ok(!toCsv(rows).endsWith('\n'))
})

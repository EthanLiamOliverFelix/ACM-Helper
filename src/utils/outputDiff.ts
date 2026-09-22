export type OutputDiffKind = 'match' | 'changed' | 'extra' | 'missing'

export interface OutputDiffSegment {
  text: string
  kind: OutputDiffKind
  expected?: string
}

type RawDiff = { text: string; kind: 'match' | 'extra' | 'missing' }

export function normalizeOutput(value: string) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd())
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

function tokenize(value: string) {
  return normalizeOutput(value).split(/(\n|[ \t]+)/).filter(Boolean)
}

function appendRaw(result: RawDiff[], text: string, kind: RawDiff['kind']) {
  if (!text) return
  const last = result[result.length - 1]
  if (last?.kind === kind) last.text += text
  else result.push({ text, kind })
}

function fallbackDiff(expected: string, actual: string): OutputDiffSegment[] {
  let prefixLength = 0
  const maxPrefix = Math.min(expected.length, actual.length)
  while (prefixLength < maxPrefix && expected[prefixLength] === actual[prefixLength]) prefixLength++

  let suffixLength = 0
  const maxSuffix = Math.min(expected.length - prefixLength, actual.length - prefixLength)
  while (suffixLength < maxSuffix
    && expected[expected.length - suffixLength - 1] === actual[actual.length - suffixLength - 1]) suffixLength++

  const segments: OutputDiffSegment[] = []
  const prefix = actual.slice(0, prefixLength)
  const actualMiddle = actual.slice(prefixLength, actual.length - suffixLength)
  const expectedMiddle = expected.slice(prefixLength, expected.length - suffixLength)
  const suffix = suffixLength ? actual.slice(actual.length - suffixLength) : ''
  if (prefix) segments.push({ text: prefix, kind: 'match' })
  if (actualMiddle) {
    segments.push({
      text: actualMiddle,
      kind: expectedMiddle ? 'changed' : 'extra',
      expected: expectedMiddle || undefined,
    })
  } else if (expectedMiddle) {
    segments.push({ text: expectedMiddle, kind: 'missing' })
  }
  if (suffix) segments.push({ text: suffix, kind: 'match' })
  return segments
}

/**
 * Builds an inline diff for program output. It follows the same whitespace
 * normalization as local judging and uses a token LCS so one insertion does
 * not make every following character look incorrect.
 */
export function diffOutput(expectedValue: string, actualValue: string): OutputDiffSegment[] {
  const expected = normalizeOutput(expectedValue)
  const actual = normalizeOutput(actualValue)
  if (expected === actual) return actual ? [{ text: actual, kind: 'match' }] : []

  const expectedTokens = tokenize(expected)
  const actualTokens = tokenize(actual)

  // Avoid a quadratic allocation for unusually large generated output.
  if (expectedTokens.length * actualTokens.length > 1_000_000) {
    return fallbackDiff(expected, actual)
  }

  const rows = expectedTokens.length + 1
  const columns = actualTokens.length + 1
  const table = Array.from({ length: rows }, () => new Uint32Array(columns))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      table[i][j] = expectedTokens[i - 1] === actualTokens[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1])
    }
  }

  const reversed: RawDiff[] = []
  let i = expectedTokens.length
  let j = actualTokens.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expectedTokens[i - 1] === actualTokens[j - 1]) {
      reversed.push({ text: actualTokens[j - 1], kind: 'match' })
      i--
      j--
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      reversed.push({ text: actualTokens[j - 1], kind: 'extra' })
      j--
    } else {
      reversed.push({ text: expectedTokens[i - 1], kind: 'missing' })
      i--
    }
  }

  const raw: RawDiff[] = []
  for (const part of reversed.reverse()) appendRaw(raw, part.text, part.kind)

  const segments: OutputDiffSegment[] = []
  for (let index = 0; index < raw.length;) {
    if (raw[index].kind === 'match') {
      segments.push(raw[index])
      index++
      continue
    }

    let missing = ''
    let extra = ''
    while (index < raw.length && raw[index].kind !== 'match') {
      if (raw[index].kind === 'missing') missing += raw[index].text
      else extra += raw[index].text
      index++
    }
    if (extra) {
      segments.push({
        text: extra,
        kind: missing ? 'changed' : 'extra',
        expected: missing || undefined,
      })
    } else if (missing) {
      segments.push({ text: missing, kind: 'missing' })
    }
  }

  return segments
}

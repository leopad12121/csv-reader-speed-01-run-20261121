// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Written from the reference's stated policy, not from
// its code: a U+FEFF at the very start is dropped; a record ends at LF or CRLF
// and a line left with no characters is no record; outside quotes a CR not
// followed by LF is dropped (stray_cr); a field opening with a quote runs to the
// next quote that is not doubled ("" inside is one quote, each CRLF or lone CR
// inside reads as LF); what follows its closing quote up to the next comma or
// line break is appended as it stands (quote_junk, when the field ends); a quote
// that never closes is a literal character and the text after it is read again
// as unquoted (unterminated_quote); a quote inside an unquoted field is literal;
// fields stay strings, never trimmed or converted; columns is the first record
// when header is true, else null; rows are the records after it, each padded
// with "" (short_row) or cut (long_row) to the first record's width; each error
// is {code, line, row} in the order met, line the 1-based line its record starts
// on (counting every LF, CRLF and lone CR inside quotes), row its record's index
// in rows, null for the header.
//
// Speed comes from never reading the text one character at a time on the common
// path: records whose line holds no quote at all are split at once with
// String.split (a C-speed scan), and other fields are found with indexOf for
// the next comma / line break, slicing each field once. The character-by-
// character readers below run only for broken fields (stray CRs, junk after a
// closing quote, unterminated quotes) and for quoted fields, which are handled
// by jumping from quote to quote with indexOf. The field readers share three
// run-scoped slots (fValue, fEnded, fAdded) instead of allocating a result
// object per field, the first line break at or after the record's start is
// found once per record and reused for every unquoted field in it, and an
// unquoted field skips its stray-CR check while its line is known to hold no
// CR and no quoted field in the record has read past a line break.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters the
  // slow unquoted reader kept (for the quote_junk check). Shared slots, so no
  // result object is allocated per field.
  let fValue = '';
  let fEnded = 0;
  let fAdded = 0;

  // The first LF at or after the record's start (Infinity: none left), found
  // once per record and reused for every unquoted field in it; recomputed when
  // a quoted field has read past it.
  let lineEnd = Infinity;

  // Whether the record's first line holds a stray CR, and whether a quoted
  // field in this record has already read past a line break: while neither is
  // so, an unquoted field on this line cannot hold a CR, so its slice needs
  // no CR check. A quoted field that spans lines sets lineCrossed, and the
  // check comes back for the fields after it.
  let lineHasCR = false;
  let lineCrossed = false;

  // How a field ended: at a comma (the record goes on), at a line break or at the end of the text.
  const COMMA = 0;
  const BREAK = 1;
  const END = 2;

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fValue, fEnded and
  // fAdded. The slow path, used only for broken fields, junk after a closing
  // quote and unterminated quotes.
  function readUnquotedSlow(value) {
    let added = 0;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = added;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = BREAK;
        fAdded = added;
        return;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fValue = value;
          fEnded = BREAK;
          fAdded = added;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        continue;
      }
      value += text[pos];
      added += 1;
      pos += 1;
    }
    fValue = value;
    fEnded = END;
    fAdded = added;
  }

  // The text slice [a, b), which holds no quote: counts its line breaks onto
  // `line` (each LF once, each CRLF once, each lone CR once) and reads each
  // CRLF or lone CR inside it as LF.
  function normSegment(a, b) {
    const seg = text.slice(a, b);
    if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) return seg;
    let breaks = 0;
    let k = -1;
    while ((k = seg.indexOf('\n', k + 1)) !== -1) breaks += 1;
    k = -1;
    while ((k = seg.indexOf('\r', k + 1)) !== -1) {
      if (seg.charCodeAt(k + 1) !== 10) breaks += 1;
    }
    line += breaks;
    if (breaks > 0) lineCrossed = true;
    return seg.indexOf('\r') === -1 ? seg : seg.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue and fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    while (true) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquotedSlow('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += normSegment(p, q);
        value += '"';
        p = q + 2;
        continue;
      }
      value += normSegment(p, q);
      pos = q + 1;
      break;
    }
    if (pos >= len) {
      fValue = value;
      fEnded = END;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = BREAK;
      fAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = BREAK;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquotedSlow(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Reads one unquoted field starting at pos, jumping to the next comma or
  // line break with indexOf. The line break is the record's cached one unless
  // a quoted field has read past it. Falls back to the slow reader when the
  // field holds a stray CR. Sets fValue and fEnded.
  function readUnquotedFast() {
    if (lineEnd < pos) {
      const n = text.indexOf('\n', pos);
      lineEnd = n === -1 ? Infinity : n;
    }
    const clean = !lineHasCR && !lineCrossed;
    const ni = lineEnd;
    const ci = text.indexOf(',', pos);
    if (ci !== -1 && (ni === Infinity || ci < ni)) {
      const f = text.slice(pos, ci);
      if (clean || f.indexOf('\r') === -1) {
        pos = ci + 1;
        fValue = f;
        fEnded = COMMA;
        return;
      }
      readUnquotedSlow('');
      return;
    }
    if (ni !== Infinity) {
      let e = ni;
      if (ni > pos && text.charCodeAt(ni - 1) === 13) e = ni - 1; // CRLF
      const f = text.slice(pos, e);
      if (clean || f.indexOf('\r') === -1) {
        pos = ni + 1;
        line += 1;
        fValue = f;
        fEnded = BREAK;
        return;
      }
      readUnquotedSlow('');
      return;
    }
    const f = text.slice(pos);
    if (clean || f.indexOf('\r') === -1) {
      pos = len;
      fValue = f;
      fEnded = END;
      return;
    }
    readUnquotedSlow('');
  }

  // Pads or cuts a finished record to the first record's width, recording a
  // short_row or long_row error, and files it (the header becomes columns).
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record whose line holds no quote at all has no quoted
    // field, so the whole line splits at once. A line holding a quote, or a
    // stray CR, falls through to the field-by-field reader.
    const ni = text.indexOf('\n', pos);
    lineEnd = ni === -1 ? Infinity : ni;
    const segEnd = ni === -1 ? len : ni;
    const seg = text.slice(pos, ni !== -1 && text.charCodeAt(ni - 1) === 13 ? ni - 1 : segEnd);
    lineHasCR = seg.indexOf('\r') !== -1;
    lineCrossed = false;
    if (seg.indexOf('"') === -1 && !lineHasCR) {
      const fields = seg.split(',');
      pos = ni === -1 ? len : ni + 1;
      if (ni !== -1) line += 1;
      // A line that held only stray CRs is left with no characters: no record.
      if (fields.length === 1 && fields[0] === '') continue;
      finishRecord(fields);
      continue;
    }

    const fields = [];
    let ended;
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
        fields.push(fValue);
        ended = fEnded;
      } else {
        quoted = false;
        readUnquotedFast();
        fields.push(fValue);
        ended = fEnded;
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

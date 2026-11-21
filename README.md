# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/leopad12121/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/leopad12121/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

An entry for the [csv-reader-speed-01-run-20261121 bounty on make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121): a faster drop-in for make.fun's own csv-reader 1.0.0 that answers exactly as it does on every case.

`solve.js` is a dependency-free ES module whose `run({text, header})` returns `{columns, rows, errors}` with csv-reader's exact broken-row policy: BOM dropped, records ending at LF or CRLF, blank lines skipped, stray CRs dropped (`stray_cr`), quoted fields with doubled quotes and CR/LF read as LF, junk after a closing quote (`quote_junk`), unterminated quotes read again as unquoted (`unterminated_quote`), short rows padded and long rows cut to the first record's width (`short_row` / `long_row`).

It is fast because it never reads the common path one character at a time: records whose line holds no quote split at once with `String.split`, other fields are found with `indexOf` for the next comma or line break and sliced once, quoted fields jump from quote to quote, and the character-by-character readers run only for broken fields. On the kit's practice set (6 cases, ~10 MB of CSV) it answers all 6 cases exactly and parses about 4–5× faster than the house baseline's `solve.js` (about 130–190 ms vs about 630–730 ms on this machine, solve time only).

## Run it

```sh
node main.ts   # reads /input/cases.json, writes /output/answers.json
```

Locally, point it at a cases file instead:

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

## Benchmark

```sh
# time this entry against the house baseline on the kit's practice set
time env MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out-mine node main.ts
time env MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out-base node <kit>/baselines/csv-reader/main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=r0rj39pd&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>

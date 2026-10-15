# Hintergrundbilder für „Mein Garten“

Lege die fertigen Bilder in diesen Ordner (`assets/garden/`) und nenne sie genau so:

| Datei | Garten |
|---|---|
| `garden-2x2.webp` | 2×2, 4 Beete |
| `garden-3x2.webp` | 3 Spalten × 2 Reihen, 6 Beete |
| `garden-3x3.webp` | 3×3, 9 Beete |
| `garden-3x4.webp` | 3 Spalten × 4 Reihen, 12 Beete |
| `garden-4x4.webp` | 4×4, 16 Beete |

Die Bilder sollten **quadratisch** sein (1024×1024). Am besten als WebP, PNG geht auch: sag mir dann Bescheid, dann stelle ich die Dateiendung im Code um. Ohne Bild zeigt die App einen grünen Farbverlauf.

Wichtig für alle Bilder: Die leeren Beete sollen **gleichmäßig im Raster** liegen, in der Mitte des Bildes, mit ausreichend Rand ringsherum. So passt das Gitter der App darüber. Nach dem Einbau justiere ich bei Bedarf die Abstände (`BOARD_LAYOUT` in `scripts/botany/garden-app.mjs`).

## Gemeinsamer Anfang (jedem Prompt voranstellen)

> Top-down view of a fantasy school garden, painted in the style of a hand-painted fantasy battlemap, warm natural light, soft shadows, rich detail, no text, no characters, no UI, perfectly square image. Seen from directly above (90 degrees). In the centre there is a clearly visible regular grid of empty rectangular planting beds with bare dark brown soil, evenly spaced, each bed the same size, with a wide margin of garden around the grid.

## 2×2 — verwildert

> [Anfang] The grid is 2 columns by 2 rows, four beds in total. The garden is neglected and overgrown: weeds and tall grass between the beds, a crooked broken wooden fence along the edges, moss on mossy stones, a few fallen leaves, a rusty watering can lying on the ground. The beds themselves are simple patches of bare soil with rough, uneven edges.

## 3×2 — einfach

> [Anfang] The grid is 3 columns by 2 rows, six beds in total. A modest, tidy-ish garden: simple wooden-plank bed frames, a worn dirt footpath between the beds, a low wooden fence, a few flowers growing at the edges, a wooden crate and a spade leaning against the fence.

## 3×3 — gepflegt

> [Anfang] The grid is 3 columns by 3 rows, nine beds in total. A well-kept garden: clean wooden raised beds with neat edges, light gravel paths between them, trimmed hedges along the border, a watering can and a wheelbarrow, small flowerbeds in the corners.

## 3×4 — schön

> [Anfang] The grid is 3 columns by 4 rows, twelve beds in total. A beautiful garden: raised beds bordered with cut stone, gravel and flagstone paths, climbing roses on arched trellises over the paths at the edges, a small stone fountain in one corner, flowering shrubs, a bench.

## 4×4 — prachtvoll

> [Anfang] The grid is 4 columns by 4 rows, sixteen beds in total. A magnificent, lovingly cared-for academy garden: perfectly kept stone-edged beds, paved paths in a pattern, ornamental hedges and topiary along the border, a glass greenhouse in one corner, wrought-iron lanterns, a marble fountain, flowering trees with petals drifting down, a faint magical glow of fireflies.

## Tipps

- Gefällt dir das Beet-Raster nicht (zu schief, zu viele oder zu wenige Beete), generiere neu und sag ChatGPT „exactly N columns and M rows of identical beds, aligned to a strict grid“.
- Alle fünf Bilder im selben Chat generieren und zuerst das 4×4 nehmen. Für die anderen sagst du: „Same style and palette, but less cared for / smaller grid“, dann wirken sie wie eine Serie.
- Format: „Square, 1024×1024“ explizit dazuschreiben.

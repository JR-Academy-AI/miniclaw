# Reef theme

- Keep design/tokens.json as the only color, glyph, border and motion source.
- Keep capability detection pure; callers supply terminal environment and TTY state.
- Preserve truecolor, 256, 16, NO_COLOR and ASCII fallbacks in every theme change.
- Brand art belongs here; ordinary components consume semantic colors and glyph names.

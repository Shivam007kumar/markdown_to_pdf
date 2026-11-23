# Emoji, Extended Unicode & Digit Font Regression Test

## Digit Rendering Check (Aug 2026 Font Fallback Regression)
- ASCII Digits: `0123456789` | Prose: 0 1 2 3 4 5 6 7 8 9 — 0123456789
- Decimals & Dates: `2026-11-23`, `₹1,25,000.50`, `$99.95`, `98.76543210%`, `v2.0.0-rc.1`
- Superscripts & Fractions: `2⁰ + 2¹ + 2² + 2³ + 2⁴ + 2⁵ + 2⁶ + 2⁷ + 2⁸ + 2⁹ = 1023`, `½ ⅓ ¼ ⅕ ⅙ ⅛ ⅔ ¾`

## Emoji & Status Symbols
- Status badges: 🚀 ✅ ❌ ⚠️ 🔥 💡 📌 🛠️ 📦 🧪
- Composite / ZWJ Emojis: 👨‍💻 🇮🇳 👨‍👩‍👧‍👦 🏳️‍🌈 👍🏽

## Multilingual & Box-Drawing Unicode
- Devanagari (Hindi/Marathi): नमस्ते दुनिया — ०१२३४५६७८९
- Mathematical & Technical Symbols: `∀x ∈ ℝ, ∃δ > 0 : |x - a| < δ ⇒ |f(x) - L| < ε`
- Box Drawing:
  ```text
  ┌──────────────────┬──────────────────┐
  │ v1 Server Render │ v2 Client Render │
  ├──────────────────┼──────────────────┤
  │ 3,843 ms         │ < 150 ms         │
  └──────────────────┴──────────────────┘
  ```

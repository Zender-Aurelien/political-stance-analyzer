# Civic Lens — Build Plan

## Overview

Civic Lens is a two-page, no-framework web application (HTML + CSS + JavaScript) that helps
people find and evaluate political candidates by entering their ZIP code. All user data
(saved searches, quiz answers, theme preference) is persisted in `localStorage` — no accounts,
no backend.

**Pages:**
- `index.html` — Home: hero, ZIP search, candidate cards, optional quiz, candidate detail panel
- `about.html` — About: how the data is sourced, project mission

**Design language:**
- Black background, white text, red accent strip beneath the NAV
- Dark mode (default) / Light mode toggle — persisted in `localStorage`
- Serious, no-games tone — civic and authoritative

**Data strategy:**
- Static `data/candidates.json` for the first build
- `js/api.js` acts as the data-access layer so a live API (e.g. Google Civic Information API)
  can be swapped in later without touching UI code

---

## File Structure

```
IBM_CivicLens/
├── index.html               # Home page shell
├── about.html               # About page shell
│
├── css/
│   ├── reset.css            # Browser-default normalization
│   ├── variables.css        # CSS custom properties: colors, spacing, typography
│   ├── base.css             # Global body, typography, link styles
│   ├── nav.css              # NAV bar + red accent strip + dropdown styles
│   ├── hero.css             # Hero banner + slideshow styles
│   ├── search.css           # ZIP input + search button styles
│   ├── candidates.css       # Candidate card grid styles
│   ├── detail.css           # Candidate detail panel/modal styles
│   ├── quiz.css             # Quiz section styles
│   ├── about.css            # About page-specific styles
│   └── themes.css           # Light-mode overrides (toggled via a class on <body>)
│
├── js/
│   ├── main.js              # Entry point — bootstraps all modules on DOMContentLoaded
│   ├── theme.js             # Dark/light mode toggle; reads/writes localStorage
│   ├── nav.js               # NAV dropdown logic; recent-searches display + clear
│   ├── storage.js           # Shared localStorage read/write helpers
│   ├── api.js               # Data-access layer — loads candidates.json today, API-ready tomorrow
│   ├── search.js            # ZIP input validation, triggers candidate fetch via api.js
│   ├── candidates.js        # Renders candidate card grid from data
│   ├── detail.js            # Opens/closes candidate detail panel, populates data
│   ├── quiz.js              # Quiz question render, answer collection, match-% calculation
│   ├── slideshow.js         # Hero background image auto-cycling logic
│   └── about.js             # About page entry point (minimal)
│
├── data/
│   └── candidates.json      # Static candidate records keyed by ZIP / state
│
├── assets/
│   ├── images/
│   │   └── (candidate headshots and any hero images go here)
│   └── icons/
│       └── (SVG icons: search, moon/sun for theme toggle, chevron, etc.)
│
└── civic-lens-plan.md       # This file
```

---

## Build Order & Sub-Tasks

### Sub-Task 1 — Project Scaffolding
**Status:** `[ ] pending`

**Intent:**
Create every file and folder listed above as empty stubs. This establishes the complete
project shape so every subsequent sub-task has a known target file to fill in.

**Expected Outcomes:**
- All directories and files exist (empty or with a single comment placeholder)
- `index.html` and `about.html` have a valid HTML5 boilerplate that links all CSS and JS files
- Opening `index.html` in a browser shows a blank page with no console errors

**Todo List:**
1. Create all directories: `css/`, `js/`, `data/`, `assets/images/`, `assets/icons/`
2. Create all CSS files under `css/` as empty stubs
3. Create all JS files under `js/` as empty stubs
4. Create `data/candidates.json` with an empty array `[]`
5. Write the HTML5 boilerplate in `index.html` — `<head>` links every CSS file, `<body>` has
   semantic landmark shells (`<nav>`, `<main>`, `<footer>`), `<script>` tags at bottom for every JS file
6. Write the HTML5 boilerplate in `about.html` — same head links, simpler body structure

**Relevant Context:**
- `index.html` already exists but is empty — overwrite it
- `Styles.css/` directory already exists — it will be replaced by the `css/` folder structure above

---

### Sub-Task 2 — Design Tokens & Global Styles
**Status:** `[ ] pending`

**Intent:**
Define the visual language once in CSS custom properties so every other stylesheet
inherits it. Set up the dark/light theme switch at the CSS layer.

**Expected Outcomes:**
- `variables.css` declares all color, spacing, and typography tokens for dark mode (default)
- `themes.css` declares the same token names with light-mode values, scoped to `body.light-mode`
- `reset.css` normalizes browser defaults
- `base.css` applies tokens to `body`, headings, links, and text
- The red accent strip color is tokenized so it can be reused in `nav.css`

**Todo List:**
1. Populate `reset.css` with a minimal browser-normalize ruleset
2. Define dark-mode tokens in `variables.css`:
   - `--color-bg` (black), `--color-text` (white), `--color-accent` (red),
     `--color-surface` (dark grey for cards), `--color-border`, font-family, base font-size
3. Define light-mode token overrides in `themes.css` under `body.light-mode`
4. Write `base.css` — apply tokens to `body`, `h1–h6`, `a`, `p`, `ul`

**Relevant Context:**
- `variables.css` is imported first in every HTML `<head>` so tokens are available to all other sheets
- `themes.css` is imported last so it wins the cascade

---

### Sub-Task 3 — NAV Bar
**Status:** `[ ] pending`

**Intent:**
Build the persistent navigation bar that appears on both pages. It contains the logo/brand
name, the red accent strip below it, a dark/light mode toggle, and a dropdown menu that
shows recent ZIP searches (from `localStorage`) with a clear button.

**Expected Outcomes:**
- NAV renders correctly on both `index.html` and `about.html`
- Red strip is visually distinct, full-width, sits flush beneath the NAV
- Dropdown opens/closes on click and lists saved searches; each search re-runs the ZIP lookup
- Clear button removes all saved searches from `localStorage` and empties the list
- Theme toggle switches `body` between dark and light mode and persists the choice

**Todo List:**
1. Write NAV HTML structure in both `index.html` and `about.html`:
   - Brand/logo left, dropdown trigger + theme toggle right
   - Red `<div class="accent-strip">` immediately after `<nav>`
2. Style in `nav.css`: layout, spacing, dropdown panel, accent strip height and color
3. Implement `theme.js`: on load read `localStorage` for saved theme; on toggle flip
   `body.light-mode` class and save to `localStorage`
4. Implement `nav.js`: open/close dropdown, read recent searches from `storage.js`,
   render list items, wire "clear" button to wipe storage key and re-render empty list,
   wire each search item to call the search module with that ZIP

**Relevant Context:**
- `storage.js` provides the read/write helpers — `nav.js` should import from it, not write
  directly to `localStorage`
- Recent searches key: `cl_recent_searches` (array of up to 5 ZIP strings, newest first)

---

### Sub-Task 4 — Hero Section & Slideshow
**Status:** `[ ] pending`

**Intent:**
Create the full-width hero banner on `index.html` that displays the app headline
("Know Your Choice") and auto-cycles candidate headshot images as the background.

**Expected Outcomes:**
- Hero section spans full viewport width with a darkened overlay so white headline text is legible
- Background image transitions smoothly every few seconds through images in `assets/images/`
- Headline and sub-copy are centered over the hero
- Gracefully falls back to the solid black background if no images are loaded yet

**Todo List:**
1. Write hero HTML in `index.html`: `<section class="hero">` with overlay `<div>` and headline
2. Style in `hero.css`: full-width, min-height, background-size cover, overlay opacity,
   headline typography, transition animation
3. Implement `slideshow.js`: reads an array of image paths, sets `hero` background-image on
   an interval, cross-fades using CSS `transition` on opacity

**Relevant Context:**
- Placeholder images can be solid-color rectangles or stock photos until real candidate headshots
  are available
- Slideshow speed and image list will eventually be driven by the loaded candidate data

---

### Sub-Task 5 — Data Layer & Static Candidate Data
**Status:** `[ ] pending`

**Intent:**
Populate `candidates.json` with realistic sample records and build the `api.js` abstraction
so the rest of the app always calls `api.js` — never fetches JSON directly.

**Expected Outcomes:**
- `candidates.json` contains at least 6 sample candidates across 2–3 ZIP codes with fields:
  `id`, `name`, `party`, `office`, `zip`, `state`, `photo`, `website`, `positions` (array of
  policy stance objects used by the quiz matcher)
- `api.js` exports a `getCandidatesByZip(zip)` function that returns a Promise resolving to
  the filtered array — today it fetches the local JSON, tomorrow it can call a real endpoint
- `storage.js` exports `get(key)`, `set(key, value)`, and `remove(key)` helpers

**Todo List:**
1. Design the candidate record schema
2. Write 6–8 sample records in `candidates.json`
3. Write `storage.js` — thin wrappers around `localStorage.getItem / setItem / removeItem`
   with JSON parse/stringify handled internally
4. Write `api.js` — `getCandidatesByZip(zip)` fetches `data/candidates.json`, filters by zip,
   returns Promise; add a comment block marking where a real API call would go

**Relevant Context:**
- `positions` array shape must align with quiz question answer keys so `quiz.js` can compute
  a match percentage without knowing candidate internals
- Example position object: `{ "topic": "climate", "stance": "support" }`

---

### Sub-Task 6 — ZIP Search & Candidate Cards
**Status:** `[ ] pending`

**Intent:**
Wire up the ZIP code input on `index.html` so that submitting a valid 5-digit ZIP fetches
candidates via `api.js`, saves the ZIP to recent searches, and renders a responsive grid
of candidate cards below the hero.

**Expected Outcomes:**
- Input accepts only 5-digit numeric strings; invalid input shows an inline error message
- On valid submit, candidate cards appear in a grid below the search bar
- Each card shows: photo, name, party badge, office sought, and a "View Details" button
- The searched ZIP is prepended to the `cl_recent_searches` array in `localStorage`
- If no candidates are found for the ZIP, a "No candidates found" empty-state message shows

**Todo List:**
1. Write search bar HTML in `index.html`: `<input>`, `<button>`, error message `<span>`
2. Write candidate card HTML template (a JS template string in `candidates.js`)
3. Style `search.css`: centered input, button, error state
4. Style `candidates.css`: responsive card grid, card layout, party badge colors, hover state
5. Implement `search.js`: validate ZIP, call `api.js`, pass results to `candidates.js`,
   save ZIP via `storage.js`, handle empty results
6. Implement `candidates.js`: `renderCards(candidates)` — clears grid, maps data to card HTML,
   injects into DOM, wires each "View Details" button to `detail.js`

**Relevant Context:**
- Party badge colors: Democrat = blue, Republican = red, Independent = grey — tokenize in `variables.css`
- ZIP validation regex: `/^\d{5}$/`

---

### Sub-Task 7 — Candidate Detail Panel
**Status:** `[ ] pending`

**Intent:**
When a user clicks "View Details" on a card, an expanded detail panel (slide-in drawer or
modal) opens showing full candidate information: photo, bio, office, website link,
and their policy positions.

**Expected Outcomes:**
- Detail panel opens without a page navigation — purely DOM show/hide
- Panel shows all candidate fields including the `positions` array as a readable list
- Panel can be closed via an X button or clicking the backdrop
- If a quiz has been taken, the candidate's match percentage is shown prominently in the panel
- Panel is accessible: focus is trapped inside while open, Escape key closes it

**Todo List:**
1. Write detail panel HTML in `index.html`: hidden `<aside class="detail-panel">` with close button
2. Style `detail.css`: slide-in animation, backdrop overlay, inner layout, close button,
   match-% badge
3. Implement `detail.js`: `openDetail(candidate)` populates panel fields and shows it;
   `closeDetail()` hides it; wire Escape key listener; wire backdrop click to close

**Relevant Context:**
- Match percentage comes from `quiz.js` — `detail.js` reads the saved quiz result from
  `storage.js` key `cl_quiz_result` and looks up the candidate id

---

### Sub-Task 8 — Optional Quiz
**Status:** `[ ] pending`

**Intent:**
Add the optional matching quiz to `index.html`. It appears as a collapsible section
(or a "Begin Matching Quiz" button that expands it) below the search bar. The quiz presents
multiple-choice policy questions; on completion it calculates a match percentage for every
loaded candidate and updates their cards and detail panels.

**Expected Outcomes:**
- Quiz is hidden by default; a "Begin Matching Quiz ›" button reveals it
- Questions render one at a time or as a scrollable list — multiple choice (radio buttons)
- On submit, a match percentage (0–100%) is computed per candidate and saved to `localStorage`
  under `cl_quiz_result` as `{ candidateId: percentage, ... }`
- Candidate cards update to show the match badge without a page reload
- Quiz answers are also saved to `localStorage` so returning users see their previous answers

**Todo List:**
1. Write quiz questions data — embed as a JS array in `quiz.js` or a separate `data/quiz.json`
2. Write quiz HTML shell in `index.html`: collapsed container, question list placeholder,
   submit button
3. Style `quiz.css`: toggle animation, question layout, radio button styling, submit button,
   match percentage badge
4. Implement `quiz.js`:
   - `renderQuiz()` — injects question HTML into the container
   - `calculateMatches(answers, candidates)` — compares user answers to candidate positions,
     returns a score map `{ candidateId: percentage }`
   - On submit: save result via `storage.js`, call `candidates.js` to re-render cards with badges
5. Wire "Begin Matching Quiz" toggle button in `main.js`

**Relevant Context:**
- Quiz question topics must match the `topic` keys used in candidate `positions` arrays
  (defined in Sub-Task 5)
- Match algorithm: for each question topic, if the user's answer equals the candidate's stance
  on that topic, increment a hit counter; final score = `(hits / total questions) * 100`

---

### Sub-Task 9 — About Page
**Status:** `[ ] pending`

**Intent:**
Build the content and layout for `about.html` — explains the project mission, how candidate
data is sourced, and any data/privacy notes (no accounts, localStorage only).

**Expected Outcomes:**
- About page has the same NAV (with dropdown + theme toggle) as the homepage
- Content sections: Mission statement, How It Works, Data Sources, Privacy / Data Notice
- Styled with `about.css` for any page-specific layout; shares all global styles

**Todo List:**
1. Write content sections in `about.html`
2. Style `about.css`: section spacing, any pull-quotes or callout blocks
3. Ensure `about.js` bootstraps `theme.js` and `nav.js` so the NAV works correctly on this page

**Relevant Context:**
- NAV HTML must be identical to `index.html`'s NAV so styles apply consistently

---

### Sub-Task 10 — Polish, Accessibility & localStorage QA
**Status:** `[ ] pending`

**Intent:**
Final pass to ensure the app is visually consistent, accessible, and that all `localStorage`
interactions work correctly across sessions and page reloads.

**Expected Outcomes:**
- Both pages pass a basic keyboard navigation check (Tab order logical, focus visible)
- Theme preference survives page reload
- Recent searches survive page reload and are displayed on next visit
- Quiz answers survive page reload and match badges re-render on card load
- Red accent strip and color tokens are consistent across dark and light mode
- No placeholder/lorem-ipsum text remains

**Todo List:**
1. Audit Tab order and add `aria-label` attributes to icon-only buttons (theme toggle, close)
2. Test `localStorage` persistence: reload page, confirm theme, recent searches, and quiz
   results all restore correctly
3. Verify light-mode overrides cover every surface (cards, panels, NAV, inputs)
4. Remove any placeholder text; replace with final copy
5. Confirm the red accent strip is the correct token color in both modes

---

## Key Design Decisions (for reference during implementation)

| Decision | Choice |
|---|---|
| Routing | No SPA router — two separate `.html` files |
| Frameworks | None — vanilla HTML, CSS, JS only |
| Data persistence | `localStorage` only, no accounts |
| Data source | `candidates.json` (static), `api.js` abstraction for future API swap |
| Default theme | Dark (black bg, white text) |
| Accent color | Red (`--color-accent`) |
| Recent searches | Stored as array under key `cl_recent_searches`, max 5 entries |
| Quiz result | Stored as object under key `cl_quiz_result` `{ candidateId: pct }` |
| Quiz answers | Stored as object under key `cl_quiz_answers` `{ topic: answer }` |

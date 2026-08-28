# Showcase UX contract

## User and job

The primary visitor has been told about a nohdol-auto desktop automation and wants to answer three questions without reading a campaign page:

1. What does the program do?
2. Where does the real workflow stop safely?
3. How does an approved user obtain the current installer?

The catalog's primary action is choosing a program. A detail route leads with the real workflow recording. An install route leads with the operating-system choice, installer code, and the distinction between download authorization and in-app activation.

## Visual direction

- Feel like a calm product directory and distribution guide: operational, readable, and quietly polished.
- Map the shared `nohdol-clean` profile to this public site: light neutral canvas, white surface, inset controls, one low-saturation blue accent, and semantic status colors only.
- Use a 4px spacing grid, 6px controls, 8px grouped surfaces, and 10px floating or emphasized surfaces.
- Use borders and small surface shifts for depth. Ordinary content has no drop shadow.
- Use the native Korean-capable font stack and a compact type scale. Weight and tone create hierarchy before size.
- The signature structure is the public-to-protected delivery path: public workflow evidence, program-specific installer authorization, and an explicit safe-stop boundary.

The site does not use gradients, glows, glass/blur, decorative background textures, rotated mockups, oversized hero type, or ambient animation. Cards exist only for an independently selectable program, the workflow recording, and the installation form.

## Responsive and accessibility contract

- Minimum verification viewport: `360 x 800`.
- Nominal verification viewport: `1440 x 1000`.
- The site remains responsive because it is a public Pages surface; the desktop-only application-renderer constraint does not apply to this repository.
- All routes prevent horizontal overflow, preserve readable long Korean copy, and expose visible `:focus-visible` treatment.
- Native links, buttons, labels, select, and password input remain keyboard operable.
- The installation form keeps the code after neither success nor failure, blocks duplicate submission while authorizing, restores focus to the code field after recoverable failure, and announces status changes.
- Reduced-motion preferences remove smooth scrolling and non-essential movement.

## State and safety contract

- Catalog: loading, populated, empty, and load-failure states remain visible.
- Detail: the reviewed GIF and caption describe the actual program-to-site flow and untouched final action.
- Install: ready, authorizing, disabled-until-endpoint, success, and recoverable failure states remain distinct in text, not color alone.
- The public site never contains or validates raw installer codes, product keys, verifiers, private object URLs, administrator controls, or direct installer URLs.
- Visual changes must not change route generation, platform fallback, the `/authorize` request shape, code clearing, or the 60-second server-side delivery boundary.

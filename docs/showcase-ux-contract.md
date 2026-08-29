# Showcase UX contract

## User and job

The public name is `한결`. Its promise is to make recurring work feel lighter so people can focus on the work that matters. Customer-facing brand and general-purpose copy do not use `nohdol auto`, `자동화`, or implementation terminology; existing product proper names and operational identifiers remain unchanged when renaming them would break truthful product or installation continuity.

The primary visitor has been told about a desktop program and wants to answer three questions without reading a campaign page:

1. What does the program do?
2. Is the recording a verified external workflow or a disclosed local demonstration?
3. Is the installer available now or still being prepared?

The catalog's primary action is choosing a program. A detail route leads with its reviewed workflow recording. An install route leads with the operating-system choice and installer-code control. Verified products may authorize a download; demo-only programs keep that control disabled and state `배포 준비 중` without attempting a request.

The catalog also explains the day-to-day program experience in plain Korean. It promises a clear screen, a natural order of use, visible progress, and understandable recovery guidance without naming implementation tools or asking visitors to understand development terminology.

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
- Detail: each reviewed GIF and caption identifies either the verified program-to-site flow or the deterministic demo-data boundary. Public copy does not use `UI 콘셉트`, `UI 프로토타입`, temporary-portfolio, or removal-plan language.
- Install: ready, authorizing, disabled-until-endpoint, success, and recoverable failure states remain distinct in text, not color alone.
- A disabled install preview may show the same route, platform selector, and code field as a distributed product, but it has `authEndpoint: null`, a disabled submit button, an early request guard, and an explicit not-yet-available message.
- The public site never contains or validates raw installer codes, product keys, verifiers, private object URLs, administrator controls, or direct installer URLs.
- Visual changes must not change route generation, platform fallback, the `/authorize` request shape, code clearing, or the 60-second server-side delivery boundary.

# LaunchPier brand system

LaunchPier is the identity for the existing Solana / Pump.fun workspace. The name suggests a clear place to prepare and begin a launch. The geometric symbol combines an L-shaped pier with a northeast arrow and a diagonal negative-space channel.

## Production assets

- `public/brand/launchpier-lockup-on-dark.svg`: cobalt symbol and light wordmark, for ink surfaces.
- `public/brand/launchpier-lockup-on-light.svg`: ink lockup, for light surfaces.
- `public/brand/launchpier-{symbol,wordmark,lockup}-{solid,cobalt,ink,light}.svg`: standalone and monochrome variants. All wordmarks use outlined, locally bundled Inter at weight 560; no external font request is required.
- `public/brand/launchpier-app-icon.svg`, 192px and 512px PNGs: application icon.
- `app/icon.svg`, `public/favicon.svg`, 16/32px PNGs, ICO and Apple touch icon: browser/application entry points.
- `src/components/layout/Brand.tsx`: code-native geometry for application chrome. The two paths are shared across every exported variant.

Preserve the mark's aspect ratio and its negative-space channel. Retain at least one stem width of clear space. Use the solid symbol at 16px rather than a small wordmark. The 16, 24 and 32px renderings were visually inspected.

## Color and typography

The default palette uses ink `#0E1322`, surface `#151D30`, elevated surface `#1D2940`, border `#303E58`, text `#EDF2FF`, secondary text `#B1BDD3` and cobalt `#9FB6FF`. Inter remains locally bundled. Cobalt identifies the next action, selected items and keyboard focus; ordinary content remains quiet.

Measured WCAG contrast ratios: primary text/surface 14.99:1; secondary/surface 8.87:1; secondary/elevated 7.68:1; cobalt/surface 8.49:1; ink button text/cobalt 9.35:1. These text pairs exceed 4.5:1.

## Appearance compatibility

Only exact full legacy stock palettes receive the new corresponding appearance when read. Even a one-channel custom color is retained. Compatibility reads do not overwrite the existing browser record; later explicit saves use the current public settings schema. Profile names, public funding wallet and shortcuts remain intact.

The storage key `outsol-workspace-preferences-v1`, preference export type, existing appearance events and trade-shortcut events remain unchanged. OutSol and Vanity SVG URLs remain valid aliases to the new geometry. Existing routes, domains, social URLs, wallet storage, private keys and transaction formats are not changed by this brand pass.

## Verification scope

Focused preference tests cover stock appearance migration, preservation of custom colors and stored data, legacy-compatible settings imports, and default text/action contrast. Shared UI changes still require the root task's final browser/responsive review before deployment.

## Share banner

The approved `public/brand/launchpier-banner.png` is 2172 × 724 pixels. Open Graph and X share metadata reference this image on the existing `outsol.online` domain. The landing footer provides a download; the page headline and fee disclosures remain accessible HTML.

Feature CSS modules use workspace surface, label and accent tokens so saved custom palettes remain effective. Explicit success/ready states retain a separate green `--status-success` token.

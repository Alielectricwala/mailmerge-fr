// Brand assets for server-rendered HTML (public pages, team emails).
// The mark mirrors src/client/components/brand/FocusRealmLogo.tsx and public/logo.svg — change them together.

export const BRAND = { navy: "#0D1B3E", blue: "#2168E8", sky: "#5B9BFF", ink: "#101828", muted: "#667085" } as const;

/** Static FocusRealm mark as inline SVG (browsers only; most email clients don't render SVG) */
export function brandMarkSvg(size = 32): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect width="48" height="48" rx="12" fill="${BRAND.navy}"/>
<g stroke="${BRAND.sky}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 16.5V12a3 3 0 0 1 3-3h4.5"/><path d="M31.5 9H36a3 3 0 0 1 3 3v4.5"/><path d="M39 31.5V36a3 3 0 0 1-3 3h-4.5"/><path d="M16.5 39H12a3 3 0 0 1-3-3v-4.5"/></g>
<g stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="15" y="17" width="18" height="14" rx="2.5"/><path d="M16.5 19 24 24.75 31.5 19"/></g>
</svg>`;
}

/** Email-safe lockup: a table "tile" instead of an image, so it shows even with images blocked */
export function emailBrandHeader(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr>
<td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:${BRAND.navy};border-radius:9px;color:#fff;font:700 13px/36px Inter,Arial,sans-serif;letter-spacing:.5px">FR</td>
<td style="padding-left:10px;font-family:Inter,Arial,sans-serif;line-height:16px">
<div style="font-size:15px;font-weight:600;color:${BRAND.navy}">FocusRealm</div>
<div style="font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.muted}">Mail Merge</div>
</td></tr></table>`;
}

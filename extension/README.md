# OutSol browser companion

Prepare an editable token launch draft from a public HTTPS page, selected page text, or an image. This unpacked Manifest V3 extension works in desktop Chrome and Microsoft Edge. It has not been published to either browser store.

## Install the downloaded ZIP

1. Download `outsol-extension.zip` from https://outsol.online/extension.
2. Extract the ZIP into a folder you can keep on your computer. Do not try to load the ZIP itself.
3. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
4. Turn on **Developer mode**. Choose **Load unpacked**.
5. Select the extracted folder containing `manifest.json`.
6. Pin **OutSol — Token Drafts** from your browser's extensions menu.

Open a public HTTPS website and click OutSol, or right-click a page, ordinary selected text, or an image and choose the OutSol action. Edit the token name, symbol, description, source URL, and optional image suggestion. Click **Open launch draft** to send those reviewed fields to https://outsol.online/extension. The app will ask you to review the import before creating a launch draft.

The browser may block extensions on its internal pages, extension stores, PDF viewers, or other protected pages. HTTP sites, credentials in URLs, local/private network sites, and IPv6 literals are unsupported. Ordinary public HTTPS pages are supported; no extension can promise every website will expose usable metadata. Symbol entry is intentionally manual.

## What is read and shared

- Only after you click the toolbar button or a context-menu action: page title, a same-origin canonical URL, description metadata, safe selected page text, and obvious social-image metadata or the image you right-clicked.
- Text inside inputs, textareas, selects, or editable regions is never captured. The extension does not read form values, cookies, passwords, page HTML, wallet keys, or browsing history.
- URL credentials are rejected, and URL queries and fragments are removed. Review the remaining path and text before sharing; a website can put sensitive information in either.
- Captured information stays in the popup, or in a local extension review tab after a context-menu action. Nothing is sent to OutSol until **Open launch draft**. A context-menu review clears its temporary capture fragment and keeps editable suggestions in that tab's session storage so refresh can recover them. Close the review tab to discard it.
- The handoff uses a URL fragment containing only the reviewed draft fields. The extension sends no telemetry, makes no network requests, and never signs transactions. The destination is fixed to `https://outsol.online/extension`.
- Image links remain suggestions; the extension does not download images. OutSol does not fetch or upload linked images automatically. Choose and upload artwork in the app, and use material you have permission to use.
- OutSol keeps the public capture review in the receiving tab's session storage across refresh. Save the launch draft to keep artwork locally too; an unsaved image must be chosen again after refresh. **Close capture** clears the tab's temporary review. Browser storage must be enabled for recovery.
- `activeTab` grants temporary access after your gesture, `scripting` reads the limited metadata described above, and `contextMenus` adds the three right-click actions. No all-sites host permission is requested.

To update, extract a newer download into the same folder and click **Reload** on the extension card. To uninstall, choose **Remove** on that card. Developer-mode extensions are a manual installation; store distribution requires a separate publisher submission.

## Source and package

The repository's `extension/` directory is the complete extension source. From the repository root, run `node scripts/package-extension.mjs` to render the existing OutSol logo into PNG icons and create `public/downloads/outsol-extension.zip`. The ZIP contains only the explicit extension files and icons, with fixed timestamps for reproducible packaging.

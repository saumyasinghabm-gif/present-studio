# Present Studio Frontend

This package contains the standalone frontend for the gold-themed Present Studio interface. It intentionally contains only HTML, CSS, and browser JavaScript so a separate backend team can connect its own APIs later.

## Included pages

| File | Purpose |
|---|---|
| `login.html` | Gold-themed login and signup UI with local demo sign-in behavior |
| `index.html` | Presentation workspace with thumbnails, editor canvas, media panel, presenter choices, AI panel, and share controls |
| `css/style.css` | Complete responsive gold editorial design system |
| `js/login.js` | Login-page demo interactions |
| `js/app.js` | Slide navigation, local editing, drag, resize, formatting, media selection, AI demo feedback, and share-link demo behavior |

## Run in VS Code

No installation or backend is required for the visual demo. Open the folder in VS Code, install the **Live Server** extension if desired, right-click `login.html`, and choose **Open with Live Server**. You can also open `login.html` directly in a browser.

The demo login accepts any valid-looking email and password. The data is stored only in the current browser session and is not sent to a server.

## Backend integration points

A backend team can later replace the local demo handlers with real API calls for authentication, slide persistence, media storage, AI generation, share links, and live presenter synchronization. The current package contains no backend, database, Docker, React, tRPC, OAuth, Manus, or environment-secret files.

## Notes

The interface uses Google Fonts through a CSS import. If the project must work fully offline, replace the font import with local font files supplied by the design team.

# Backend Contract

The frontend is wired through `frontend/js/api.js`. Frontend page scripts should use `window.PresentStudioApi`.

## Authentication

### `POST /api/auth/signup`

Request:

```json
{
  "name": "Alex Smith",
  "email": "user@example.com",
  "password": "password123"
}
```

Response:

```json
{
  "user": {
    "id": "usr_123",
    "name": "Alex Smith",
    "email": "user@example.com",
    "role": "owner"
  },
  "accessToken": "jwt-token"
}
```

### `POST /api/auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "password"
}
```

Response:

```json
{
  "user": {
    "id": "usr_123",
    "name": "Alex Smith",
    "email": "user@example.com",
    "role": "owner"
  },
  "accessToken": "jwt-token"
}
```

### `GET /api/auth/me`

Response:

```json
{
  "user": {
    "id": "usr_123",
    "name": "Alex Smith",
    "email": "user@example.com",
    "role": "owner"
  }
}
```

### `POST /api/auth/logout`

Response:

```json
{ "ok": true }
```

## Presentations

### `GET /api/presentations`

Response:

```json
{
  "presentations": [
    {
      "id": "pres_123",
      "title": "Welcome Deck",
      "ownerName": "Alex Smith",
      "updatedAt": "2026-08-24T09:00:00.000Z",
      "slides": []
    }
  ]
}
```

### `POST /api/presentations`

Request:

```json
{
  "title": "Untitled presentation"
}
```

Response:

```json
{
  "presentation": {
    "id": "pres_123",
    "title": "Untitled presentation",
    "slides": []
  }
}
```

### `PUT /api/presentations/:id`

Request:

```json
{
  "id": "pres_123",
  "title": "Welcome Deck",
  "slides": []
}
```

Response:

```json
{
  "presentation": {
    "id": "pres_123",
    "title": "Welcome Deck",
    "slides": []
  }
}
```

## Sharing

### `POST /api/presentations/:id/share`

Response:

```json
{
  "url": "https://app.example.com/present.html?id=pres_123&token=token_abc",
  "token": "token_abc"
}
```

Audience access uses the secure token.

## Media

The backend uploads files to Cloudinary.

### `POST /api/media/upload`

Response:

```json
{
  "asset": {
    "id": "asset_123",
    "name": "image.png",
    "mimeType": "image/png",
    "url": "https://res.cloudinary.com/example/image/upload/...",
    "size": 238123
  }
}
```

## Live Session

### `GET /api/presentations/:id/live`

Response:

```json
{
  "presentationId": "pres_123",
  "activeSlideId": "slide_2",
  "isLive": true
}
```

## AI

### `POST /api/ai/generate-slide`

Request:

```json
{
  "prompt": "Create an opening slide for a sales review"
}
```

Response:

```json
{
  "title": "A clearer story",
  "subtitle": "Generated from your prompt"
}
```

## Live Presenting

Use Socket.IO for active slide changes. Keep events small.

Presenter emits:

```json
{
  "presentationId": "pres_123",
  "slideId": "slide_2"
}
```

Audience receives the active slide ID and renders the already-loaded slide JSON.

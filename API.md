# Syl-DB API Documentation

Base URL: `http://localhost:4000/api/v1` (sesuaikan dengan environment).

## Authentication

API ini menggunakan skema autentikasi **JWT Bearer Token**. Untuk endpoint yang membutuhkan autentikasi, tambahkan header berikut pada request:

```http
Authorization: Bearer <your_token_here>
```

### Roles
Beberapa endpoint dibatasi untuk role tertentu:
- `owner`: Akses penuh ke semua fitur.
- `editor`: Dapat membuat/mengedit track dan mengatur lirik.
- `viewer`: Hanya dapat melihat (read-only).

---

## 1. General & Health

### `GET /`
Mengembalikan status dasar server.
- **Auth Required:** No
- **Response:**
  ```json
  {
    "name": "syl-db",
    "version": "0.1.0",
    "status": "ok"
  }
  ```

### `GET /health`
Mengecek koneksi ke database SQLite.
- **Auth Required:** No
- **Response:**
  ```json
  {
    "status": "ok"
  }
  ```

---

## 2. Authentication Endpoints

### `POST /auth/login`
Autentikasi user dan mendapatkan JWT token.
- **Auth Required:** No
- **Request Body (JSON):**
  ```json
  {
    "username": "admin",
    "password": "password123"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "user": {
      "id": 1,
      "username": "admin",
      "role": "owner"
    },
    "token": "eyJhbG..."
  }
  ```

### `GET /auth/tokens`
Mendapatkan daftar API token statis milik user yang sedang login.
- **Auth Required:** Yes (Any role)

### `POST /auth/tokens`
Membuat API token baru.
- **Auth Required:** Yes (Any role)

### `DELETE /auth/tokens/{id}`
Menghapus API token.
- **Auth Required:** Yes (Any role)

---

## 3. Track Endpoints

Tipe data Response standar untuk Track (`TrackResponse`):
```json
{
  "id": 134,
  "slug": "radiohead-let-down",
  "title": "Let Down",
  "artist": "Radiohead",
  "album": "OK Computer",
  "status": "draft",
  "visibility": "private",
  "created_at": "2026-08-28T10:00:00Z",
  "updated_at": "2026-08-28T10:00:00Z"
}
```

### `GET /tracks`
Mendapatkan daftar track. Mendukung pagination.
- **Auth Required:** No
- **Query Parameters:**
  - `limit` (default: 500)
  - `offset` (default: 0)
- **Response:** Array of `TrackResponse`

### `POST /tracks`
Membuat track baru.
- **Auth Required:** Yes (`owner`, `editor`)
- **Request Body (Multipart Form / JSON):**
  Menerima fields seperti `title`, `artist`, `album`, `status`, `visibility`.
- **Response (201 Created):** `TrackResponse`

### `GET /tracks/{trackID}`
Mendapatkan detail track beserta snapshot/lirik versi terbaru.
- **Auth Required:** No
- **Response:**
  ```json
  {
    "id": 134,
    "title": "Let Down",
    "artist": "Radiohead",
    "current_version": {
       "id": 200,
       "version_no": 1,
       "content_json": "{\"meta\":{...}, \"lines\":[...]}",
       "content_hash": "..."
    }
  }
  ```

### `PATCH /tracks/{trackID}`
Mengupdate informasi metadata dari track.
- **Auth Required:** Yes (`owner`, `editor`)
- **Request Body (JSON):** 
  ```json
  {
    "title": "New Title",
    "status": "review"
  }
  ```
- **Response:** `TrackResponse` terbaru

### `DELETE /tracks/{trackID}`
Menghapus track beserta seluruh riwayat versi liriknya.
- **Auth Required:** Yes (`owner`, `editor`)

---

## 4. Lyrics & Versioning

### `POST /tracks/{trackID}/import`
Mengimpor lirik baru dari format TTML. Endpoint ini digunakan oleh Composer saat fitur "Save to Syl-DB".
- **Auth Required:** Yes (`owner`, `editor`)
- **Request Body:** Raw XML string (TTML format)
- **Keterangan:** Secara otomatis akan meng-ekstrak `<ttm:title>` dan `<composer:meta>` lalu mengupdate tabel utama Track, kemudian menyimpan AST JSON sebagai versi terbaru (Snapshot).

### `GET /tracks/{trackID}/export`
Mengekspor lirik dalam berbagai format. Digunakan oleh Composer untuk memuat project ("Load dari Syl-DB").
- **Auth Required:** No
- **Query Parameters:**
  - `format` = `ttml` | `json` | `txt` | `lrc` | `lrc-enhanced` (default: `ttml`)
- **Response:** File RAW sesuai format (Content-Type: `application/ttml+xml`, `application/json`, atau `text/plain`).

### `GET /tracks/{trackID}/versions`
Melihat seluruh riwayat (history) snapshot versi lirik dari sebuah track.
- **Auth Required:** No
- **Response:** Array of `SnapshotResponse`.

### `GET /tracks/{trackID}/versions/{versionNo}`
Mengambil data lirik spesifik pada nomor versi tertentu.
- **Auth Required:** No

### `POST /tracks/{trackID}/versions`
Membuat snapshot baru menggunakan JSON CanonicalAST (bukan TTML). 
- **Auth Required:** Yes (`owner`, `editor`)
- **Request Body:** CanonicalAST JSON object.

### `POST /tracks/{trackID}/rollback`
Mengembalikan lirik ke versi yang lebih lama dengan membuat snapshot baru berdasarkan versi lama tersebut.
- **Auth Required:** Yes (`owner`, `editor`)
- **Request Body (JSON):**
  ```json
  {
    "target_version": 2
  }
  ```

---

## 5. Search

### `GET /search`
Melakukan pencarian pintar (fuzzy matching) ke database berdasarkan judul dan/atau artis. 
Jika format disematkan, maka akan langsung mengembalikan file raw (lirik) dari track dengan kecocokan tertinggi (To the point export).

- **Auth Required:** No
- **Query Parameters:**
  - `q`: String pencarian gabungan (contoh: "let down radiohead").
  - `title`: (Opsional) Filter pencarian judul lagu.
  - `artist`: (Opsional) Filter pencarian nama artis.
  - `format`: (Opsional) Format lirik `ttml` | `json` | `txt` | `lrc` | `lrc-enhanced`.
- **Keterangan:**
  - Anda cukup mengirimkan `q`, atau kombinasi `title` & `artist`.
  - Tanda kurung di dalam pencarian (seperti `(Acoustic)`) akan otomatis dibersihkan oleh algoritma *fuzzy scoring*.
- **Response:** 
  - Jika **tidak ada** parameter `format`: Mengembalikan `TrackResponse` (JSON) tunggal dengan skor kecocokan tertinggi.
  - Jika **ada** parameter `format`: Langsung men-download file lirik RAW (Contoh: tipe konten `text/plain` untuk LRC).

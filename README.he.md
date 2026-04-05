# קניות ביחד 🛒

אפליקציית רשימת קניות משפחתית — שיתופית, מסונכרנת בזמן אמת, תומכת בעברית ועובדת גם ללא אינטרנט.

---

## מה זה?

אפליקציית PWA (Progressive Web App) לניהול רשימות קניות משותפות למשפחות, זוגות ושותפים לדירה.

**תכונות עיקריות:**
- סנכרון בזמן אמת בין כל המכשירים — מה שאחד מוסיף, כולם רואים מיד
- קטלוג מרכזי של פריטים עם תמונות, קטגוריות וכמויות ברירת מחדל
- מצב קנייה — ממשק נקי ומהיר לסימון פריטים ברכישה
- פריטים קבועים — הוספה אוטומטית של פריטים שקונים כל שבוע/חודש
- תמיכה מלאה בעברית ו-RTL
- עובד ללא אינטרנט — שינויים מסונכרנים כשהחיבור חוזר
- התראות push על הוספת פריטים ורכישות

---

## התחלה מהירה

```bash
# 1. שכפל את הפרויקט
git clone <repo-url>
cd shopping-app

# 2. צור קובץ סביבה
cp .env.example .env
# ערוך את .env — שנה סיסמאות ו-JWT_SECRET

# 3. הפעל את כל השירותים
docker compose up --build
```

האפליקציה תהיה זמינה בכתובת: **http://localhost**

זהו. פקודה אחת מפעילה את כל 7 השירותים.

---

## מבנה הפרויקט

```
shopping-app/
├── docker-compose.yml          # הגדרת כל השירותים
├── .env.example                # תבנית משתני סביבה
├── nginx/
│   └── nginx.conf              # Reverse proxy, rate limiting, WebSocket
├── scripts/
│   └── init.sql                # אתחול PostgreSQL (הפעלת pg_trgm)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py             # אפליקציית FastAPI — נקודת כניסה
│       ├── config.py           # הגדרות מ-environment variables
│       ├── ws_server.py        # שרת WebSocket נפרד (port 8001)
│       ├── models/
│       │   ├── models.py       # כל טבלאות הדאטאבייס (SQLAlchemy)
│       │   └── database.py     # חיבור async לדאטאבייס
│       ├── schemas/
│       │   └── schemas.py      # Pydantic schemas — ולידציה של בקשות/תגובות
│       ├── routers/
│       │   └── routers.py      # כל ה-API endpoints
│       ├── services/
│       │   ├── auth_service.py # JWT, bcrypt, רוטציית טוקנים
│       │   ├── deps.py         # FastAPI dependencies (אימות + RBAC)
│       │   ├── redis_service.py # Pub/sub, cache, idempotency
│       │   └── image_service.py # העלאת תמונות ל-MinIO + thumbnail
│       └── workers/
│           └── worker.py       # Celery tasks + Beat scheduler
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts          # Vite + PWA plugin
    └── src/
        ├── api/
        │   └── client.ts       # API client + תור offline (IndexedDB)
        └── sw.ts               # Service worker (push + background sync)
```

---

## שירותים (Docker Compose)

| שירות    | Image                  | פורט  | תפקיד                                   |
|----------|------------------------|-------|-----------------------------------------|
| nginx    | nginx:1.25-alpine      | 80    | Reverse proxy, TLS, קבצים סטטיים        |
| frontend | node:20 → alpine       | —     | בניית React (מייצא לvolume משותף)        |
| api      | python:3.12-slim       | 8000  | FastAPI REST API                        |
| ws       | python:3.12-slim       | 8001  | שרת WebSocket לסנכרון בזמן אמת          |
| worker   | python:3.12-slim       | —     | Celery worker + Beat scheduler          |
| db       | postgres:16-alpine     | 5432  | דאטאבייס ראשי                           |
| redis    | redis:7-alpine         | 6379  | Cache · pub/sub · תור משימות            |
| minio    | minio/minio            | 9001  | אחסון תמונות (תואם S3)                  |

---

## ה-API

תיעוד אינטראקטיבי מלא זמין בכתובת:
**http://localhost/api/docs** (Swagger UI)
**http://localhost/api/redoc** (ReDoc)

### נקודות קצה עיקריות

**אימות**
```
POST /auth/register     — הרשמה
POST /auth/login        — כניסה
POST /auth/refresh      — רענון טוקן (httpOnly cookie)
GET  /auth/me           — פרטי המשתמש המחובר
```

**משקי בית**
```
GET  /households                    — רשימת משקי הבית שלי
POST /households                    — יצירת משק בית
GET  /households/{id}/members       — חברי משק הבית
POST /households/{id}/invite        — הזמנת חבר
```

**קטלוג**
```
GET  /catalog/categories            — כל הקטגוריות
GET  /catalog/items?q=חלב           — חיפוש פריט (Hebrew fuzzy)
GET  /catalog/items/check-duplicate — בדיקת כפילות לפני יצירה
POST /catalog/items                 — יצירת פריט חדש בקטלוג
POST /catalog/items/{id}/image      — העלאת תמונה לפריט
```

**רשימות**
```
GET  /lists                         — הרשימות שלי
POST /lists                         — יצירת רשימה חדשה
GET  /lists/{id}/items              — פריטי הרשימה
POST /lists/{id}/items              — הוספת פריט לרשימה
POST /lists/{id}/items/{id}/status  — סימון כנקנה/ממתין
DELETE /lists/{id}/items/{id}       — מחיקת פריט
POST /lists/{id}/sync               — סנכרון offline mutations
```

**פריטים קבועים**
```
GET    /households/{id}/recurring        — כל הפריטים הקבועים
POST   /households/{id}/recurring        — יצירת פריט קבוע
PATCH  /households/{id}/recurring/{id}   — עדכון (הפעלה/השהייה/תדירות)
DELETE /households/{id}/recurring/{id}   — מחיקה
```

---

## מודל הרשאות

### רמת משק הבית

| תפקיד  | יכולות                                                      |
|--------|-------------------------------------------------------------|
| owner  | כל הפעולות + העברת בעלות + מחיקת משק הבית                  |
| admin  | הזמנת חברים + ניהול פריטים קבועים + יצירת רשימות            |
| member | צפייה בכל הרשימות + יצירת רשימות משלו                       |

### רמת רשימה

| תפקיד  | יכולות                                           |
|--------|--------------------------------------------------|
| admin  | הזמנה + שינוי תפקידים + מחיקת רשימה              |
| editor | הוספה/עריכה/מחיקה של פריטים + סימון כנקנה        |
| viewer | צפייה בלבד                                       |

**כלל הירושה:** תפקיד ברשימה לא יכול לעלות על תפקיד במשק הבית.

---

## סנכרון בזמן אמת

```
User A (שינוי פריט)
    │
    ↓ REST PATCH
FastAPI → PostgreSQL (שמירה)
    │
    ↓ Redis PUBLISH list:{id}
WebSocket Server (subscribes ל-list:*)
    │
    ↓ fan-out
User B, User C (רואים שינוי מיד)
```

כל שינוי מתועד ב-`mutation_events` — לסנכרון offline.

---

## עבודה ללא אינטרנט

1. **Service Worker** מיירט כל קריאות ל-`/api/*`
2. כשאין חיבור — המוטציה נשמרת ב-**IndexedDB** עם `idempotency_key`
3. כשהחיבור חוזר — `navigator.online` event מפעיל:
   - שליחת כל המוטציות מהתור בסדר כרונולוגי
   - שליפת ה-diff מהשרת מאז ה-cursor האחרון
   - מיזוג עם last-write-wins לפי vector clocks

---

## פריטים קבועים — איך עובד?

Celery Beat מריץ כל **15 דקות**:

```
1. שאילתה: WHERE next_run_date <= NOW() AND is_enabled = true
2. לכל פריט שמגיע:
   - auto_add=true  → מוסיף לרשימה (idempotent — לא מכפיל)
   - auto_add=false → שולח Push notification "כדאי לקנות: X"
3. מקדם את next_run_date ב-interval_days
```

---

## חיפוש בעברית

מופעל על ידי `pg_trgm` (PostgreSQL trigram extension):

- **נרמול לפני חיפוש:** הסרת ניקוד → המרת אותיות סופיות (ך→כ, ם→מ) → lowercase
- **Fuzzy matching:** `similarity(name_he_normalized, query) > 0.15`
- **דבאונס:** 120ms (מהיר מהרגיל — מקלדת עברית מהירה)
- **דירוג תוצאות:** התאמה מדויקת → trigram similarity → פופולריות גלובלית

---

## התראות Push

```bash
# יצירת VAPID keys
pip install py-vapid
python -m py_vapid --gen-key
# הוסף את הפלט ל-.env
```

אירועים שמפעילים התראה:
- פריט נוסף לרשימה (לכולם חוץ ממי שהוסיף)
- פריט קנה (למנהלי הרשימה)
- פריט קבוע נוסף אוטומטית
- הצעה לפריט קבוע (suggest mode)

---

## פיתוח מקומי

```bash
# הפעל רק את התשתית (DB + Redis + MinIO)
docker compose up db redis minio

# הרץ את ה-API בlocalhost
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
# → http://localhost:8000/docs

# הרץ Celery worker
celery -A app.workers.worker.celery_app worker --beat --loglevel=debug

# Frontend עם HMR
cd frontend
npm install
npm run dev
# → http://localhost:5173

# התחבר לדאטאבייס
docker compose exec db psql -U postgres -d shopping

# ניטור Celery tasks
docker compose exec worker celery -A app.workers.worker.celery_app flower
# → http://localhost:5555
```

---

## Production Checklist

- [ ] שנה `JWT_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY` ב-`.env`
- [ ] הוסף TLS certificate ל-Nginx (Let's Encrypt)
- [ ] הגדר `ENVIRONMENT=production`
- [ ] הגדר VAPID keys להתראות push
- [ ] עדכן `CORS_ORIGINS` לדומיין האמיתי
- [ ] השתמש ב-Alembic migrations במקום `create_all`
- [ ] הגדר גיבויים ל-PostgreSQL
- [ ] הפרד את Celery worker ו-Beat לשני containers נפרדים
- [ ] הוסף `FLOWER_BASIC_AUTH` לניטור Celery

---

## טכנולוגיות

| שכבה        | טכנולוגיה                                         |
|-------------|---------------------------------------------------|
| Frontend    | React 18 · TypeScript · Vite · Zustand · PWA      |
| Backend     | FastAPI · Python 3.12 · SQLAlchemy async · Pydantic |
| Realtime    | WebSockets · Redis pub/sub                         |
| Database    | PostgreSQL 16 · pg_trgm (חיפוש עברי)              |
| Jobs        | Celery · Celery Beat · RedBeat                     |
| Storage     | MinIO (S3-compatible) · Pillow (thumbnails)        |
| Auth        | JWT · bcrypt · httpOnly cookies                    |
| Infra       | Docker Compose · Nginx                             |

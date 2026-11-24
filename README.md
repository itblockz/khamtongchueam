# Khamtongchueam

เกมคำต้องเชื่อมแบบ React + Vite โดยมี backend Python สำหรับแยกพยางค์ภาษาไทย

## Development

ใช้คำสั่งเดียว:

```bash
npm run dev
```

คำสั่งนี้จะ:
- เปิด backend ที่ `http://127.0.0.1:8000`
- รอให้ `GET /api/health` พร้อม
- แล้วค่อยเปิด Vite dev server
- ใช้ Python จาก `.venv` อัตโนมัติถ้ามี

ถ้าต้องการเปิดแยก:

```bash
npm run dev:backend
npm run dev:frontend
```

## Python backend

ติดตั้ง dependency backend:

```bash
python -m venv .venv
.\.venv\Scripts\pip install -r backend\requirements.txt
.\.venv\Scripts\pip install -r backend\requirements-dev.txt
```

backend ใช้ `PyThaiNLP syllable_tokenize()` และ default engine คือ `han_solo`

- `backend/requirements.txt`: dependency ตอนเล่นจริง (เล็ก ใช้ deploy)
- `backend/requirements-dev.txt`: เพิ่ม test และเครื่องมือวิจัย (`ssg`, `tltk`, `pandas`) ต้องติดตั้งก่อนรัน `npm run benchmark:syllables`

## Deploy บน Vercel

- หน้าเกม: `npm run build` → `dist` บน CDN
- backend: `api/index.py` (FastAPI ตัวเดียวกับ `backend/app/main.py`) ติดตั้งจาก `requirements.txt` ที่ root (ต้องตรงกับ `backend/requirements.txt`)
- `vercel.json` ส่ง `/api/*` ไปที่ฟังก์ชัน Python
- environment variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (ถ้าไม่ใส่ ระบบเก็บคำจะปิด)

## Useful scripts

```bash
npm test
npm run lint
npm run build
npm run test:backend
npm run benchmark:syllables
```

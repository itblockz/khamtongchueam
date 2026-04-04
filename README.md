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

## Useful scripts

```bash
npm test
npm run lint
npm run build
npm run test:backend
npm run benchmark:syllables
```

# Testing MeetSummarizer

Follow these steps to get the entire application running on your local machine for testing.

---

## 🚀 1. Start the Database (Docker)
Ensure Docker Desktop is running, then start the PostgreSQL container:
```bash
docker compose up db -d
```
*Note: The database is configured to run on port **5433** to avoid conflicts.*

---

## ⚙️ 2. Start the Backend Server
Navigate to the backend directory and start the Node.js server:
```bash
cd backend
npm install  # (If not already done)
node index.js
```
**Expected Output:** `Backend server running on port 4000`

---

## 💻 3. Start the Frontend (Vite)
Open a new terminal, navigate to the frontend directory, and start the development server:
```bash
cd frontend
npm install  # (If not already done)
npm run dev
```
**Access the app at:** [http://localhost:5173](http://localhost:5173)

---

## 🎙️ 4. Start the Transcription Node (Optional)
If you want to test the transcription service itself:
```bash
cd transcription-node
# Activate your virtual environment
.\venv\Scripts\activate  # Windows
source venv/bin/activate # Mac/Linux

python main.py
```
**Expected Output:** `Uvicorn running on http://0.0.0.0:5000`

---

## 🧪 5. Testing the Application Flow

### **A. Join Screen & Identity**
1.  Open [http://localhost:5173](http://localhost:5173).
2.  Grant Camera/Mic permissions when prompted.
3.  Enter a **Display Name**.
4.  Click **Create Meeting**.

### **B. Meeting Room UI**
1.  You should be redirected to the meeting room.
2.  Check if your **Meeting ID** is displayed in the header.
3.  Toggle your **Mic** and **Camera** using the floating controls at the bottom.
4.  Test the **Sidebar** by switching between "Summary" and "Transcript" tabs.

### **C. Multi-User Test**
1.  Copy the **Meeting ID** from the header.
2.  Open a new browser window (Incognito works best).
3.  Go to [http://localhost:5173](http://localhost:5173).
4.  Enter a different **Display Name**.
5.  Paste the **Meeting ID** into the "Join Room" input and click **Join Meeting**.
6.  Check the Backend terminal logs to see both users connected.

### **D. Database Validation**
You can check if users and meetings are being created by visiting the health check:
[http://localhost:4000/health](http://localhost:4000/health)

---

## 🛠️ Troubleshooting
- **Port Conflict**: If port 4000 or 5173 is busy, check for running `node` processes in Task Manager and terminate them.
- **Database Error**: Ensure `docker ps` shows `summarizer-db-1` as "Up".
- **Permissions**: If the camera doesn't show, ensure you haven't blocked permissions for `localhost`.

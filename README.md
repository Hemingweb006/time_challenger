# Time Challenger - by Synaptic
[https://github.com/Hemingweb006/time_challenger/video.mp4](https://github.com/Hemingweb006/time_challenger/blob/main/video.mp4)
> **Beat the artificial intelligence predictions. Our best adversary is ourselves.**

Time Challenger is a gamified productivity web application that uses Google's time-series forecasting model, **TimesFM 2.5**, to predict your daily work hours. Your mission is to exceed the AI expectations every day.

---

## Quick Start

```bash
git clone https://github.com/synaptic/time-challenger.git
cd time-challenger
chmod +x start.sh
./start.sh
```

The `start.sh` script:
- Creates a Python virtual environment `.venv`
- Installs all dependencies (FastAPI, PyTorch, Transformers...)
- Verifies the availability of Google TimesFM 2.5
- Launches the server at `http://localhost:8000`
- Automatically opens your default web browser

---

## How It Works

1. **Initial Setup** — Define your daily work hour range (e.g., 4h to 8h). The app generates 30 days of historical focus data using a normal distribution $N(\mu, \sigma)$ to calibrate the Google TimesFM forecaster.

2. **AI Prediction** — Google TimesFM 2.5 (200M parameters) analyzes your historical cycles and predicts your target work hours for the next 7 days.

3. **The Challenge** — Every day, work more than what the AI predicted. Use the built-in focus tools (Pomodoro, Stopwatch) to maximize your time.

4. **Results** — Focus hours are automatically logged and synchronized in real-time. If you beat the prediction, you achieve Victory.

---

## Technical Stack

| Component | Technology |
|-----------|-------------|
| Backend | FastAPI + Uvicorn |
| AI | Google TimesFM 2.5 (200M) via HuggingFace Transformers |
| Fallback AI | Synaptic-SFM 1.0 (Advanced Statistical Engine) |
| Frontend | Vanilla HTML/CSS/JS + Chart.js |
| Database | SQLite3 |
| Audio | Web Audio API (chime notifications) |

---

## Project Structure

```
time_challenger/
├── backend/
│   ├── __init__.py
│   ├── database.py       # SQLite operations & data simulation
│   ├── model_forecast.py # TimesFM 2.5 + statistical fallback
│   └── main.py           # FastAPI routes & static file serving
├── frontend/
│   ├── index.html        # Single-page application
│   ├── css/style.css     # Dark neon glassmorphism design
│   └── js/app.js         # Client-side logic & timers
├── requirements.txt
├── start.sh              # Startup script
└── README.md
```

---

## License

Project created by **Synaptic**. Personal and educational use.

import os
import logging
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.database import (
    check_first_time,
    save_settings_and_generate_history,
    get_settings,
    get_history,
    get_history_hours_only,
    log_actual_hours,
    save_predictions,
    get_predictions,
    get_yesterday_result,
    get_current_streak,
    get_today_tracking,
    save_today_tracking,
    finalize_past_days,
    reset_all
)
from backend.model_forecast import generate_7day_forecast

logger = logging.getLogger("time_challenger.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Server starting — checking for unfinalized past days...")
    if not check_first_time():
        finalized = finalize_past_days()
        if finalized:
            logger.info(f"Auto-finalized {len(finalized)} past day(s):")
            for f in finalized:
                logger.info(f"  {f['date']}: {f['hours']}h logged")
            settings = get_settings()
            if settings:
                history_hours = get_history_hours_only()
                forecasts, model_name = generate_7day_forecast(
                    history_hours, settings["min_hours"], settings["max_hours"]
                )
                prediction_records = []
                today = datetime.now().date()
                for idx, pred_val in enumerate(forecasts):
                    target_date = today + timedelta(days=idx)
                    prediction_records.append({
                        "date": target_date.strftime("%Y-%m-%d"),
                        "hours": pred_val
                    })
                save_predictions(prediction_records, model_name)
                logger.info(f"Forecast updated using {model_name} with {len(history_hours)} data points.")
        else:
            logger.info("No past days to finalize.")
    else:
        logger.info("App not initialized yet — skipping finalization.")
    yield
    logger.info("Server shutting down.")

app = FastAPI(title="Time Challenger API by Synaptic", lifespan=lifespan)

class SettingsInit(BaseModel):
    min_hours: float = Field(..., ge=0.0, le=24.0)
    max_hours: float = Field(..., ge=0.0, le=24.0)

class TrackingUpdate(BaseModel):
    accumulated_seconds: int = Field(..., ge=0)

@app.get("/api/status")
async def get_status():
    first_time = check_first_time()
    return {"first_time": first_time}

@app.post("/api/initialize")
async def initialize_app(data: SettingsInit):
    if data.min_hours > data.max_hours:
        raise HTTPException(status_code=400, detail="Minimum hours cannot exceed maximum hours")
    try:
        save_settings_and_generate_history(data.min_hours, data.max_hours)
        history_hours = get_history_hours_only()
        forecasts, model_name = generate_7day_forecast(history_hours, data.min_hours, data.max_hours)
        prediction_records = []
        today = datetime.now().date()
        for idx, pred_val in enumerate(forecasts):
            target_date = today + timedelta(days=idx)
            prediction_records.append({
                "date": target_date.strftime("%Y-%m-%d"),
                "hours": pred_val
            })
        save_predictions(prediction_records, model_name)
        return {"status": "success", "message": "Time Challenger initialized successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Initialization failed: {str(e)}")

@app.get("/api/dashboard")
async def get_dashboard():
    first_time = check_first_time()
    if first_time:
        return {"initialized": False}
    settings = get_settings()
    history = get_history()
    forecasts = get_predictions()
    streaks = get_current_streak()
    yesterday = get_yesterday_result()
    tracking = get_today_tracking()
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_target = (settings["min_hours"] + settings["max_hours"]) / 2.0
    for f in forecasts:
        if f["date"] == today_str:
            today_target = f["hours"]
            break
    today_hours = round(tracking["seconds"] / 3600.0, 2)
    return {
        "initialized": True,
        "settings": settings,
        "history": history,
        "forecasts": forecasts,
        "streaks": streaks,
        "yesterday": yesterday,
        "today_target": today_target,
        "today_accumulated_seconds": tracking["seconds"],
        "today_accumulated_hours": today_hours,
        "today_date": today_str
    }

@app.post("/api/track")
async def update_tracking(data: TrackingUpdate):
    first_time = check_first_time()
    if first_time:
        raise HTTPException(status_code=400, detail="App not initialized")
    save_today_tracking(data.accumulated_seconds)
    settings = get_settings()
    forecasts = get_predictions()
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_target = (settings["min_hours"] + settings["max_hours"]) / 2.0
    for f in forecasts:
        if f["date"] == today_str:
            today_target = f["hours"]
            break
    current_hours = round(data.accumulated_seconds / 3600.0, 2)
    difference = round(current_hours - today_target, 1)
    return {
        "status": "saved",
        "accumulated_hours": current_hours,
        "today_target": today_target,
        "difference": difference,
        "beating": difference > 0
    }

@app.get("/api/tips")
async def get_productivity_tips():
    return [
        {
            "title": "Pomodoro Technique (Synaptic Edition)",
            "description": "Work with intense focus for 25 minutes on a single task without any distractions, then take a full 5-minute break. After 4 cycles, reward yourself with a longer 15-30 minute break. This rhythm structures your brain's concentration patterns.",
            "duration": "25 min focus / 5 min break",
            "icon": "timer"
        },
        {
            "title": "Ultradian Rhythms",
            "description": "The human brain operates in energy cycles of 90-120 minutes. Focus on deep work blocks of 90 minutes, then recharge for 20 minutes away from all screens to prevent burnout and maintain peak performance throughout the day.",
            "duration": "90 min focus / 20 min rest",
            "icon": "activity"
        },
        {
            "title": "Eat the Frog",
            "description": "Identify the most complex, stressful, or important task of your day and tackle it first thing in the morning. Once it's done, the rest of your day will feel fluid and motivating.",
            "duration": "Start of day",
            "icon": "zap"
        },
        {
            "title": "Time Blocking",
            "description": "Instead of a simple to-do list, allocate specific time blocks in your calendar for each activity (e.g., 9-11am Writing, 11am-12pm Emails). This creates an inescapable mental commitment to each task.",
            "duration": "Daily planning",
            "icon": "calendar"
        },
        {
            "title": "The 2-Minute Rule",
            "description": "If a task comes up (replying to a quick email, filing a document, confirming a meeting) and it takes less than two minutes to complete, do it immediately. Never postpone it.",
            "duration": "< 2 min",
            "icon": "clock"
        }
    ]

@app.post("/api/reset")
async def reset_profile():
    reset_all()
    return {"status": "success", "message": "Profile has been reset successfully."}

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

@app.get("/")
async def read_index():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "Frontend files not found."}

if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

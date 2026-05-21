import os
import sqlite3
import random
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "db.sqlite3")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                initialized INTEGER DEFAULT 0,
                min_hours REAL NOT NULL,
                max_hours REAL NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS work_history (
                date TEXT PRIMARY KEY,
                hours REAL NOT NULL,
                is_simulated INTEGER DEFAULT 0
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS forecasts (
                date TEXT PRIMARY KEY,
                predicted_hours REAL NOT NULL,
                model_used TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_tracking (
                date TEXT PRIMARY KEY,
                accumulated_seconds INTEGER DEFAULT 0,
                finalized INTEGER DEFAULT 0
            )
        """)
        conn.commit()

def check_first_time():
    init_db()
    with get_db() as conn:
        row = conn.execute("SELECT initialized FROM settings LIMIT 1").fetchone()
        if row is None or row["initialized"] == 0:
            return True
        return False

def save_settings_and_generate_history(min_hours: float, max_hours: float):
    init_db()
    reset_all()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO settings (initialized, min_hours, max_hours, created_at) VALUES (1, ?, ?, ?)",
            (min_hours, max_hours, datetime.now().isoformat())
        )
        conn.commit()
    mean = (min_hours + max_hours) / 2.0
    std_dev = max(0.5, (max_hours - min_hours) / 4.0)
    history_records = []
    today = datetime.now().date()
    for i in range(30, 0, -1):
        target_date = today - timedelta(days=i)
        date_str = target_date.strftime("%Y-%m-%d")
        hours = random.normalvariate(mean, std_dev)
        hours = max(0.5, min(24.0, round(hours, 1)))
        history_records.append((date_str, hours, 1))
    with get_db() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO work_history (date, hours, is_simulated) VALUES (?, ?, ?)",
            history_records
        )
        conn.commit()

def get_settings():
    init_db()
    with get_db() as conn:
        row = conn.execute("SELECT min_hours, max_hours, created_at FROM settings LIMIT 1").fetchone()
        if row:
            return {
                "min_hours": row["min_hours"],
                "max_hours": row["max_hours"],
                "created_at": row["created_at"]
            }
        return None

def get_history():
    init_db()
    with get_db() as conn:
        rows = conn.execute("SELECT date, hours, is_simulated FROM work_history ORDER BY date ASC").fetchall()
        return [{"date": r["date"], "hours": r["hours"], "is_simulated": bool(r["is_simulated"])} for r in rows]

def get_history_hours_only():
    init_db()
    with get_db() as conn:
        rows = conn.execute("SELECT hours FROM work_history ORDER BY date ASC").fetchall()
        return [r["hours"] for r in rows]

def log_actual_hours(date_str: str, hours: float):
    init_db()
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO work_history (date, hours, is_simulated) VALUES (?, ?, 0)",
            (date_str, round(hours, 1))
        )
        conn.commit()

def save_predictions(predictions: list, model_used: str):
    init_db()
    with get_db() as conn:
        conn.execute("DELETE FROM forecasts")
        conn.executemany(
            "INSERT INTO forecasts (date, predicted_hours, model_used) VALUES (?, ?, ?)",
            [(p["date"], round(p["hours"], 1), model_used) for p in predictions]
        )
        conn.commit()

def get_predictions():
    init_db()
    with get_db() as conn:
        rows = conn.execute("SELECT date, predicted_hours, model_used FROM forecasts ORDER BY date ASC").fetchall()
        return [{"date": r["date"], "hours": r["predicted_hours"], "model_used": r["model_used"]} for r in rows]

def get_yesterday_result():
    init_db()
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    with get_db() as conn:
        hist = conn.execute("SELECT hours FROM work_history WHERE date = ? AND is_simulated = 0", (yesterday_str,)).fetchone()
        pred = conn.execute("SELECT predicted_hours FROM forecasts WHERE date = ?", (yesterday_str,)).fetchone()
        if hist and pred:
            actual = hist["hours"]
            expected = pred["predicted_hours"]
            diff = actual - expected
            return {
                "has_data": True,
                "actual": actual,
                "expected": expected,
                "diff": round(diff, 1),
                "beat": diff > 0
            }
        return {"has_data": False}

def get_current_streak():
    init_db()
    history = get_history()
    actual_days = [h for h in history if not h["is_simulated"]]
    if not actual_days:
        return {"logging_streak": 0, "victory_streak": 0}
    actual_days.sort(key=lambda x: x["date"], reverse=True)
    today_str = datetime.now().strftime("%Y-%m-%d")
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    latest_date = actual_days[0]["date"]
    if latest_date != today_str and latest_date != yesterday_str:
        return {"logging_streak": 0, "victory_streak": 0}
    logging_streak = 0
    current_date = datetime.strptime(latest_date, "%Y-%m-%d").date()
    actual_dates_set = {datetime.strptime(h["date"], "%Y-%m-%d").date() for h in actual_days}
    while current_date in actual_dates_set:
        logging_streak += 1
        current_date -= timedelta(days=1)
    with get_db() as conn:
        forecast_rows = conn.execute("SELECT date, predicted_hours FROM forecasts").fetchall()
        forecasts_dict = {f["date"]: f["predicted_hours"] for f in forecast_rows}
    victory_streak = 0
    current_date = datetime.strptime(latest_date, "%Y-%m-%d").date()
    while current_date in actual_dates_set:
        date_str = current_date.strftime("%Y-%m-%d")
        actual_hours = next((h["hours"] for h in actual_days if h["date"] == date_str), 0)
        forecast_hours = forecasts_dict.get(date_str)
        if forecast_hours is not None:
            if actual_hours >= forecast_hours:
                victory_streak += 1
            else:
                break
        else:
            victory_streak += 1
        current_date -= timedelta(days=1)
    return {
        "logging_streak": logging_streak,
        "victory_streak": victory_streak
    }

def get_today_tracking():
    init_db()
    today_str = datetime.now().strftime("%Y-%m-%d")
    with get_db() as conn:
        row = conn.execute("SELECT accumulated_seconds, finalized FROM daily_tracking WHERE date = ?", (today_str,)).fetchone()
        if row:
            return {"date": today_str, "seconds": row["accumulated_seconds"], "finalized": bool(row["finalized"])}
        return {"date": today_str, "seconds": 0, "finalized": False}

def save_today_tracking(seconds: int):
    init_db()
    today_str = datetime.now().strftime("%Y-%m-%d")
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO daily_tracking (date, accumulated_seconds, finalized) VALUES (?, ?, 0)",
            (today_str, seconds)
        )
        conn.commit()

def finalize_past_days():
    init_db()
    today_str = datetime.now().strftime("%Y-%m-%d")
    finalized_dates = []
    with get_db() as conn:
        rows = conn.execute(
            "SELECT date, accumulated_seconds FROM daily_tracking WHERE finalized = 0 AND date < ?",
            (today_str,)
        ).fetchall()
        for row in rows:
            date_str = row["date"]
            seconds = row["accumulated_seconds"]
            hours = round(seconds / 3600.0, 1)
            if seconds > 0:
                conn.execute(
                    "INSERT OR REPLACE INTO work_history (date, hours, is_simulated) VALUES (?, ?, 0)",
                    (date_str, hours)
                )
                finalized_dates.append({"date": date_str, "hours": hours})
            conn.execute(
                "UPDATE daily_tracking SET finalized = 1 WHERE date = ?",
                (date_str,)
            )
        conn.commit()
    return finalized_dates

def reset_all():
    init_db()
    with get_db() as conn:
        conn.execute("DROP TABLE IF EXISTS settings")
        conn.execute("DROP TABLE IF EXISTS work_history")
        conn.execute("DROP TABLE IF EXISTS forecasts")
        conn.execute("DROP TABLE IF EXISTS daily_tracking")
        conn.commit()
    init_db()

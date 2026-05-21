import os
import sys
import logging
from datetime import datetime, timedelta

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("time_challenger.forecast")

_TIMESFM_MODEL = None
_TORCH_AVAILABLE = False

try:
    import torch
    from transformers import TimesFm2_5ModelForPrediction
    _TORCH_AVAILABLE = True
    logger.info("PyTorch and Transformers imported successfully.")
except Exception as e:
    logger.warning(f"Could not import PyTorch/Transformers: {e}. Fallback forecaster will be used.")

def load_timesfm_model():
    global _TIMESFM_MODEL
    if _TIMESFM_MODEL is not None:
        return _TIMESFM_MODEL
        
    if not _TORCH_AVAILABLE:
        raise ImportError("PyTorch/Transformers are not available in this environment.")
        
    logger.info("Initializing Google TimesFM 2.5 (200m) model from Hugging Face...")
    try:
        model = TimesFm2_5ModelForPrediction.from_pretrained(
            "google/timesfm-2.5-200m-transformers"
        )
        model = model.to(torch.float32).eval()
        
        if torch.cuda.is_available():
            model = model.to("cuda")
            logger.info("TimesFM loaded on CUDA GPU.")
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            model = model.to("mps")
            logger.info("TimesFM loaded on Apple Silicon MPS.")
        else:
            logger.info("TimesFM loaded on CPU.")
            
        _TIMESFM_MODEL = model
        return _TIMESFM_MODEL
    except Exception as e:
        logger.error(f"Failed to load Google TimesFM 2.5 model: {e}")
        raise e

def run_timesfm_forecast(hours_history: list, forecast_days: int = 7) -> list:
    model = load_timesfm_model()
    model_cpu = model.to("cpu")
    
    import math
    PATCH_LEN = 32
    
    n = len(hours_history)
    padded_len = max(PATCH_LEN, math.ceil(n / PATCH_LEN) * PATCH_LEN)
    pad_count = padded_len - n
    
    mean_val = sum(hours_history) / n if n > 0 else 5.0
    padded_history = [mean_val] * pad_count + hours_history
    
    logger.info(f"TimesFM input: {n} points padded to {padded_len} (pad={pad_count})")
    
    series = torch.tensor(padded_history, dtype=torch.float32)
    past_values = [series]
    
    with torch.no_grad():
        outputs = model_cpu(
            past_values=past_values,
            forecast_context_len=min(128, padded_len),
        )
        
    mean_predictions = outputs.mean_predictions
    forecast_values = mean_predictions[0][:forecast_days].cpu().numpy().tolist()
    
    if torch.cuda.is_available():
        model.to("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        model.to("mps")
    
    return forecast_values

def run_statistical_forecast(hours_history: list, min_hours: float, max_hours: float, forecast_days: int = 7) -> list:
    import numpy as np
    
    n = len(hours_history)
    if n < 7:
        mean_val = sum(hours_history) / n if n > 0 else (min_hours + max_hours) / 2.0
        return [round(max(0.5, mean_val), 1) for _ in range(forecast_days)]
        
    history_arr = np.array(hours_history)
    mean_val = np.mean(history_arr)
    std_dev = np.std(history_arr)
    if std_dev < 0.2:
        std_dev = 0.5
        
    weekly_patterns = {0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []}
    today = datetime.now().date()
    
    for idx, hours in enumerate(hours_history):
        days_ago = n - idx
        target_day = today - timedelta(days=days_ago)
        day_of_week = target_day.weekday()
        weekly_patterns[day_of_week].append(hours)
        
    weekly_factors = {}
    for day, vals in weekly_patterns.items():
        if vals:
            weekly_factors[day] = np.mean(vals) - mean_val
        else:
            weekly_factors[day] = 0.0
            
    forecast_values = []
    last_value = hours_history[-1]
    
    for i in range(forecast_days):
        forecast_date = today + timedelta(days=i)
        day_of_week = forecast_date.weekday()
        
        recent_trend = np.mean(hours_history[-7:]) if n >= 7 else mean_val
        ar_term = 0.4 * last_value + 0.3 * recent_trend + 0.3 * mean_val
        cycle_deviation = weekly_factors.get(day_of_week, 0.0)
        
        pred = ar_term + 0.7 * cycle_deviation
        pred = max(min_hours * 0.8, min(max_hours * 1.2, pred))
        
        pred_rounded = round(max(0.5, min(24.0, pred)), 1)
        forecast_values.append(pred_rounded)
        
        last_value = pred_rounded
        
    return forecast_values

def generate_7day_forecast(hours_history: list, min_hours: float, max_hours: float) -> tuple:
    if not hours_history:
        hours_history = [5.0] * 30
        
    if _TORCH_AVAILABLE:
        try:
            forecasts = run_timesfm_forecast(hours_history, forecast_days=7)
            clamped_forecasts = []
            for f in forecasts:
                val = round(max(min_hours * 0.8, min(max_hours * 1.2, f)), 1)
                clamped_forecasts.append(max(0.5, min(24.0, val)))
            logger.info("Successfully calculated forecast using Google TimesFM 2.5.")
            return clamped_forecasts, "TimesFM-2.5-200m"
        except Exception as e:
            logger.warning(f"TimesFM prediction encountered error: {e}. Switching to high-fidelity statistical fallback.")
            
    logger.info("Executing statistical forecasting fallback engine...")
    forecasts = run_statistical_forecast(hours_history, min_hours, max_hours, forecast_days=7)
    return forecasts, "Synaptic-SFM-1.0"

document.addEventListener("DOMContentLoaded", () => {
    const API_BASE = "/api";
    let chartInstance = null;
    let dashboardDataCache = null;
    let syncInterval = null;

    const views = {
        landing: document.getElementById("view-landing"),
        setup: document.getElementById("view-setup"),
        dashboard: document.getElementById("view-dashboard"),
        arena: document.getElementById("view-arena")
    };

    const btnStart = document.getElementById("btn-start");
    const btnGenerate = document.getElementById("btn-generate");
    const btnEnterArena = document.getElementById("btn-enter-arena");
    const btnBackDashboard = document.getElementById("btn-back-dashboard");
    const btnResetProfile = document.getElementById("btn-reset-profile");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const btnBackLanding = document.querySelector(".btn-back-landing");

    const inputMinHours = document.getElementById("input-min-hours");
    const inputMaxHours = document.getElementById("input-max-hours");
    const valMinHours = document.getElementById("val-min-hours");
    const valMaxHours = document.getElementById("val-max-hours");
    const previewBars = document.getElementById("preview-bars");
    const previewStats = document.getElementById("preview-stats");

    const submitInputHours = document.getElementById("submit-input-hours");
    const submitValHours = document.getElementById("submit-val-hours");

    const resultsModal = document.getElementById("results-modal");
    const modalBox = document.getElementById("modal-box");
    const modalTitle = document.getElementById("modal-title");
    const modalPill = document.getElementById("modal-pill");
    const modalText = document.getElementById("modal-text");
    const modalStreak = document.getElementById("modal-streak");
    const modalIconContainer = document.getElementById("modal-icon-container");

    function showView(viewName) {
        Object.keys(views).forEach(key => {
            if (key === viewName) {
                views[key].classList.add("active");
            } else {
                views[key].classList.remove("active");
            }
        });
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    function updateSetupPreview() {
        const minVal = parseFloat(inputMinHours.value);
        const maxVal = parseFloat(inputMaxHours.value);

        if (minVal > maxVal) {
            inputMaxHours.value = minVal;
        }

        const min = parseFloat(inputMinHours.value);
        const max = parseFloat(inputMaxHours.value);

        valMinHours.textContent = min.toFixed(1) + " h";
        valMaxHours.textContent = max.toFixed(1) + " h";

        const mean = (min + max) / 2.0;
        const stdDev = Math.max(0.5, (max - min) / 4.0);

        previewStats.textContent = `Expected Mean: ~${mean.toFixed(1)}h / Std Deviation: ~${stdDev.toFixed(1)}h`;

        previewBars.innerHTML = "";
        
        for (let i = 0; i < 16; i++) {
            const z = -2.2 + (i / 15) * 4.4;
            let heightFactor = Math.exp(-0.5 * z * z);
            
            const noise = 0.85 + Math.random() * 0.3;
            let barHeight = heightFactor * 100 * noise;
            barHeight = Math.max(8, Math.min(100, barHeight));

            const bar = document.createElement("div");
            bar.className = "preview-bar";
            bar.style.height = `${barHeight}%`;
            
            const value = mean + z * stdDev;
            const clampValue = Math.max(0.5, Math.min(24.0, value));
            bar.title = `${clampValue.toFixed(1)} hours`;
            
            previewBars.appendChild(bar);
        }
    }

    inputMinHours.addEventListener("input", updateSetupPreview);
    inputMaxHours.addEventListener("input", updateSetupPreview);

    function playSmoothChime() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            osc1.type = "sine";
            osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime);

            osc2.type = "sine";
            osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime);

            gainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.08);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);

            osc1.connect(gainNode);
            osc2.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            osc1.start();
            osc2.start();

            osc1.stop(audioCtx.currentTime + 1.8);
            osc2.stop(audioCtx.currentTime + 1.8);
        } catch (e) {
            console.warn("AudioContext could not initiate chime: ", e);
        }
    }

    async function syncTrackedTimeToServer(seconds) {
        try {
            const res = await fetch(`${API_BASE}/track`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accumulated_seconds: seconds })
            });
            if (res.ok) {
                const data = await res.json();
                console.log("Progress auto-saved. Accumulated:", data.accumulated_hours, "Target:", data.today_target);
                
                if (dashboardDataCache) {
                    dashboardDataCache.today_accumulated_seconds = seconds;
                    dashboardDataCache.today_accumulated_hours = data.accumulated_hours;
                }
                updateArenaComparison();
            }
        } catch (e) {
            console.warn("Failed to auto-sync work hours to server:", e);
        }
    }

    async function checkInitialization() {
        try {
            const response = await fetch(`${API_BASE}/status`);
            const data = await response.json();
            if (data.first_time) {
                showView("landing");
            } else {
                await loadDashboardData();
            }
        } catch (e) {
            console.error("Connection failed. Showing landing.", e);
            showView("landing");
        }
    }

    async function initializeProfile() {
        const minVal = parseFloat(inputMinHours.value);
        const maxVal = parseFloat(inputMaxHours.value);
        
        btnGenerate.disabled = true;
        btnGenerate.querySelector("span").textContent = "Calibrating Forecaster...";
        
        try {
            const res = await fetch(`${API_BASE}/initialize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ min_hours: minVal, max_hours: maxVal })
            });
            const data = await res.json();
            if (res.ok) {
                await loadDashboardData();
            } else {
                alert("Error: " + data.detail);
            }
        } catch (e) {
            alert("Calibration failed. Please try again.");
        } finally {
            btnGenerate.disabled = false;
            btnGenerate.querySelector("span").textContent = "Generate Profile & Calibrate AI";
        }
    }

    async function loadDashboardData() {
        try {
            const res = await fetch(`${API_BASE}/dashboard`);
            const data = await res.json();
            
            if (!data.initialized) {
                showView("landing");
                return;
            }

            dashboardDataCache = data;
            
            accumulatedStopwatchSeconds = data.today_accumulated_seconds;
            updateStopwatchOutputs();
            
            document.getElementById("stat-logging-streak").textContent = `${data.streaks.logging_streak} days`;
            document.getElementById("stat-victory-streak").textContent = `Victory Streak: ${data.streaks.victory_streak}`;
            document.getElementById("stat-today-target").textContent = `${data.today_target.toFixed(1)} h`;
            
            const yesterdayStatus = document.getElementById("stat-yesterday-status");
            const yesterdayDetail = document.getElementById("stat-yesterday-detail");
            
            if (data.yesterday.has_data) {
                if (data.yesterday.beat) {
                    yesterdayStatus.textContent = "VICTORY";
                    yesterdayStatus.className = "metric-value text-green";
                    yesterdayDetail.textContent = `+${data.yesterday.diff.toFixed(1)}h beaten expect`;
                } else {
                    yesterdayStatus.textContent = "SO CLOSE";
                    yesterdayStatus.className = "metric-value text-orange";
                    yesterdayDetail.textContent = `${Math.abs(data.yesterday.diff).toFixed(1)}h short of target`;
                }
            } else {
                yesterdayStatus.textContent = "AWAITING";
                yesterdayStatus.className = "metric-value text-white";
                yesterdayDetail.textContent = "Midnight evaluation pending";
            }

            const historyLog = data.history;
            const actualLogs = historyLog.filter(h => !h.is_simulated);
            const totalHoursLogged = actualLogs.reduce((sum, h) => sum + h.hours, 0);
            
            document.getElementById("stat-total-logged").textContent = `Total: ${totalHoursLogged.toFixed(1)}h logged`;
            
            const averageHours = historyLog.length > 0 
                ? (historyLog.reduce((sum, h) => sum + h.hours, 0) / historyLog.length) 
                : 0.0;
            document.getElementById("stat-average-hours").textContent = `${averageHours.toFixed(1)} h`;

            renderChart(data.history, data.forecasts);

            document.getElementById("comp-expected").textContent = `${data.today_target.toFixed(1)} h`;
            document.getElementById("graph-label-expected").textContent = `${data.today_target.toFixed(1)}h`;
            
            const targetPosPercent = (data.today_target / 20) * 100;
            document.getElementById("bar-target-marker").style.left = `${Math.min(100, targetPosPercent)}%`;
            document.getElementById("graph-label-expected").style.left = `${Math.min(92, Math.max(8, targetPosPercent))}%`;

            updateArenaComparison();

            showView("dashboard");
            loadTips();
            
            evaluateAndShowYesterdayResult(data.yesterday);
            
        } catch (e) {
            console.error("Dashboard failed to load.", e);
        }
    }

    function evaluateAndShowYesterdayResult(yesterday) {
        if (!yesterday || !yesterday.has_data) return;
        
        const yesterdayDateStr = (new Date(Date.now() - 86400000)).toISOString().split('T')[0];
        const lastNotifiedDate = localStorage.getItem("time_challenger_yesterday_notified");
        
        if (lastNotifiedDate === yesterdayDateStr) {
            return;
        }
        
        modalStreak.textContent = `+${dashboardDataCache.streaks.logging_streak} Days`;
        
        if (yesterday.beat) {
            fireVictoryConfetti();
            modalTitle.textContent = "VICTORY!";
            modalBox.className = "modal-content glass-panel";
            modalPill.className = "modal-status-pill";
            modalPill.textContent = `Beaten by +${yesterday.diff.toFixed(1)} hours`;
            modalText.innerHTML = `Welcome back! Yesterday, you worked <strong>${yesterday.actual.toFixed(1)}h</strong>, crushing the AI expectation of <strong>${yesterday.expected.toFixed(1)}h</strong>. <br>Our best adversary is ourselves! Keep it up today.`;
            modalIconContainer.innerHTML = '<i data-lucide="trophy"></i>';
        } else {
            modalTitle.textContent = "SO CLOSE!";
            modalBox.className = "modal-content glass-panel defeat-style";
            modalPill.className = "modal-status-pill";
            modalPill.textContent = `AI is ahead by ${Math.abs(yesterday.diff).toFixed(1)}h`;
            modalText.innerHTML = `Yesterday, you focused for <strong>${yesterday.actual.toFixed(1)}h</strong>. The AI expected <strong>${yesterday.expected.toFixed(1)}h</strong>.<br>Today is a fresh day to challenge the system and break its predictive curve!`;
            modalIconContainer.innerHTML = '<i data-lucide="shield-alert"></i>';
        }
        
        resultsModal.classList.add("active");
        if (window.lucide) window.lucide.createIcons();
        
        localStorage.setItem("time_challenger_yesterday_notified", yesterdayDateStr);
    }

    async function loadTips() {
        const tipsContainer = document.getElementById("tips-container");
        try {
            const res = await fetch(`${API_BASE}/tips`);
            const tips = await res.json();
            
            tipsContainer.innerHTML = "";
            tips.forEach(tip => {
                const item = document.createElement("div");
                item.className = "tip-item";
                item.innerHTML = `
                    <div class="tip-header">
                        <span class="tip-title"><i data-lucide="${tip.icon}"></i> ${tip.title}</span>
                        <span class="tip-badge">${tip.duration}</span>
                    </div>
                    <p class="tip-body">${tip.description}</p>
                `;
                tipsContainer.appendChild(item);
            });
            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            tipsContainer.innerHTML = '<div class="tip-loading">Failed to retrieve scientific focus tips.</div>';
        }
    }

    async function resetProfile() {
        const confirmation = confirm("Are you absolutely sure you want to reset Synaptic Time Challenger? This will permanently erase your focus history and forecasts.");
        if (!confirmation) return;
        
        try {
            const res = await fetch(`${API_BASE}/reset`, { method: "POST" });
            if (res.ok) {
                if (chartInstance) {
                    chartInstance.destroy();
                    chartInstance = null;
                }
                dashboardDataCache = null;
                localStorage.removeItem("time_challenger_yesterday_notified");
                resetStopwatch();
                resetPomodoro();
                showView("landing");
            }
        } catch (e) {
            alert("Error resetting application profile.");
        }
    }

    function renderChart(history, forecasts) {
        const ctx = document.getElementById("timeSeriesChart").getContext("2d");
        
        if (chartInstance) {
            chartInstance.destroy();
        }

        const historyDates = history.map(h => h.date);
        const historyHours = history.map(h => h.hours);

        const forecastDates = forecasts.map(f => f.date);
        
        const allDatesSet = new Set([...historyDates, ...forecastDates]);
        const allDates = Array.from(allDatesSet).sort();

        const historyDataset = [];
        const forecastDataset = [];

        allDates.forEach(date => {
            const histItem = history.find(h => h.date === date);
            historyDataset.push(histItem ? histItem.hours : null);

            const foreItem = forecasts.find(f => f.date === date);
            forecastDataset.push(foreItem ? foreItem.hours : null);
        });

        const gradientActual = ctx.createLinearGradient(0, 0, 0, 300);
        gradientActual.addColorStop(0, "rgba(0, 255, 102, 0.15)");
        gradientActual.addColorStop(1, "rgba(0, 255, 102, 0.0)");

        const gradientForecast = ctx.createLinearGradient(0, 0, 0, 300);
        gradientForecast.addColorStop(0, "rgba(0, 240, 255, 0.05)");
        gradientForecast.addColorStop(1, "rgba(0, 240, 255, 0.0)");

        const formattedLabels = allDates.map(dateStr => {
            const date = new Date(dateStr);
            return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
        });

        chartInstance = new Chart(ctx, {
            type: "line",
            data: {
                labels: formattedLabels,
                datasets: [
                    {
                        label: "Actual / Simulated Focus Hours",
                        data: historyDataset,
                        borderColor: "#00ff66",
                        borderWidth: 3,
                        pointBackgroundColor: "#00ff66",
                        pointBorderColor: "#ffffff",
                        pointHoverRadius: 6,
                        backgroundColor: gradientActual,
                        fill: true,
                        tension: 0.35,
                        spanGaps: true
                    },
                    {
                        label: "AI Predicted Curve (TimesFM)",
                        data: forecastDataset,
                        borderColor: "#00f0ff",
                        borderWidth: 3,
                        borderDash: [5, 5],
                        pointBackgroundColor: "#00f0ff",
                        pointBorderColor: "#ffffff",
                        pointHoverRadius: 6,
                        backgroundColor: gradientForecast,
                        fill: true,
                        tension: 0.35,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "rgba(10, 18, 14, 0.9)",
                        titleFont: { family: "Outfit", size: 14, weight: "bold" },
                        bodyFont: { family: "Inter", size: 12 },
                        borderColor: "rgba(0, 255, 102, 0.2)",
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${context.raw} hours`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255, 255, 255, 0.03)" },
                        ticks: { color: "#8fa69c", font: { family: "Inter", size: 10 } }
                    },
                    y: {
                        grid: { color: "rgba(255, 255, 255, 0.03)" },
                        ticks: { color: "#8fa69c", font: { family: "Inter", size: 10 } },
                        suggestedMin: 0,
                        suggestedMax: 12
                    }
                }
            }
        });
    }

    function updateArenaComparison() {
        const actualHours = dashboardDataCache ? dashboardDataCache.today_accumulated_hours : 0.00;
        const expectedHours = dashboardDataCache ? dashboardDataCache.today_target : 0.0;

        document.getElementById("comp-actual").textContent = actualHours.toFixed(2) + "h";
        
        const fillPercent = (actualHours / 20) * 100;
        document.getElementById("bar-fill-actual").style.width = `${Math.min(100, fillPercent)}%`;

        const verdict = document.getElementById("status-verdict");
        const card = document.getElementById("comparison-card");

        if (actualHours === 0) {
            verdict.textContent = "Start working. The AI expectation is waiting to be beaten.";
            verdict.className = "status-verdict";
            card.style.borderColor = "var(--border-glass)";
        } else if (actualHours < expectedHours) {
            const gap = expectedHours - actualHours;
            verdict.innerHTML = `You are at <strong>${actualHours.toFixed(2)}h</strong>. AI expects <strong>${expectedHours.toFixed(1)}h</strong>. Work another <span class="text-green font-bold">${gap.toFixed(2)}h</span> to crush its prediction!`;
            verdict.className = "status-verdict";
            card.style.borderColor = "rgba(0, 240, 255, 0.2)";
        } else {
            const margin = actualHours - expectedHours;
            verdict.innerHTML = `🚀 <span class="text-green font-bold">EXCELLENT FOCUS!</span> You are beating the AI prediction by <strong>${margin.toFixed(2)}h</strong>. Keep going until midnight!`;
            verdict.className = "status-verdict victory";
            card.style.borderColor = "var(--neon-green)";
        }
    }

    let pomodoroInterval = null;
    let pomodoroSecondsLeft = 25 * 60;
    let pomodoroTotalDuration = 25 * 60;
    let pomodoroMode = "focus"; 
    let pomodoroIsRunning = false;

    const pomodoroCircle = document.getElementById("pomodoro-circle");
    const pomodoroTime = document.getElementById("pomodoro-time");
    const pomodoroStatusText = document.getElementById("pomodoro-status-text");
    const btnPomoPlay = document.getElementById("btn-pomodoro-play");
    const btnPomoPause = document.getElementById("btn-pomodoro-pause");
    const btnPomoReset = document.getElementById("btn-pomodoro-reset");

    const circleRadius = 95;
    const circumference = 2 * Math.PI * circleRadius;
    pomodoroCircle.style.strokeDasharray = `${circumference} ${circumference}`;

    function setCirclePercent(percent) {
        const offset = circumference - (percent / 100) * circumference;
        pomodoroCircle.style.strokeDashoffset = offset;
    }

    function updatePomoDisplay() {
        const mins = Math.floor(pomodoroSecondsLeft / 60);
        const secs = pomodoroSecondsLeft % 60;
        pomodoroTime.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        const percent = (pomodoroSecondsLeft / pomodoroTotalDuration) * 100;
        setCirclePercent(percent);

        document.title = `(${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}) Time Challenger`;
    }

    function startPomodoro() {
        if (pomodoroIsRunning) return;
        pomodoroIsRunning = true;
        btnPomoPlay.style.display = "none";
        btnPomoPause.style.display = "flex";
        pomodoroStatusText.textContent = pomodoroMode === "focus" ? "Intense focus session..." : "Relaxing break...";

        pomodoroInterval = setInterval(async () => {
            if (pomodoroSecondsLeft > 0) {
                pomodoroSecondsLeft--;
                updatePomoDisplay();
            } else {
                clearInterval(pomodoroInterval);
                pomodoroIsRunning = false;
                playSmoothChime();
                
                if (pomodoroMode === "focus") {
                    accumulatedStopwatchSeconds += (25 * 60);
                    updateStopwatchOutputs();
                    await syncTrackedTimeToServer(accumulatedStopwatchSeconds);
                    
                    alert("Focus session complete! 25 minutes have been automatically added and synced to your work day.");
                } else {
                    alert("Break over! Ready to focus again?");
                }
                
                resetPomodoro();
            }
        }, 1000);
    }

    function pausePomodoro() {
        clearInterval(pomodoroInterval);
        pomodoroIsRunning = false;
        btnPomoPlay.style.display = "flex";
        btnPomoPause.style.display = "none";
        pomodoroStatusText.textContent = "Session paused";
    }

    function resetPomodoro() {
        clearInterval(pomodoroInterval);
        pomodoroIsRunning = false;
        btnPomoPlay.style.display = "flex";
        btnPomoPause.style.display = "none";
        pomodoroSecondsLeft = pomodoroTotalDuration;
        pomodoroStatusText.textContent = "Ready to start";
        updatePomoDisplay();
        document.title = "Time Challenger by Synaptic";
    }

    btnPomoPlay.addEventListener("click", startPomodoro);
    btnPomoPause.addEventListener("click", pausePomodoro);
    btnPomoReset.addEventListener("click", resetPomodoro);

    document.querySelectorAll(".preset-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");

            const time = parseInt(e.target.dataset.time);
            pomodoroMode = e.target.dataset.mode;
            pomodoroTotalDuration = time * 60;
            pomodoroSecondsLeft = pomodoroTotalDuration;
            
            if (pomodoroMode === "focus") {
                pomodoroCircle.style.stroke = "#00ff66";
            } else {
                pomodoroCircle.style.stroke = "#00f0ff";
            }

            resetPomodoro();
        });
    });

    let stopwatchInterval = null;
    let accumulatedStopwatchSeconds = 0;
    let stopwatchIsRunning = false;
    let stopwatchStartTime = 0;

    const stopwatchTime = document.getElementById("stopwatch-time");
    const stopwatchHoursAcc = document.getElementById("stopwatch-hours-accumulated");
    const btnStopPlay = document.getElementById("btn-stopwatch-play");
    const btnStopPause = document.getElementById("btn-stopwatch-pause");
    const btnStopReset = document.getElementById("btn-stopwatch-reset");

    function updateStopwatchOutputs() {
        const totalSecs = accumulatedStopwatchSeconds;
        const hrs = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;

        stopwatchTime.textContent = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        const decHours = totalSecs / 3600.0;
        stopwatchHoursAcc.textContent = `Accumulated: ${decHours.toFixed(2)}h`;

        const decHoursRounded = Math.min(20, Math.max(0, Math.round(decHours * 100) / 100));
        submitInputHours.value = decHoursRounded;
        submitValHours.textContent = decHoursRounded.toFixed(2) + " hours";
        
        if (dashboardDataCache) {
            dashboardDataCache.today_accumulated_seconds = totalSecs;
            dashboardDataCache.today_accumulated_hours = decHoursRounded;
        }
        updateArenaComparison();
    }

    function startStopwatch() {
        if (stopwatchIsRunning) return;
        stopwatchIsRunning = true;
        btnStopPlay.style.display = "none";
        btnStopPause.style.display = "flex";
        
        stopwatchStartTime = Date.now() - (accumulatedStopwatchSeconds * 1000);

        stopwatchInterval = setInterval(() => {
            const elapsedMs = Date.now() - stopwatchStartTime;
            accumulatedStopwatchSeconds = Math.floor(elapsedMs / 1000);
            updateStopwatchOutputs();
        }, 1000);

        startSyncHeartbeat();
    }

    function pauseStopwatch() {
        clearInterval(stopwatchInterval);
        stopwatchIsRunning = false;
        btnStopPlay.style.display = "flex";
        btnStopPause.style.display = "none";
        
        stopSyncHeartbeat();
        syncTrackedTimeToServer(accumulatedStopwatchSeconds);
    }

    function resetStopwatch() {
        const confirmReset = confirm("Resetting the stopwatch will clear your tracked hours for today. Are you sure?");
        if (!confirmReset) return;

        clearInterval(stopwatchInterval);
        stopwatchIsRunning = false;
        btnStopPlay.style.display = "flex";
        btnStopPause.style.display = "none";
        accumulatedStopwatchSeconds = 0;
        updateStopwatchOutputs();
        
        stopSyncHeartbeat();
        syncTrackedTimeToServer(0);
    }

    btnStopPlay.addEventListener("click", startStopwatch);
    btnStopPause.addEventListener("click", pauseStopwatch);
    btnStopReset.addEventListener("click", resetStopwatch);

    function startSyncHeartbeat() {
        stopSyncHeartbeat();
        syncInterval = setInterval(() => {
            if (stopwatchIsRunning) {
                syncTrackedTimeToServer(accumulatedStopwatchSeconds);
            }
        }, 10000);
    }

    function stopSyncHeartbeat() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    }

    document.querySelectorAll(".suite-tabs button").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".suite-tabs button").forEach(b => b.classList.remove("active"));
            e.currentTarget.classList.add("active");

            const tab = e.currentTarget.dataset.tab;
            if (tab === "pomodoro") {
                document.getElementById("tab-content-pomodoro").classList.add("active");
                document.getElementById("tab-content-stopwatch").classList.remove("active");
            } else {
                document.getElementById("tab-content-pomodoro").classList.remove("active");
                document.getElementById("tab-content-stopwatch").classList.add("active");
            }
        });
    });

    function fireVictoryConfetti() {
        const duration = 4 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1100 };

        function randomInRange(min, max) {
            return Math.random() * (max - min) + min;
        }

        const interval = setInterval(function() {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            window.confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
            window.confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
        }, 250);
    }
    
    btnStart.addEventListener("click", () => {
        updateSetupPreview();
        showView("setup");
    });
    
    btnBackLanding.addEventListener("click", () => {
        showView("landing");
    });

    btnGenerate.addEventListener("click", initializeProfile);

    btnEnterArena.addEventListener("click", () => {
        showView("arena");
    });
    
    btnResetProfile.addEventListener("click", resetProfile);

    btnBackDashboard.addEventListener("click", async () => {
        await syncTrackedTimeToServer(accumulatedStopwatchSeconds);
        await loadDashboardData();
        showView("dashboard");
    });

    btnCloseModal.addEventListener("click", () => {
        resultsModal.classList.remove("active");
    });
    
    resultsModal.addEventListener("click", (e) => {
        if (e.target === resultsModal) {
            resultsModal.classList.remove("active");
        }
    });

    checkInitialization();
});

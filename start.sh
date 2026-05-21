#!/usr/bin/env bash
# ============================================================
#  SYNAPTIC — TIME CHALLENGER — LOCAL STARTUP SCRIPT
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---- ASCII Banner ----
echo ""
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║                                                   ║"
echo "  ║     ⚡  S Y N A P T I C                          ║"
echo "  ║         T I M E   C H A L L E N G E R            ║"
echo "  ║                                                   ║"
echo "  ║     Battez les prédictions de l'IA.               ║"
echo "  ║     Notre meilleur adversaire, c'est nous-mêmes. ║"
echo "  ║                                                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo ""

# ---- 1. Check Python ----
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "❌ Python n'est pas installé. Veuillez installer Python 3.10+ avant de continuer."
    exit 1
fi

echo "🐍 Python détecté : $($PYTHON --version)"

# ---- 2. Virtual Environment ----
if [ ! -d ".venv" ]; then
    echo "📦 Création de l'environnement virtuel (.venv)..."
    $PYTHON -m venv .venv
fi

source .venv/bin/activate
echo "✅ Environnement virtuel activé."

# ---- 3. Install Dependencies ----
echo "📥 Installation des dépendances Python..."
pip install --upgrade pip -q
pip install -r requirements.txt -q

echo "✅ Dépendances installées."

# ---- 4. Check TimesFM Availability ----
echo ""
echo "🔍 Vérification du modèle Google TimesFM 2.5..."
$PYTHON -c "
try:
    from transformers import TimesFm2_5ModelForPrediction
    print('   ✅ TimesFM 2.5 est disponible dans transformers.')
    print('   ℹ️  Le modèle sera téléchargé (~800MB) lors de la première prédiction.')
except Exception as e:
    print(f'   ⚠️  TimesFM non disponible: {e}')
    print('   ℹ️  Le moteur statistique Synaptic-SFM sera utilisé à la place.')
"
echo ""

# ---- 5. Launch Server ----
HOST="127.0.0.1"
PORT=8000

echo "🚀 Démarrage du serveur Uvicorn sur http://${HOST}:${PORT} ..."
echo "   Appuyez sur Ctrl+C pour arrêter le serveur."
echo ""

# Try to open the browser automatically
if command -v open &>/dev/null; then
    (sleep 2 && open "http://${HOST}:${PORT}") &
elif command -v xdg-open &>/dev/null; then
    (sleep 2 && xdg-open "http://${HOST}:${PORT}") &
fi

# Start uvicorn
$PYTHON -m uvicorn backend.main:app --host $HOST --port $PORT --reload

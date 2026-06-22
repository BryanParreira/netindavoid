#!/usr/bin/env bash
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "celery.*worker"   2>/dev/null || true
pkill -f "celery.*beat"     2>/dev/null || true
pkill -f "next dev"         2>/dev/null || true
pkill -f "ollama serve"     2>/dev/null || true
echo "All Netindavoid processes stopped."

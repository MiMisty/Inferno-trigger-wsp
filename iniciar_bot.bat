@echo off
title BandalandBot - Fase 1

cd /d "%~dp0bot"

echo ============================================
echo   BandalandBot - Fase 1 (Baileys)
echo ============================================
echo.
echo Iniciando bot en ventana separada...
echo.

start "BandalandBot - WhatsApp" "C:\Program Files\nodejs\node.exe" index.js

echo ✅ Ventana abierta. Monitorea el bot ahi.
echo   Cierra la ventana para detenerlo.
echo.
pause

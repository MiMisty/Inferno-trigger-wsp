@echo off
title BandalandBot - Bridge Node.js

cd /d "%~dp0bot"
set NODE_PATH=%~dp0bridge\node_modules
"C:\Program Files\nodejs\node.exe" index.js

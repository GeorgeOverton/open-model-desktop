@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Opening the download page... & start https://nodejs.org/en/download & pause & exit /b)
if not exist node_modules (echo First run: installing, this takes a few minutes... & call npm install || (pause & exit /b))
call npm start

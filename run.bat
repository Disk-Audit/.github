@echo off
setlocal

REM "Run as administrator" sets CWD to C:\Windows\system32, not where the
REM .bat lives. Switch to the script's own directory so npm/cargo find
REM their project files.
cd /d "%~dp0"

echo ===============================================
echo  Ledgeon Disk Analyzer
echo ===============================================
echo  Working directory: %CD%
echo.

REM Admin check — required for the MFT fast scanner. Walker fallback works
REM without admin, just slower.
net session >nul 2>&1
if errorlevel 1 (
    echo NOTE: Not running as administrator.
    echo       The MFT fast scanner will be unavailable; scans will use the
    echo       slower walker instead. For full speed, close this and
    echo       right-click run.bat - "Run as administrator".
    echo.
)

REM 1. Install Node dependencies if needed
if not exist node_modules (
    echo [1/3] Installing Node dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Is Node.js installed? https://nodejs.org/
        pause
        exit /b 1
    )
) else (
    echo [1/3] Node dependencies already installed.
)
echo.

REM 2. Build Rust scanner (always; cargo handles incremental cheaply)
echo [2/3] Building Rust scanner...
pushd mft_scanner
call cargo build --release
if errorlevel 1 (
    popd
    echo.
    echo cargo build failed. Is the Rust toolchain installed? https://rustup.rs/
    echo The app will still run, but scanning will fall back to the slower Node walker.
    pause
) else (
    popd
)
echo.

REM 3. Launch the app
echo [3/3] Starting Ledgeon Disk Analyzer...
echo.
call npm run dev

echo.
echo App exited. Press any key to close this window.
pause >nul

endlocal

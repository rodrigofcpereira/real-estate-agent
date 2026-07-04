@echo off
setlocal enableextensions enabledelayedexpansion
title Remover Tech Corretor (limpeza forcada)
color 0B

echo ============================================================
echo   Limpeza forcada do Tech Corretor
echo   Use quando o desinstalador falhar (integrity check).
echo   NAO precisa de administrador (instalacao e por usuario).
echo ============================================================
echo.

set "REMOVED=0"

echo [1/6] Encerrando o aplicativo (e processos filhos)...
taskkill /f /t /im "TechCorretor.exe"   >nul 2>&1
taskkill /f /t /im "Tech Corretor.exe"  >nul 2>&1
taskkill /f /t /im "Uninstall Tech Corretor.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/6] Procurando a instalacao no registro do Windows...
call :scan "HKCU"
call :scan "HKLM"
call :scan "HKLM" "\WOW6432Node"

echo [3/6] Removendo pastas de instalacao conhecidas...
for %%D in (
  "%LOCALAPPDATA%\Programs\Tech Corretor"
  "%LOCALAPPDATA%\Programs\tech-corretor"
  "%LOCALAPPDATA%\Programs\TechCorretor"
  "%PROGRAMFILES%\Tech Corretor"
  "%PROGRAMFILES(X86)%\Tech Corretor"
) do (
  if exist "%%~D" (
    rmdir /s /q "%%~D" 2>nul
    if not exist "%%~D" ( echo    - removido: %%~D & set "REMOVED=1" ) else ( echo    - FALHOU ^(arquivo em uso^): %%~D )
  )
)

echo [4/6] Removendo dados do aplicativo ^(sessao WhatsApp, cache^)...
for %%D in (
  "%APPDATA%\Tech Corretor"
  "%APPDATA%\tech-corretor"
  "%LOCALAPPDATA%\Tech Corretor"
) do (
  if exist "%%~D" ( rmdir /s /q "%%~D" 2>nul & echo    - removido: %%~D )
)

echo [5/6] Removendo chaves de registro residuais...
for %%G in (
  "{A7F3C2E1-9B4D-4A6E-8C1F-2D5B7E903F4A}"
  "A7F3C2E1-9B4D-4A6E-8C1F-2D5B7E903F4A"
) do (
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\%%~G" /f >nul 2>&1
  reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\%%~G" /f >nul 2>&1
)

echo [6/6] Removendo atalhos ^(Desktop e Menu Iniciar^)...
del /q "%USERPROFILE%\Desktop\Tech Corretor.lnk" >nul 2>&1
del /q "%PUBLIC%\Desktop\Tech Corretor.lnk"      >nul 2>&1
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Tech Corretor" >nul 2>&1

echo.
echo ============================================================
if "!REMOVED!"=="1" (
  echo   Tech Corretor removido com sucesso!
  echo   Agora instale a versao nova normalmente.
) else (
  echo   Nada foi removido. Possiveis motivos:
  echo     - O app ja estava desinstalado, ou
  echo     - O app estava ABERTO ^(feche-o e rode este script de novo^).
)
echo ============================================================
echo.
pause
exit /b

:: -- Sub-rotina: varre a arvore de desinstalacao e remove pelo DisplayName --
:scan
set "ROOT=%~1\Software\Microsoft\Windows\CurrentVersion\Uninstall%~2"
for /f "delims=" %%K in ('reg query "%ROOT%" 2^>nul') do (
  set "DN="
  for /f "tokens=2,*" %%A in ('reg query "%%K" /v DisplayName 2^>nul ^| findstr /i /c:"DisplayName"') do set "DN=%%B"
  if defined DN (
    echo !DN! | findstr /i /c:"Tech Corretor" >nul && (
      echo    - encontrado no registro: !DN!
      set "LOC="
      for /f "tokens=2,*" %%A in ('reg query "%%K" /v InstallLocation 2^>nul ^| findstr /i /c:"InstallLocation"') do set "LOC=%%B"
      if defined LOC if exist "!LOC!" (
        rmdir /s /q "!LOC!" 2>nul
        if not exist "!LOC!" ( echo        pasta removida: !LOC! & set "REMOVED=1" )
      )
      reg delete "%%K" /f >nul 2>&1 && ( echo        registro removido & set "REMOVED=1" )
    )
  )
)
exit /b

# Battery Creator

Przeglądarkowy konfigurator pakietu baterii do roweru elektrycznego. Aplikacja prowadzi przez geometrię pakietu, sekcje S/P, fizyczne połączenia taśm oraz symulację elektryczną i termiczną z wirtualnym BMS.

## Uruchomienie lokalne

Projekt jest aplikacją statyczną bez etapu budowania. Ze względu na użycie Web Workerów najlepiej uruchamiać go przez lokalny serwer HTTP, na przykład:

```powershell
python -m http.server 8000
```

Następnie otwórz `http://localhost:8000/`.

## Wersja online

Po wdrożeniu GitHub Pages aplikacja jest dostępna pod adresem:

https://alpsoonn.github.io/battery-creator/

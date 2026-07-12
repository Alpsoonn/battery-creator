# Dane fizyczne taśm — etap 3

`strip-materials.json` jest kanonicznym źródłem właściwości czterech materiałów w temperaturze odniesienia 20°C. `strip-size-presets.json` zawiera popularne geometrie i kontrolne rezystancje odcinka 100 mm. `strip-data.schema.json` opisuje stabilny kontrakt danych dla przyszłych symulacji.

`strip-catalog.js` jest statyczną, przeglądarkową postacią katalogu używaną przez `index.html`. Jest ładowany jako zwykły skrypt, dlatego działa zarówno bez serwera przez `file://`, jak i po publikacji na GitHub Pages. Nie korzysta z `fetch()` ani modułów ES. Przy zmianie danych JSON należy zaktualizować również ten katalog przeglądarkowy.

`cell-model-catalog.js` zawiera lokalne charakterystyki chemii NMC/NCA, LFP i LCO: krzywe OCV(SOC), współczynniki rezystancji względem temperatury i SOC, dostępną pojemność względem temperatury, ograniczenie ładowania oraz parametry uproszczonego modelu dynamicznego. Są to wartości startowe modelu inżynierskiego; dane konkretnego producenta powinny mieć pierwszeństwo.

Wartość `measured_resistance_mohm_per_100mm` konkretnej taśmy ma pierwszeństwo przed rezystywnością nominalną materiału. Pomiar nie obejmuje automatycznie rezystancji kontaktów i zgrzewów; należy je dodawać osobno.

Podstawowe zależności użyte w `js/physics/strip-physics.js`:

- `R = ρL/A`
- `R(T) = R20 × [1 + α(T − 20)]`
- `m = Lwtρm`
- `Cth = mcp`
- `P = I²R`

Wymiary wejściowe modułu są w milimetrach. Rezystancja wyniku jest w omach, masa w kilogramach, a pojemność cieplna w J/K. Identyczne, prawidłowo połączone warstwy są traktowane jako połączenie równoległe; rezystancja jest dzielona przez liczbę warstw, a masa i pojemność cieplna są przez nią mnożone.

Zakresy rezystywności służą do późniejszej analizy tolerancji. Ustawienie nominalne Ni200 wynosi konserwatywnie `9.0e-8 Ω·m`; wartości dla bardzo czystego niklu nie należy automatycznie stosować do komercyjnej taśmy Ni200.
